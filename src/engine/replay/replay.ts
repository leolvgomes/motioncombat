import { Quaternion } from 'three'
import type { AttackKind, AttackSide } from '../../types/animation'
import type { CombatEvent, CombatRotations, CombatSnapshot, ComboId, FighterAction, FighterFrame, FighterId, FighterStats, MatchMode, MatchPhase, MatchWinner } from '../../types/combat'
import type { ArenaId, RobotLook } from '../../types/customization'
import { parseStats } from '../career/career'
import { COMBOS } from '../combat/combos'
import { RIG_JOINTS } from '../motion/rig-controller'

/**
 * Motion replay: the robots' own joint rotations, sampled while a match runs.
 * Camera images and body landmarks are never part of it.
 */
export const REPLAY_VERSION = 1
export const REPLAY_RATE = 24
export const MAX_REPLAY_FRAMES = REPLAY_RATE * 200
/** Seconds recorded after the final blow so the outcome pose can settle. */
export const REPLAY_TAIL_SECONDS = 1.8

const ROTATION_SCALE = 32767
const POSITION_SCALE = 8192
const FIGHTER_COLUMNS = 2 + RIG_JOINTS.length * 4 + 4
const SHARED_COLUMNS = 8
export const REPLAY_STRIDE = SHARED_COLUMNS + FIGHTER_COLUMNS * 2
const FIGHTERS: readonly FighterId[] = ['player', 'opponent']
const ACTIONS: readonly FighterAction[] = ['idle', 'approaching', 'guard', 'telegraph', 'attacking', 'retreating', 'stunned', 'victory', 'defeat']
const PHASES: readonly MatchPhase[] = ['ready', 'countdown', 'fighting', 'round-over', 'finished']
const KINDS: readonly AttackKind[] = ['straight', 'hook', 'uppercut']

export interface ReplayMeta {
  readonly id: string
  readonly recordedAt: number
  readonly mode: MatchMode
  readonly name: string
  readonly look: RobotLook
  readonly arena: ArenaId
}

export interface ReplayEvent { readonly time: number; readonly event: CombatEvent }

export interface Replay {
  readonly meta: ReplayMeta
  readonly winner: MatchWinner
  readonly playerStats: FighterStats
  readonly opponentStats: FighterStats
  /** Seconds. */
  readonly duration: number
  readonly frameCount: number
  /** REPLAY_STRIDE integers per frame. */
  readonly frames: Int16Array
  readonly events: readonly ReplayEvent[]
}

export interface ReplaySanitizers {
  readonly name: (value: unknown) => string
  readonly look: (value: unknown) => RobotLook
  readonly arena: (value: unknown) => ArenaId
}

type Fighters = Readonly<Record<FighterId, FighterFrame>>

function int16(value: number): number {
  return Number.isFinite(value) ? Math.max(-32768, Math.min(32767, Math.round(value))) : 0
}

/** Shared columns: elapsed ms, phase, round, deciseconds left, health ×10 (two) and wins (two). */
function writeFrame(target: Int16Array, offset: number, elapsed: number, snapshot: CombatSnapshot, fighters: Fighters): void {
  target[offset] = int16(elapsed * 1000)
  target[offset + 1] = PHASES.indexOf(snapshot.phase)
  target[offset + 2] = snapshot.round
  target[offset + 3] = int16(snapshot.secondsLeft * 10)
  target[offset + 4] = int16(snapshot.playerHealth * 10)
  target[offset + 5] = int16(snapshot.opponentHealth * 10)
  target[offset + 6] = snapshot.playerWins
  target[offset + 7] = snapshot.opponentWins
  let cursor = offset + SHARED_COLUMNS
  for (const id of FIGHTERS) {
    const frame = fighters[id]
    target[cursor++] = int16(frame.position[0] * POSITION_SCALE)
    target[cursor++] = int16(frame.position[2] * POSITION_SCALE)
    for (const name of RIG_JOINTS) {
      const { x, y, z, w } = frame.rotations[name]
      target[cursor++] = int16(x * ROTATION_SCALE)
      target[cursor++] = int16(y * ROTATION_SCALE)
      target[cursor++] = int16(z * ROTATION_SCALE)
      target[cursor++] = int16(w * ROTATION_SCALE)
    }
    target[cursor++] = Math.max(0, ACTIONS.indexOf(frame.action))
    target[cursor++] = int16(frame.hitFlash * 1000)
    target[cursor++] = frame.attackSide === null ? 0 : frame.attackSide === 'left' ? 1 : 2
    target[cursor++] = frame.attackKind === null ? 0 : KINDS.indexOf(frame.attackKind) + 1
  }
}

function totalDuration(frames: Int16Array, frameCount: number): number {
  let duration = 0
  for (let index = 1; index < frameCount; index++) duration += Math.max(0, frames[index * REPLAY_STRIDE]!) / 1000
  return duration
}

