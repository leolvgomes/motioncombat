import { Quaternion } from 'three'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizeArena, sanitizeLook, sanitizeName } from '../../features/customization/catalog'
import { MAX_REPLAYS, REPLAY_STORAGE_PREFIX, keepReplays, loadReplays, useReplayStore } from '../../stores/replay-store'
import type { CombatEvent, CombatInput, CombatRotations, FighterFrame, FighterId } from '../../types/combat'
import { CombatEngine } from '../combat/combat-engine'
import { createCombatGuardPose } from '../animation/combat-clips'
import { RIG_JOINTS } from '../motion/rig-controller'
import { MAX_REPLAY_FRAMES, REPLAY_STRIDE, REPLAY_TAIL_SECONDS, ReplayPlayer, ReplayRecorder, decodeReplay, encodeReplay } from './replay'
import type { Replay, ReplayMeta } from './replay'

const sanitizers = { name: sanitizeName, look: sanitizeLook, arena: sanitizeArena }
const meta = (id = 'match', mode: ReplayMeta['mode'] = 'demo', recordedAt = 1000): ReplayMeta => ({
  id, recordedAt, mode, name: 'ATLAS-01', look: sanitizeLook(null), arena: 'harbor',
})

interface Sample { time: number; health: [number, number]; frames: Record<FighterId, { position: number[]; shoulder: Quaternion }> }

/** A complete AI match recorded at the given display rate, with the live state kept for comparison. */
function recordMatch(fps = 60, { pauseAt = -1, id = 'match' } = {}): { replay: Replay; samples: Sample[]; events: CombatEvent[]; engine: CombatEngine } {
  const pose = createCombatGuardPose()
  const input: { -readonly [Key in keyof CombatInput]: CombatInput[Key] } = {
    now: 1000, ready: false, generation: 1, pulse: null, mirrored: false, posture: 'neutral',
    playerBase: Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...pose[name])])) as CombatRotations,
  }
  const engine = new CombatEngine(77)
  const recorder = new ReplayRecorder()
  engine.start('demo', input)
  engine.drainEvents()
  recorder.begin(meta(id))
  const samples: Sample[] = []
  const events: CombatEvent[] = []
  let time = -1
  const copy = (frame: FighterFrame) => ({ position: [...frame.position], shoulder: frame.rotations.leftShoulder.clone() })
  for (let frame = 0; frame < 170 * fps && !recorder.complete; frame++) {
    if (frame === Math.round(pauseAt * fps)) {
      engine.pause('manual')
      for (let idle = 0; idle < 5 * fps; idle++) { engine.step(input, 1 / fps); recorder.capture(1 / fps, engine.snapshot, engine.fighters, engine.drainEvents()) }
      engine.resume(input)
    }
    input.now += 1000 / fps
    engine.step(input, 1 / fps)
    const drained = engine.drainEvents()
    recorder.capture(1 / fps, engine.snapshot, engine.fighters, drained)
    events.push(...drained.filter(({ type }) => type !== 'countdown'))
    if (engine.snapshot.phase !== 'countdown') {
      time = time < 0 ? 0 : time + 1 / fps
      samples.push({ time, health: [engine.snapshot.playerHealth, engine.snapshot.opponentHealth], frames: { player: copy(engine.fighters.player), opponent: copy(engine.fighters.opponent) } })
    }
  }
  const replay = recorder.finish()
  if (!replay) throw new Error('The match did not finish.')
  expect(recorder.recording).toBe(false)
  return { replay, samples, events, engine }
}

const recorded = recordMatch()

describe('ReplayRecorder', () => {
  it('captures a whole match with its result, statistics and every event once', () => {
    const { replay, events, engine } = recorded
    expect(replay.winner).toBe(engine.snapshot.winner)
    expect(replay.playerStats).toEqual(engine.snapshot.playerStats)
    expect(replay.opponentStats).toEqual(engine.snapshot.opponentStats)
    expect(replay.events.map(({ event }) => event)).toEqual(events)
    expect(replay.frames).toHaveLength(replay.frameCount * REPLAY_STRIDE)
    expect(replay.frameCount).toBeLessThanOrEqual(MAX_REPLAY_FRAMES)
    const end = replay.events.find(({ event }) => event.type === 'match-end')!
    expect(replay.duration - end.time).toBeGreaterThan(REPLAY_TAIL_SECONDS - 0.2)
    expect(replay.events.every(({ time }, index) => time >= (replay.events[index - 1]?.time ?? 0) && time <= replay.duration)).toBe(true)
  })

  it('adds no time while paused', () => {
    // Pausing cancels AI plans, so only the recorded length is compared with the live clock.
    const { replay, samples } = recordMatch(60, { pauseAt: 8 })
    expect(Math.abs(replay.duration - samples.at(-1)!.time)).toBeLessThan(0.2)
  })

  it('discards unfinished matches and ignores captures when idle', () => {
    const recorder = new ReplayRecorder()
    const engine = new CombatEngine(1)
    recorder.capture(0.1, engine.snapshot, engine.fighters, [])
    expect(recorder.finish()).toBeNull()
    recorder.begin(meta())
    expect(recorder.recording).toBe(true)
    expect(recorder.finish()).toBeNull()
    expect(recorder.recording).toBe(false)
  })
})

