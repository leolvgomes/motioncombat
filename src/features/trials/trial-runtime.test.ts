import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProtocol, parseRecording } from '../../engine/motion/trials'
import { emptyCombatMotionSnapshot, useCombatMotionStore } from '../../stores/combat-motion-store'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { useTrialStore } from '../../stores/trial-store'
import type { CalibrationProfile, CalibrationSnapshot } from '../../types/combat-motion'
import type { PoseFrame } from '../../types/motion'
import { EMPTY_SESSION_METRICS } from '../motion-tracking/tracking-session'
import { MEASURE_MS, TrialRuntime } from './trial-runtime'

const profile: CalibrationProfile = {
  capturedAt: 0, shoulderWidth: 0.3, worldShoulderWidth: null, neutralTorsoLean: 0,
  guardLeft: { x: 0.35, y: 0.5, z: 0 }, guardRight: { x: -0.35, y: 0.5, z: 0 }, upperArm: 0.8, forearm: 0.7,
}
let now = 0
let runtime: TrialRuntime

const frame = (): PoseFrame => ({ timestamp: now, landmarks: [], worldLandmarks: [] })
const metrics = (overrides = {}) => ({ ...EMPTY_SESSION_METRICS, inferenceFps: 16, inferenceMs: 50, latencyMs: 60, worstFrameMs: 25, threaded: true, ...overrides })
function calibrate(stage: CalibrationSnapshot['stage'], value: CalibrationProfile | null = profile) {
  useCombatMotionStore.getState().publish({ ...emptyCombatMotionSnapshot(), calibration: { stage, progress: 1, message: '', profile: stage === 'complete' ? value : null } })
}

beforeEach(() => {
  now = 1000
  useLabStore.setState({ session: { status: 'running', error: null, delegate: 'GPU' } })
  useRobotStore.setState({ mode: 'tracking' })
  useTrialStore.setState({ progress: null, result: null, interruption: null, measuring: null, performance: null, performanceError: null })
  calibrate('complete')
  runtime = new TrialRuntime(() => now, () => new Date('2026-11-26T12:00:00Z'))
})

describe('guided trial runtime', () => {
  it.each(['camera', 'calibration', 'demo'] as const)('does not start without %s', (missing) => {
    if (missing === 'camera') useLabStore.setState({ session: { status: 'idle', error: null, delegate: null } })
    if (missing === 'calibration') calibrate('idle')
    if (missing === 'demo') useRobotStore.setState({ mode: 'demo' })
    expect(runtime.start(3)).toBe(false)
    expect(runtime.running).toBe(false)
  })

  it('runs the whole script, cues once per phase and publishes a valid in-memory recording', () => {
    const steps = buildProtocol(3)
    const cues = { prepare: vi.fn(), go: vi.fn() }
    expect(runtime.start(3)).toBe(true)
    expect(runtime.start(3)).toBe(false)
    const end = now + steps.at(-1)!.endsAt
    const punched = new Set<number>()
    for (; now <= end; now += 50) {
      runtime.onFrame(frame())
      const step = steps.find(({ endsAt }) => now - 1000 < endsAt)
      if (step?.expected && now - 1000 >= step.cueAt + 300 && !punched.has(step.index)) {
        punched.add(step.index)
        runtime.onGesture({ type: step.expected, timestamp: now, confidence: 0.9 })
      }
      if ((now / 50) % 5 === 0) runtime.onMetrics(metrics())
      runtime.tick(cues)
    }
    const { result, progress } = useTrialStore.getState()
    expect(progress).toBeNull()
    expect(runtime.running).toBe(false)
    expect(result?.summary).toMatchObject({ accuracy: 1, idleFalsePositives: 0, strayAttacks: 0 })
    expect(result?.performance).toMatchObject({ threaded: true, trackingHz: { median: 16 } })
    expect(parseRecording(JSON.stringify(result?.recording))).not.toBeNull()
    expect(cues.go).toHaveBeenCalledTimes(steps.length)
    // The first preparation is announced by start itself.
    expect(cues.prepare).toHaveBeenCalledTimes(steps.length - 1)
    runtime.discard()
    expect(useTrialStore.getState().result).toBeNull()
  })

  it('keeps bounded calibration frames from the last calibration only', () => {
    calibrate('neutral')
    for (let index = 0; index < 500; index++) { now += 33; runtime.onFrame(frame()) }
    calibrate('complete')
    runtime.start(3)
    now += buildProtocol(3).at(-1)!.endsAt
    runtime.tick()
    expect(useTrialStore.getState().result?.recording.calibrationFrames).toHaveLength(360)
  })

  it('stops with an explanation on recalibration and when the camera ends', () => {
    runtime.start(3)
    calibrate('complete', { ...profile, capturedAt: 5 })
    runtime.onFrame(frame())
    expect(runtime.running).toBe(false)
    expect(useTrialStore.getState()).toMatchObject({ progress: null, interruption: expect.stringContaining('calibração') })
    runtime.start(3)
    expect(useTrialStore.getState().interruption).toBeNull()
    runtime.onSessionEnded()
    expect(useTrialStore.getState()).toMatchObject({ progress: null, interruption: expect.stringContaining('câmera') })
    expect(useTrialStore.getState().result).toBeNull()
  })
})

describe('timed measurement', () => {
  it('measures for a fixed time and reports', () => {
    expect(runtime.measure()).toBe(true)
    expect(runtime.measure()).toBe(false)
    for (let elapsed = 0; elapsed <= MEASURE_MS; elapsed += 250) { now = 1000 + elapsed; runtime.onMetrics(metrics()) }
    expect(useTrialStore.getState()).toMatchObject({ measuring: null, performanceError: null, performance: { latencyMs: { median: 60 } } })
  })

  it('explains a measurement without detections or interrupted by the camera', () => {
    runtime.measure()
    for (let elapsed = 0; elapsed <= MEASURE_MS; elapsed += 250) { now = 1000 + elapsed; runtime.onMetrics(metrics({ inferenceFps: 0 })) }
    expect(useTrialStore.getState()).toMatchObject({ performance: null, performanceError: expect.stringContaining('poucas') })
    runtime.measure()
    runtime.onSessionEnded()
    expect(useTrialStore.getState()).toMatchObject({ measuring: null, performanceError: expect.stringContaining('câmera') })
  })
})