/** Samples one running match. Pauses add no time, and a match that never ends leaves nothing behind. */
export class ReplayRecorder {
  private meta: ReplayMeta | null = null
  private buffer = new Int16Array(0)
  private count = 0
  private time = 0
  private sinceFrame = 0
  private events: ReplayEvent[] = []
  private ending: { winner: MatchWinner; player: FighterStats; opponent: FighterStats } | null = null
  private tail = 0

  get recording(): boolean { return this.meta !== null }
  /** The match ended and its outcome pose has been captured. */
  get complete(): boolean { return this.ending !== null && this.tail >= REPLAY_TAIL_SECONDS }

  begin(meta: ReplayMeta): void {
    this.discard()
    this.meta = meta
    this.buffer = new Int16Array(REPLAY_STRIDE * REPLAY_RATE * 30)
  }

  discard(): void {
    this.meta = null
    this.buffer = new Int16Array(0)
    this.count = 0
    this.time = 0
    this.sinceFrame = 0
    this.events = []
    this.ending = null
    this.tail = 0
  }

  /** Call once per display step, with the state it produced and the events it emitted. */
  capture(elapsed: number, snapshot: CombatSnapshot, fighters: Fighters, events: readonly CombatEvent[]): void {
    if (!this.meta || this.complete || snapshot.pauseReason !== null
      || snapshot.phase === 'ready' || snapshot.phase === 'countdown') return
    const first = this.count === 0
    if (!first) {
      const dt = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.25))
      this.time += dt
      this.sinceFrame += dt
      if (this.ending) this.tail += dt
    }
    for (const event of events) {
      if (event.type === 'countdown') continue
      this.events.push({ time: this.time, event })
      if (event.type === 'match-end') {
        this.ending = { winner: event.winner, player: { ...snapshot.playerStats }, opponent: { ...snapshot.opponentStats } }
      }
    }
    if (this.count < MAX_REPLAY_FRAMES && (first || this.sinceFrame >= 1 / REPLAY_RATE - 1e-6)) {
      this.reserve()
      writeFrame(this.buffer, this.count * REPLAY_STRIDE, this.sinceFrame, snapshot, fighters)
      this.count += 1
      this.sinceFrame = 0
    }
  }

  /** The finished replay, or null when the match did not end. Recording stops either way. */
  finish(): Replay | null {
    const { meta, ending, count, events } = this
    if (!meta || !ending || count < 2) { this.discard(); return null }
    const frames = this.buffer.slice(0, count * REPLAY_STRIDE)
    const duration = totalDuration(frames, count)
    const replay: Replay = {
      meta, winner: ending.winner, playerStats: ending.player, opponentStats: ending.opponent,
      duration, frameCount: count, frames,
      events: events.map(({ time, event }) => ({ time: Math.min(time, duration), event })),
    }
    this.discard()
    return replay
  }

  private reserve(): void {
    const needed = (this.count + 1) * REPLAY_STRIDE
    if (needed <= this.buffer.length) return
    const grown = new Int16Array(Math.min(MAX_REPLAY_FRAMES * REPLAY_STRIDE, Math.max(needed, this.buffer.length * 2)))
    grown.set(this.buffer)
    this.buffer = grown
  }
}

type MutableFrame = { -readonly [Key in keyof FighterFrame]: Key extends 'position' ? [number, number, number]
  : Key extends 'rotations' ? CombatRotations : FighterFrame[Key] }
type MutableSnapshot = { -readonly [Key in keyof CombatSnapshot]: CombatSnapshot[Key] }

function emptyFrame(id: FighterId): MutableFrame {
  return {
    position: [0, 0, 0], yaw: id === 'player' ? 0 : Math.PI,
    rotations: Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion()])) as CombatRotations,
    action: 'idle', attackSide: null, attackKind: null, attackProgress: 0, hitActive: false, hitFlash: 0, blocking: false,
  }
}

export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2] as const
export type ReplaySpeed = typeof REPLAY_SPEEDS[number]

/** Interpolated playback. It produces the same frames and snapshot the arena reads from a live match. */
export class ReplayPlayer {
  readonly fighters: Record<FighterId, MutableFrame> = { player: emptyFrame('player'), opponent: emptyFrame('opponent') }
  private readonly state: MutableSnapshot
  private readonly times: Float64Array
  private readonly scratch = new Quaternion()
  private cursor = 0
  private running = true
  private rate: ReplaySpeed = 1
  private nextEvent = 0
  private pending: CombatEvent[] = []