describe('ReplayPlayer', () => {
  it('reproduces the live positions, joints and health within the sampling error', () => {
    const { replay, samples } = recorded
    const player = new ReplayPlayer(replay)
    let worst = 0
    for (const sample of samples.filter((_, index) => index % 37 === 0)) {
      player.seek(sample.time)
      for (const id of ['player', 'opponent'] as const) {
        // Round changes teleport the fighters; interpolation never crosses them.
        const distance = Math.hypot(...sample.frames[id].position.map((value, axis) => value - player.fighters[id].position[axis]!))
        worst = Math.max(worst, distance)
        expect(player.fighters[id].rotations.leftShoulder.length()).toBeCloseTo(1, 5)
      }
    }
    expect(worst).toBeLessThan(0.2)
    const still = samples.filter((sample, index) => index > 2 && index < samples.length - 3
      && sample.health.every((value, side) => value === samples[index - 3]!.health[side] && value === samples[index + 3]!.health[side]))
    for (const sample of still.filter((_, index) => index % 53 === 0)) {
      player.seek(sample.time)
      expect([player.snapshot.playerHealth, player.snapshot.opponentHealth]).toEqual(sample.health)
    }
  })

  it('plays every event once in order and stops at the end', () => {
    const player = new ReplayPlayer(recorded.replay)
    const received: CombatEvent[] = []
    for (let frame = 0; frame < 200 * 60 && player.playing; frame++) { player.step(1 / 60); received.push(...player.drainEvents()) }
    expect(received).toEqual(recorded.events)
    expect(player.finished).toBe(true)
    expect(player.playing).toBe(false)
    expect(player.snapshot).toMatchObject({ phase: 'finished', winner: recorded.replay.winner, pauseReason: 'manual' })
    player.play()
    expect(player.time).toBe(0)
    expect(player.snapshot).toMatchObject({ phase: 'fighting', winner: null, pauseReason: null })
  })

  it('seeks without replaying the events in between and clamps invalid times', () => {
    const player = new ReplayPlayer(recorded.replay)
    player.seek(recorded.replay.duration / 2)
    expect(player.drainEvents()).toEqual([])
    expect(player.snapshot.lastImpact).toBeNull()
    player.seek(-5)
    expect(player.time).toBe(0)
    player.seek(Number.NaN)
    expect(player.time).toBe(0)
    player.seek(1e9)
    expect(player.time).toBe(recorded.replay.duration)
    expect(player.snapshot.winner).toBe(recorded.replay.winner)
  })

  it('honours speed and pause', () => {
    const player = new ReplayPlayer(recorded.replay)
    player.setSpeed(0.5)
    player.step(0.2)
    expect(player.time).toBeCloseTo(0.1)
    player.pause()
    player.step(1)
    expect(player.time).toBeCloseTo(0.1)
    player.setSpeed(9 as never)
    expect(player.speed).toBe(1)
  })
})

