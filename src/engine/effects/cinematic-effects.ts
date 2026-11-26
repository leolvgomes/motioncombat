/**
 * Presentation-only state for damage, knockouts and the overdrive special. Nothing here is read back
 * by the match rules, so a disabled or reduced effect can never change a result.
 */

function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0 }
function step(elapsed: number): number { return Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 0.1)) : 0 }

/** 0 for an intact robot, 1 for one with no integrity left. */
export function damageLevel(health: number, max = 100): number {
  return Number.isFinite(health) ? clamp01(1 - health / max) : 0
}

/** Smoke starts once half the integrity is gone and thickens toward a knockout (puffs per second). */
export function smokeRate(level: number): number {
  const damage = clamp01(level)
  return damage < 0.5 ? 0 : 1.5 + (damage - 0.5) / 0.5 * 7.5
}

/** Below a quarter of integrity, the robot's lights stutter. Deterministic in time, so tests and replays agree. */
export function lightFlicker(level: number, time: number): number {
  const damage = clamp01(level)
  if (damage < 0.75 || !Number.isFinite(time)) return 1
  const wave = Math.sin(time * 31) * Math.sin(time * 7.3 + 1.7)
  return wave > 0.55 - (damage - 0.75) * 1.2 ? 0.2 : 1
}

/** Seconds a knocked-out robot takes to hit the floor. */
export const FALL_SECONDS = 0.8

/** Fall progress since the knockout: accelerates like a dropped body, then settles with a small bounce. */
export function fallAmount(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  if (elapsed < FALL_SECONDS) { const progress = elapsed / FALL_SECONDS; return progress * progress }
  const after = elapsed - FALL_SECONDS
  return 1 - 0.05 * Math.exp(-after * 6) * Math.sin(after * 18)
}

/**
 * The final blow: the scene slows down while the camera closes in on the fallen robot, then everything
 * returns to normal. Timeline in real seconds, independent of the slowed simulation.
 */
export class KnockoutCinematic {
  static readonly SLOW_SCALE = 0.25
  static readonly HOLD = 1.1
  static readonly RECOVER = 0.5
  static readonly RELEASE = 0.9
  readonly focus = { x: 0, y: 0, z: 0 }
  private time = Infinity

  get active(): boolean { return this.time < KnockoutCinematic.HOLD + KnockoutCinematic.RELEASE }

  trigger(x: number, y: number, z: number): void {
    if (![x, y, z].every(Number.isFinite)) return
    this.focus.x = x
    this.focus.y = y
    this.focus.z = z
    this.time = 0
  }

  /** Advance with real (unscaled) time. */
  step(elapsed: number): void { if (this.active) this.time += step(elapsed) }

  /** Multiplier for the simulation and effects clock. */
  get timeScale(): number {
    const { SLOW_SCALE, HOLD, RECOVER } = KnockoutCinematic
    if (this.time < HOLD) return SLOW_SCALE
    if (this.time < HOLD + RECOVER) return SLOW_SCALE + (1 - SLOW_SCALE) * (this.time - HOLD) / RECOVER
    return 1
  }

  /** How far the camera moves toward the focus, 0–1, eased in and out. */
  get closeUp(): number {
    const { HOLD, RELEASE } = KnockoutCinematic
    if (!this.active) return 0
    const amount = this.time < 0.35 ? this.time / 0.35 : this.time < HOLD ? 1 : 1 - (this.time - HOLD) / RELEASE
    const value = clamp01(amount)
    return value * value * (3 - 2 * value)
  }

  clear(): void { this.time = Infinity }
}

/** A brief white-hot flash on the special's contact, 0–1. */
export class SpecialFlash {
  private time = Infinity
  static readonly DURATION = 0.35

  trigger(): void { this.time = 0 }
  step(elapsed: number): void { if (this.time < SpecialFlash.DURATION) this.time += step(elapsed) }
  get strength(): number { return this.time < SpecialFlash.DURATION ? 1 - this.time / SpecialFlash.DURATION : 0 }
  clear(): void { this.time = Infinity }
}

/** Small deterministic PRNG, as in impact-effects. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = state + 0x6d2b79f5 >>> 0
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

/** Fixed-capacity pool of rising smoke puffs. No allocation after construction. */
export class SmokePuffs {
  readonly position: Float32Array
  readonly drift: Float32Array
  readonly life: Float32Array
  readonly duration: Float32Array
  count = 0
  private readonly random: () => number
  private readonly debt = new Map<string, number>()

  constructor(readonly capacity = 48, seed = 0x5a0e) {
    this.position = new Float32Array(capacity * 3)
    this.drift = new Float32Array(capacity * 2)
    this.life = new Float32Array(capacity)
    this.duration = new Float32Array(capacity)
    this.random = createRandom(seed)
  }

  /** Emits at `rate` puffs per second from one source; fractional puffs carry over between frames. */
  emit(source: string, rate: number, elapsed: number, x: number, y: number, z: number): number {
    const dt = step(elapsed)
    if (!(rate > 0) || dt === 0 || ![x, y, z].every(Number.isFinite)) { this.debt.delete(source); return 0 }
    let owed = (this.debt.get(source) ?? 0) + rate * dt
    let emitted = 0
    while (owed >= 1 && this.count < this.capacity) {
      owed -= 1
      const slot = this.count++
      this.position[slot * 3] = x + (this.random() - 0.5) * 0.12
      this.position[slot * 3 + 1] = y
      this.position[slot * 3 + 2] = z + (this.random() - 0.5) * 0.12
      this.drift[slot * 2] = (this.random() - 0.5) * 0.25
      this.drift[slot * 2 + 1] = (this.random() - 0.5) * 0.25
      this.duration[slot] = 1.1 + this.random() * 0.7
      this.life[slot] = this.duration[slot]
      emitted++
    }
    this.debt.set(source, Math.min(owed, 1))
    return emitted
  }

  step(elapsed: number): void {
    const dt = step(elapsed)
    if (dt === 0) return
    for (let index = 0; index < this.count;) {
      this.life[index] -= dt
      if (this.life[index] <= 0) { this.remove(index); continue }
      this.position[index * 3] += this.drift[index * 2] * dt
      this.position[index * 3 + 1] += 0.55 * dt
      this.position[index * 3 + 2] += this.drift[index * 2 + 1] * dt
      index++
    }
  }

  /** Age in [0, 1]: 0 just emitted, 1 about to vanish. */
  age(index: number): number { return this.duration[index] > 0 ? 1 - Math.max(0, this.life[index] / this.duration[index]) : 1 }

  clear(): void { this.count = 0; this.debt.clear() }

  private remove(index: number): void {
    const last = --this.count
    if (index === last) return
    this.position.copyWithin(index * 3, last * 3, last * 3 + 3)
    this.drift.copyWithin(index * 2, last * 2, last * 2 + 2)
    this.life[index] = this.life[last]
    this.duration[index] = this.duration[last]
  }
}