  constructor(readonly replay: Replay) {
    this.times = new Float64Array(replay.frameCount)
    for (let index = 1; index < replay.frameCount; index++) {
      this.times[index] = this.times[index - 1]! + Math.max(0, replay.frames[index * REPLAY_STRIDE]!) / 1000
    }
    this.state = {
      mode: replay.meta.mode, phase: 'fighting', pauseReason: null, round: 1, secondsLeft: 0, countdown: 0, betweenRoundsLeft: 0,
      playerHealth: 0, opponentHealth: 0, playerWins: 0, opponentWins: 0, roundWinner: null, winner: null,
      lastImpact: null, lastCombo: null, playerStreak: 0, opponentStreak: 0,
      playerStats: replay.playerStats, opponentStats: replay.opponentStats,
    }
    this.seek(0)
  }

  get snapshot(): CombatSnapshot { return this.state }
  get time(): number { return this.cursor }
  get playing(): boolean { return this.running }
  get speed(): ReplaySpeed { return this.rate }
  get finished(): boolean { return this.cursor >= this.replay.duration - 1e-9 }

  setSpeed(speed: ReplaySpeed): void { this.rate = REPLAY_SPEEDS.includes(speed) ? speed : 1 }

  play(): void {
    if (this.finished) this.seek(0)
    this.running = true
    this.state.pauseReason = null
  }

  pause(): void {
    this.running = false
    this.state.pauseReason = 'manual'
  }

  /** Jumps without replaying the events in between. */
  seek(time: number): void {
    this.cursor = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, this.replay.duration))
    const { events } = this.replay
    const next = events.findIndex((entry) => entry.time >= this.cursor - 1e-9)
    this.nextEvent = next < 0 ? events.length : next
    this.pending = []
    this.state.roundWinner = null
    this.state.winner = null
    for (let index = 0; index < this.nextEvent; index++) this.applyEvent(events[index]!.event)
    // A past contact must not pop up as a fresh notification after seeking.
    this.state.lastImpact = null
    this.state.lastCombo = null
    this.apply()
  }

  step(elapsed: number): void {
    if (!this.running) return
    const dt = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.25)) * this.rate
    this.cursor = Math.min(this.replay.duration, this.cursor + dt)
    const { events } = this.replay
    while (this.nextEvent < events.length && events[this.nextEvent]!.time <= this.cursor + 1e-9) {
      const { event } = events[this.nextEvent++]!
      this.pending.push(event)
      this.applyEvent(event)
    }
    this.apply()
    if (this.finished) this.pause()
  }

  drainEvents(): CombatEvent[] { return this.pending.splice(0) }

  private applyEvent(event: CombatEvent): void {
    if (event.type === 'impact') this.state.lastImpact = event.impact
    else if (event.type === 'combo') this.state.lastCombo = event.combo
    else if (event.type === 'fight') this.state.roundWinner = null
    else if (event.type === 'round-end') this.state.roundWinner = event.winner
    else if (event.type === 'match-end') this.state.winner = event.winner
  }

  private apply(): void {
    const { frames, frameCount } = this.replay
    let low = 0
    let high = frameCount - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.times[middle]! <= this.cursor) low = middle
      else high = middle - 1
    }
    const next = Math.min(low + 1, frameCount - 1)
    const span = this.times[next]! - this.times[low]!
    const a = low * REPLAY_STRIDE
    const b = next * REPLAY_STRIDE
    // A new round teleports both fighters; never glide between the two.
    const amount = span > 0 && frames[a + 2] === frames[b + 2]
      ? Math.max(0, Math.min(1, (this.cursor - this.times[low]!) / span)) : 0
    this.state.phase = PHASES[frames[a + 1]!] ?? 'fighting'
    this.state.round = frames[a + 2]!
    this.state.secondsLeft = frames[a + 3]! / 10
    this.state.playerHealth = frames[a + 4]! / 10
    this.state.opponentHealth = frames[a + 5]! / 10
    this.state.playerWins = frames[a + 6]!
    this.state.opponentWins = frames[a + 7]!
    let offset = SHARED_COLUMNS
    for (const id of FIGHTERS) {
      const target = this.fighters[id]
      target.position[0] = (frames[a + offset]! * (1 - amount) + frames[b + offset]! * amount) / POSITION_SCALE
      target.position[2] = (frames[a + offset + 1]! * (1 - amount) + frames[b + offset + 1]! * amount) / POSITION_SCALE
      let column = offset + 2
      for (const name of RIG_JOINTS) {
        readRotation(frames, a + column, target.rotations[name])
        target.rotations[name].slerp(readRotation(frames, b + column, this.scratch), amount)
        column += 4
      }
      target.action = ACTIONS[frames[a + column]!] ?? 'idle'
      target.hitFlash = Math.max(0, Math.min(1, frames[a + column + 1]! / 1000))
      target.attackSide = sideOf(frames[a + column + 2]!)
      target.attackKind = KINDS[frames[a + column + 3]! - 1] ?? null
      target.blocking = target.action === 'guard'
      offset += FIGHTER_COLUMNS
    }
  }
}