describe('replay storage format', () => {
  it('round-trips losslessly and stays small', () => {
    const encoded = encodeReplay(recorded.replay)
    expect(decodeReplay(encoded, sanitizers)).toEqual(recorded.replay)
    expect(encoded.length).toBeLessThan(1_200_000)
    expect(encoded).not.toContain('landmark')
  })

  it.each([
    ['nothing', () => null], ['text', () => 'oops'], ['an array', () => '[]'],
    ['another version', (value: Record<string, unknown>) => ({ ...value, version: 99 })],
    ['a wrong frame count', (value: Record<string, unknown>) => ({ ...value, frameCount: 3 })],
    ['too many frames', (value: Record<string, unknown>) => ({ ...value, frameCount: MAX_REPLAY_FRAMES + 1 })],
    ['broken base64', (value: Record<string, unknown>) => ({ ...value, frames: '***' })],
    ['missing statistics', (value: Record<string, unknown>) => ({ ...value, playerStats: {} })],
    ['an unknown event', (value: Record<string, unknown>) => ({ ...value, events: [{ time: 0, event: { type: 'teleport' } }] })],
    ['an unknown combo', (value: Record<string, unknown>) => ({ ...value, events: [{ time: 0, event: { type: 'combo', combo: { id: 1, fighter: 'player', combo: 'x', bonus: 1 } } }] })],
    ['events out of order', (value: Record<string, unknown>) => ({ ...value, events: [{ time: 2, event: { type: 'fight', round: 1 } }, { time: 1, event: { type: 'fight', round: 1 } }] })],
    ['an invalid winner', (value: Record<string, unknown>) => ({ ...value, winner: 'nobody' })],
  ])('rejects %s', (_label, change) => {
    const result = change(JSON.parse(encodeReplay(recorded.replay)) as Record<string, unknown>)
    expect(decodeReplay(typeof result === 'object' && result !== null ? JSON.stringify(result) : result, sanitizers)).toBeNull()
  })

  it('sanitizes untrusted identity fields', () => {
    const stored = JSON.parse(encodeReplay(recorded.replay)) as { meta: Record<string, unknown> }
    stored.meta.name = '<b>x</b>'
    stored.meta.look = { armor: 'gold' }
    stored.meta.arena = 'moon'
    const decoded = decodeReplay(JSON.stringify(stored), sanitizers)
    expect(decoded?.meta).toMatchObject({ name: 'BXB', arena: 'foundry', look: { armor: 'titanium' } })
  })
})

describe('replay store', () => {
  class MemoryStorage {
    readonly map = new Map<string, string>()
    quota = Infinity
    get length() { return this.map.size }
    key(index: number) { return [...this.map.keys()][index] ?? null }
    getItem(key: string) { return this.map.get(key) ?? null }
    removeItem(key: string) { this.map.delete(key) }
    setItem(key: string, value: string) { if (value.length > this.quota) throw new Error('quota'); this.map.set(key, value) }
  }
  let memory: MemoryStorage
  const replay = (id: string, recordedAt: number, mode: ReplayMeta['mode'] = 'webcam'): Replay => ({ ...recorded.replay, meta: meta(id, mode, recordedAt) })

  beforeEach(() => {
    memory = new MemoryStorage()
    vi.stubGlobal('localStorage', memory)
    useReplayStore.setState({ replays: [], persistent: true, playback: null })
  })
  afterEach(() => { vi.unstubAllGlobals(); useReplayStore.setState({ replays: [], persistent: true, playback: null }) })

  it('keeps the newest replays and lets demonstrations go first', () => {
    expect(keepReplays([replay('a', 1), replay('b', 2), replay('c', 3), replay('d', 4)]).map(({ meta: { id } }) => id)).toEqual(['d', 'c', 'b'])
    expect(keepReplays([replay('a', 1), replay('b', 2, 'demo'), replay('c', 3), replay('d', 4)]).map(({ meta: { id } }) => id)).toEqual(['d', 'c', 'a'])
    expect(keepReplays([replay('a', 1), replay('b', 2), replay('c', 3), replay('d', 4, 'demo')]).map(({ meta: { id } }) => id)).toEqual(['c', 'b', 'a'])
  })

  it('persists, evicts, reloads and removes', () => {
    const { add } = useReplayStore.getState()
    ;[1, 2, 3, 4].forEach((time) => add(replay(`r${time}`, time)))
    expect([...memory.map.keys()].sort()).toEqual(['r2', 'r3', 'r4'].map((id) => REPLAY_STORAGE_PREFIX + id))
    memory.map.set(`${REPLAY_STORAGE_PREFIX}broken`, '{}')
    memory.map.set('unrelated', 'keep')
    expect(loadReplays().map(({ meta: { id } }) => id)).toEqual(['r4', 'r3', 'r2'])
    expect(memory.map.has(`${REPLAY_STORAGE_PREFIX}broken`)).toBe(false)
    expect(memory.map.get('unrelated')).toBe('keep')
    useReplayStore.getState().remove('r4')
    expect(loadReplays()).toHaveLength(MAX_REPLAYS - 1)
    expect(useReplayStore.getState().replays.map(({ meta: { id } }) => id)).toEqual(['r3', 'r2'])
  })

  it('keeps a replay for the session when storage is full', () => {
    memory.quota = 10
    useReplayStore.getState().add(replay('big', 1))
    expect(useReplayStore.getState()).toMatchObject({ persistent: false })
    expect(useReplayStore.getState().replays).toHaveLength(1)
    vi.stubGlobal('localStorage', undefined)
    expect(loadReplays()).toEqual([])
    expect(() => useReplayStore.getState().remove('big')).not.toThrow()
  })
})
