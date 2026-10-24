import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabStore } from '../../stores/lab-store'
import { useMatchStore } from '../../stores/match-store'
import { useRobotStore } from '../../stores/robot-store'
import type { ProcessedPose } from '../../types/motion'
import { combatMotionRuntime } from '../motion-tracking/combat-motion-runtime'
import { publishPose } from '../motion-tracking/pose-stream'
import { publishAnimationGesture, resetAnimationSignals } from '../robot/animation-signals'
import { MatchRuntime } from './match-runtime'

let now = 1000
let runtime: MatchRuntime

/** Only test inputs: application capture never reads this fixture. */
function capturedPose(): ProcessedPose {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }))
  landmarks[0] = { x: 0.5, y: 0.15, z: 0, visibility: 0.95 }
  landmarks[11] = { x: 0.65, y: 0.4, z: 0, visibility: 0.95 }
  landmarks[12] = { x: 0.35, y: 0.4, z: 0, visibility: 0.95 }
  landmarks[13] = { x: 0.7, y: 0.6, z: 0, visibility: 0.95 }
  landmarks[14] = { x: 0.3, y: 0.6, z: 0, visibility: 0.95 }
  landmarks[15] = { x: 0.6, y: 0.25, z: 0, visibility: 0.95 }
  landmarks[16] = { x: 0.4, y: 0.25, z: 0, visibility: 0.95 }
  return { timestamp: now, landmarks, worldLandmarks: [], confidence: 0.95,
    visibleCount: 9, upperBodyVisibleCount: 9, status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0 }
}

function advance(seconds: number, capture = true) {
  for (let elapsed = 0; elapsed < seconds - 1e-8;) {
    const dt = Math.min(1 / 60, seconds - elapsed)
    elapsed += dt
    now += dt * 1000
    if (capture) publishPose(capturedPose())
    runtime.step(dt)
  }
}

beforeEach(() => {
  now = 1000
  resetAnimationSignals()
  combatMotionRuntime.reset()
  useLabStore.setState({ session: { status: 'running', delegate: 'CPU', error: null }, mirrored: false })
  useRobotStore.setState({ mode: 'tracking' })
  vi.spyOn(combatMotionRuntime, 'calibrated', 'get').mockReturnValue(true)
  vi.spyOn(combatMotionRuntime, 'motionValid', 'get').mockReturnValue(true)
  publishPose(capturedPose())
  runtime = new MatchRuntime(() => now)
  runtime.step(0)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  publishPose(null)
  resetAnimationSignals()
  combatMotionRuntime.reset()
  useLabStore.setState({ session: { status: 'idle', delegate: null, error: null } })
  useRobotStore.setState({ mode: 'tracking' })
  runtime.reset()
})