function sideOf(code: number): AttackSide | null { return code === 1 ? 'left' : code === 2 ? 'right' : null }

function readRotation(frames: Int16Array, offset: number, out: Quaternion): Quaternion {
  out.set(frames[offset]!, frames[offset + 1]!, frames[offset + 2]!, frames[offset + 3]!)
  return out.lengthSq() > 1 ? out.normalize() : out.identity()
}

function toBase64(frames: Int16Array): string {
  const bytes = new Uint8Array(frames.length * 2)
  const view = new DataView(bytes.buffer)
  frames.forEach((value, index) => view.setInt16(index * 2, value, true))
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Int16Array {
  const binary = atob(text)
  const view = new DataView(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) view.setUint8(index, binary.charCodeAt(index))
  const frames = new Int16Array(binary.length >> 1)
  for (let index = 0; index < frames.length; index++) frames[index] = view.getInt16(index * 2, true)
  return frames
}

export function encodeReplay(replay: Replay): string {
  const { duration: _duration, frames, ...header } = replay
  return JSON.stringify({ version: REPLAY_VERSION, ...header, frames: toBase64(frames) })
}

type Unknown = Record<string, unknown>

function record(value: unknown): Unknown | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Unknown : null }
function fighter(value: unknown): value is FighterId { return value === 'player' || value === 'opponent' }
function winnerOf(value: unknown): value is MatchWinner { return fighter(value) || value === 'draw' }
function side(value: unknown): value is AttackSide { return value === 'left' || value === 'right' }
function kind(value: unknown): value is AttackKind { return KINDS.includes(value as AttackKind) }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function combo(value: unknown): value is ComboId { return COMBOS.some(({ id }) => id === value) }

function validEvent(event: Unknown): boolean {
  switch (event.type) {
    case 'fight': return number(event.round)
    case 'attack':
    case 'telegraph': return fighter(event.fighter) && side(event.side) && kind(event.kind)
    case 'impact': {
      const impact = record(event.impact)
      return impact !== null && number(impact.id) && fighter(impact.attacker) && kind(impact.kind) && number(impact.damage)
        && ['hit', 'blocked', 'dodged', 'miss'].includes(impact.result as string) && number(event.defenderHealth)
        && Array.isArray(event.position) && event.position.length === 3 && event.position.every(number)
    }
    case 'combo': {
      const value = record(event.combo)
      return value !== null && number(value.id) && fighter(value.fighter) && combo(value.combo) && number(value.bonus)
    }
    case 'round-end': return number(event.round) && winnerOf(event.winner) && typeof event.knockout === 'boolean'
    case 'match-end': return winnerOf(event.winner) && (event.mode === 'webcam' || event.mode === 'demo')
    default: return false
  }
}

function parseEvents(value: unknown): ReplayEvent[] | null {
  if (!Array.isArray(value)) return null
  const events: ReplayEvent[] = []
  for (const item of value) {
    const entry = record(item)
    const event = record(entry?.event)
    if (!entry || !event || !number(entry.time) || entry.time < (events.at(-1)?.time ?? 0) || !validEvent(event)) return null
    events.push({ time: entry.time, event: event as unknown as CombatEvent })
  }
  return events
}

/** Null for anything incomplete, from another version or with inconsistent sizes. */
export function decodeReplay(raw: string | null, sanitize: ReplaySanitizers): Replay | null {
  if (!raw) return null
  try {
    const stored = record(JSON.parse(raw))
    const meta = record(stored?.meta)
    if (!stored || !meta || stored.version !== REPLAY_VERSION) return null
    const { id, recordedAt, mode } = meta
    const { winner, frameCount } = stored
    const playerStats = parseStats(stored.playerStats)
    const opponentStats = parseStats(stored.opponentStats)
    const events = parseEvents(stored.events)
    if (typeof id !== 'string' || id === '' || !number(recordedAt) || mode !== 'webcam' && mode !== 'demo' || !winnerOf(winner)
      || !playerStats || !opponentStats || !events || !number(frameCount) || !Number.isInteger(frameCount)
      || frameCount < 2 || frameCount > MAX_REPLAY_FRAMES || typeof stored.frames !== 'string') return null
    const frames = fromBase64(stored.frames)
    if (frames.length !== frameCount * REPLAY_STRIDE) return null
    return {
      meta: { id, recordedAt, mode, name: sanitize.name(meta.name), look: sanitize.look(meta.look), arena: sanitize.arena(meta.arena) },
      winner, playerStats, opponentStats, duration: totalDuration(frames, frameCount), frameCount, frames, events,
    }
  } catch { return null }
}
