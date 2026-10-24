import type { CombatEvent, MatchMode } from '../../types/combat'

export type BurstKind = 'hit' | 'blocked'
type ImpactCombatEvent = Extract<CombatEvent, { type: 'impact' }>

const GRAVITY = -6.5
const DRAG = 2.4

/** Small deterministic PRNG so effects are reproducible in tests. */
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

function finite(...values: number[]): boolean { return values.every(Number.isFinite) }

/** Fixed-capacity spark pool. Dense arrays, swap-remove, no allocation after construction. */
export class ImpactParticles {
  readonly position: Float32Array
  readonly velocity: Float32Array
  readonly life: Float32Array
  readonly duration: Float32Array
  readonly kind: Uint8Array
  count = 0
  private readonly random: () => number

  constructor(readonly capacity = 64, seed = 0x5eed) {
    this.position = new Float32Array(capacity * 3)
    this.velocity = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.duration = new Float32Array(capacity)
    this.kind = new Uint8Array(capacity)
    this.random = createRandom(seed)
  }

  /** Emits sparks travelling mostly along the punch direction (+1 = +Z). Extra sparks beyond capacity are dropped. */
  burst(kind: BurstKind, x: number, y: number, z: number, direction: 1 | -1, amount = 1): number {
    if (!finite(x, y, z, amount) || amount <= 0) return 0
    const requested = Math.round((kind === 'hit' ? 14 : 9) * Math.min(2, amount))
    const emitted = Math.min(requested, this.capacity - this.count)
    const speed = kind === 'hit' ? 2.6 : 1.6
    for (let index = 0; index < emitted; index++) {
      const slot = this.count++
      const theta = this.random() * Math.PI * 2
      const lift = this.random() * 0.9 + 0.1
      const spread = Math.sqrt(1 - lift * lift)
      const magnitude = speed * (0.55 + this.random() * 0.75)
      this.position[slot * 3] = x
      this.position[slot * 3 + 1] = y
      this.position[slot * 3 + 2] = z
      this.velocity[slot * 3] = Math.cos(theta) * spread * magnitude
      this.velocity[slot * 3 + 1] = lift * magnitude * 0.8
      this.velocity[slot * 3 + 2] = (Math.sin(theta) * spread * 0.6 + direction * 0.8) * magnitude
      this.duration[slot] = 0.28 + this.random() * 0.22
      this.life[slot] = this.duration[slot]
      this.kind[slot] = kind === 'hit' ? 0 : 1
    }
    return emitted
  }

  step(elapsed: number): void {
    const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 0.1)) : 0
    if (dt === 0) return
    const damping = Math.exp(-DRAG * dt)
    for (let index = 0; index < this.count;) {
      this.life[index] -= dt
      if (this.life[index] <= 0) { this.remove(index); continue }
      const offset = index * 3
      this.velocity[offset + 1] += GRAVITY * dt
      for (let axis = 0; axis < 3; axis++) {
        this.velocity[offset + axis] *= damping
        this.position[offset + axis] += this.velocity[offset + axis] * dt
      }
      index++
    }
  }

  /** Remaining life in [0, 1]; drives size and colour fade. */
  fade(index: number): number { return this.duration[index] > 0 ? Math.max(0, this.life[index] / this.duration[index]) : 0 }

  clear(): void { this.count = 0 }

  private remove(index: number): void {
    const last = --this.count
    if (index === last) return
    this.position.copyWithin(index * 3, last * 3, last * 3 + 3)
    this.velocity.copyWithin(index * 3, last * 3, last * 3 + 3)
    this.life[index] = this.life[last]
    this.duration[index] = this.duration[last]
    this.kind[index] = this.kind[last]
  }
}

export interface Pulse { x: number; y: number; z: number; age: number; duration: number; kind: BurstKind; active: boolean }

/** Expanding contact rings: warm on clean hits, cyan shield on blocks. Oldest pulse is recycled when full. */
export class ImpactPulses {
  readonly pulses: readonly Pulse[]
  private next = 0

  constructor(capacity = 4) {
    this.pulses = Array.from({ length: Math.max(1, capacity) }, () => ({ x: 0, y: 0, z: 0, age: 0, duration: 0, kind: 'hit' as BurstKind, active: false }))
  }

  spawn(kind: BurstKind, x: number, y: number, z: number): void {
    if (!finite(x, y, z)) return
    const pulse = this.pulses[this.next] as Pulse
    this.next = (this.next + 1) % this.pulses.length
    Object.assign(pulse, { x, y, z, age: 0, duration: kind === 'blocked' ? 0.32 : 0.24, kind, active: true })
  }

  step(elapsed: number): void {
    const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 0.1)) : 0
    for (const pulse of this.pulses as Pulse[]) {
      if (!pulse.active) continue
      pulse.age += dt
      if (pulse.age >= pulse.duration) pulse.active = false
    }
  }

  progress(pulse: Pulse): number { return pulse.duration > 0 ? Math.min(1, pulse.age / pulse.duration) : 1 }

  clear(): void { for (const pulse of this.pulses as Pulse[]) pulse.active = false }
}

/** Trauma-based shake: amplitude grows with trauma², decays linearly, uses smooth deterministic waves. */
export class CameraShake {
  trauma = 0
  private time = 0

  constructor(private readonly maxOffset = 0.09, private readonly decayPerSecond = 1.8) {}

  add(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.trauma = Math.min(1, this.trauma + amount)
  }

  step(elapsed: number): void {
    const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 0.1)) : 0
    this.time += dt
    this.trauma = Math.max(0, this.trauma - this.decayPerSecond * dt)
  }

  offset(out: { x: number; y: number; z: number }): typeof out {
    const amplitude = this.trauma * this.trauma * this.maxOffset
    if (amplitude === 0) { out.x = 0; out.y = 0; out.z = 0; return out }
    const t = this.time
    out.x = amplitude * (Math.sin(t * 47.1) * 0.7 + Math.sin(t * 83.3 + 1.3) * 0.3)
    out.y = amplitude * (Math.sin(t * 53.9 + 2.1) * 0.7 + Math.sin(t * 91.7 + 0.4) * 0.3)
    out.z = amplitude * Math.sin(t * 61.3 + 4.2) * 0.5
    return out
  }

  clear(): void { this.trauma = 0 }
}

export interface ImpactFeedback {
  readonly burst: BurstKind | null
  readonly amount: number
  readonly shake: number
  /** +1 when the punch travels toward +Z (the player faces +Z). */
  readonly direction: 1 | -1
}

/** Maps a resolved contact to visual feedback. Knockouts are emphasised; dodges and misses produce no sparks. */
export function impactFeedback(event: ImpactCombatEvent, mode: MatchMode): ImpactFeedback {
  const { impact } = event
  const direction = impact.attacker === 'player' ? 1 : -1
  if (impact.result !== 'hit' && impact.result !== 'blocked') return { burst: null, amount: 0, shake: 0, direction }
  const knockout = event.defenderHealth <= 0
  const playerHurt = mode === 'webcam' && impact.attacker === 'opponent'
  if (impact.result === 'blocked') return { burst: 'blocked', amount: knockout ? 1.2 : 0.6, shake: knockout ? 0.6 : 0.12, direction }
  return { burst: 'hit', amount: knockout ? 1.8 : 1, shake: knockout ? 0.85 : playerHurt ? 0.5 : 0.3, direction }
}