describe('capture and match bridge', () => {
  it('unlocks a real-source match only after the actual calibrator and extractor accept both postures', () => {
    vi.restoreAllMocks()
    expect(runtime.start('webcam')).toBe(false)
    combatMotionRuntime.startCalibration()
    for (let index = 0; index <= 30; index++) {
      now = 1000 + index * 50
      const base = capturedPose()
      const sample = { ...base, landmarks: base.landmarks.map((point, landmark) =>
        landmark === 15 ? { ...point, x: 0.72, y: 0.84 }
          : landmark === 16 ? { ...point, x: 0.28, y: 0.84 } : point) }
      publishPose(sample)
      combatMotionRuntime.process(sample)
      runtime.step(0.05)
    }
    expect(combatMotionRuntime.calibrated).toBe(false)
    for (let index = 0; index <= 25; index++) {
      now = 2550 + index * 50
      const sample = capturedPose()
      publishPose(sample)
      combatMotionRuntime.process(sample)
      runtime.step(0.05)
    }
    expect(combatMotionRuntime.calibrated).toBe(true)
    expect(combatMotionRuntime.motionValid).toBe(true)
    expect(useMatchStore.getState().canFight).toBe(true)
    expect(runtime.start('webcam')).toBe(true)
  })

  it('rejects live starts without calibration, without changing the camera source', () => {
    vi.spyOn(combatMotionRuntime, 'calibrated', 'get').mockReturnValue(false)
    expect(runtime.start('webcam')).toBe(false)
    expect(runtime.snapshot.phase).toBe('ready')
    expect(useRobotStore.getState().mode).toBe('tracking')
    expect(useMatchStore.getState().canFight).toBe(false)
  })

  it.each(['stopped', 'stale', 'invalid'] as const)('rejects a %s capture even with a calibration profile', (reason) => {
    if (reason === 'stopped') useLabStore.setState({ session: { status: 'idle', delegate: null, error: null } })
    if (reason === 'stale') now += 401
    if (reason === 'invalid') vi.spyOn(combatMotionRuntime, 'motionValid', 'get').mockReturnValue(false)
    expect(runtime.start('webcam')).toBe(false)
  })

  it('consumes pre-match and countdown pulses, then accepts one new real-source attack', () => {
    publishAnimationGesture({ type: 'PUNCH_LEFT', confidence: 0.95, timestamp: now })
    expect(runtime.start('webcam')).toBe(true)
    advance(1)
    publishAnimationGesture({ type: 'PUNCH_RIGHT', confidence: 0.95, timestamp: now })
    advance(2.2)
    expect(runtime.snapshot.phase).toBe('fighting')
    expect(runtime.snapshot.playerStats.attacks).toBe(0)
    publishAnimationGesture({ type: 'PUNCH_LEFT', confidence: 0.95, timestamp: now })
    advance(0.1)
    expect(runtime.snapshot.playerStats.attacks).toBe(1)
    advance(0.8)
    expect(runtime.snapshot.playerStats.attacks).toBe(1)
  })

  it('pauses on signal loss and discards paused attacks before an explicit resume', () => {
    runtime.start('webcam')
    advance(3.2)
    const time = runtime.snapshot.secondsLeft
    publishPose(null)
    advance(1, false)
    expect(runtime.snapshot.pauseReason).toBe('tracking')
    expect(runtime.snapshot.secondsLeft).toBe(time)
    publishAnimationGesture({ type: 'PUNCH_LEFT', confidence: 0.95, timestamp: now })
    publishPose(capturedPose())
    runtime.step(0)
    expect(runtime.snapshot.pauseReason).toBe('tracking')
    expect(runtime.resume()).toBe(true)
    advance(0.3)
    expect(runtime.snapshot.playerStats.attacks).toBe(0)
  })

  it('does not interrupt the camera when a second start command is rejected', () => {
    expect(runtime.start('webcam')).toBe(true)
    expect(runtime.start('demo')).toBe(false)
    expect(runtime.snapshot.mode).toBe('webcam')
    expect(useRobotStore.getState().mode).toBe('tracking')
  })

  it('publishes a visible opponent preparation cue before its attack', () => {
    runtime.start('demo')
    let sawCue = false
    let endedCue = false
    for (let index = 0; index < 1000; index++) {
      advance(1 / 60, false)
      const cue = useMatchStore.getState().opponentCue
      if (cue) {
        sawCue = true
        expect(runtime.fighters.opponent.action).toBe('telegraph')
      } else if (sawCue) { endedCue = true; break }
    }
    expect(sawCue).toBe(true)
    expect(endedCue).toBe(true)
  })

  it('requires explicit resume after leaving the arena and preserves the match', () => {
    runtime.start('demo')
    advance(4, false)
    runtime.suspend('view')
    const time = runtime.snapshot.secondsLeft
    advance(1, false)
    expect(runtime.snapshot.pauseReason).toBe('view')
    expect(runtime.snapshot.secondsLeft).toBe(time)
    expect(runtime.resume()).toBe(true)
    advance(0.2, false)
    expect(runtime.snapshot.secondsLeft).toBeLessThan(time)
  })

  it('isolates programmed demo input from capture and gesture pulses', () => {
    vi.spyOn(combatMotionRuntime, 'calibrated', 'get').mockReturnValue(false)
    expect(runtime.start('demo')).toBe(true)
    expect(useRobotStore.getState().mode).toBe('demo')
    expect(useMatchStore.getState().canFight).toBe(false)
    publishAnimationGesture({ type: 'PUNCH_LEFT', confidence: 0.95, timestamp: now })
    advance(0.2, false)
    expect(runtime.snapshot.playerStats.attacks).toBe(0)
    advance(20, false)
    expect(runtime.snapshot.playerStats.attacks).toBeGreaterThan(0)
    expect(runtime.snapshot.mode).toBe('demo')
  })

  it('pauses hidden pages immediately instead of advancing a background match', () => {
    runtime.start('demo')
    advance(3.2, false)
    const time = runtime.snapshot.secondsLeft
    vi.stubGlobal('document', { hidden: true })
    advance(0.2, false)
    expect(runtime.snapshot.pauseReason).toBe('hidden')
    expect(runtime.snapshot.secondsLeft).toBe(time)
  })

  it('publishes independent UI snapshots rather than mutable simulation objects', () => {
    runtime.start('webcam')
    advance(3.2)
    const prior = useMatchStore.getState().snapshot
    expect(prior.playerStats.attacks).toBe(0)
    publishAnimationGesture({ type: 'PUNCH_LEFT', confidence: 0.95, timestamp: now })
    advance(0.2)
    expect(runtime.snapshot.playerStats.attacks).toBe(1)
    expect(prior.playerStats.attacks).toBe(0)
    expect(useMatchStore.getState().snapshot.playerStats.attacks).toBe(1)
  })

  it('delivers presentation events once, in order, and isolates failing listeners', () => {
    const received: string[] = []
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = runtime.subscribe(() => { throw new Error('effect failure') })
    const unsubscribe = runtime.subscribe((event) => received.push(event.type === 'countdown' ? `countdown:${event.value}` : event.type))
    runtime.start('demo')
    expect(received).toEqual(['countdown:3'])
    advance(3.1, false)
    expect(received).toEqual(['countdown:3', 'countdown:2', 'countdown:1', 'fight'])
    expect(runtime.snapshot.phase).toBe('fighting')
    failing()
    unsubscribe()
    advance(10, false)
    expect(received).toHaveLength(4)
    expect(console.error).toHaveBeenCalled()
  })

  it('emits no events for a rejected webcam start', () => {
    const received: unknown[] = []
    const unsubscribe = runtime.subscribe((event) => received.push(event))
    useLabStore.setState({ session: { status: 'idle', delegate: null, error: null } })
    expect(runtime.start('webcam')).toBe(false)
    advance(1, false)
    expect(received).toEqual([])
    unsubscribe()
  })
})
