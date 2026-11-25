import { describe, expect, it } from 'vitest'
import type { Landmark, PoseFrame } from '../../types/motion'
import type { CalibrationProfile } from '../../types/combat-motion'
import { MotionCalibrator } from './calibration'
import { PerformanceSampler } from './performance-sampler'
import { PoseProcessor, TRACKED_LANDMARKS, smoothingTime } from './pose-processor'
import { TrialRunner, WORLD_POINTS, buildProtocol, decodeFrame, encodeFrame, evaluateRecording, parseRecording, scoreTrials } from './trials'
import type { TrialEvent, TrialGesture, TrialRecording } from './trials'

const ASPECT = 16 / 9

/** A person drawn in pixels of a 16:9 image; punch is the left arm's progress towards the camera. */
function bodyFrame(timestamp: number, pose: 'neutral' | 'guard', punch = 0): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const place = (index: number, x: number, y: number) => { landmarks[index] = { x: 0.5 + x * 0.15, y: 0.35 - y * 0.15 * ASPECT, z: 0, visibility: 0.95 } }
  place(0, 0, 0.7)
  place(11, 1, 0)
  place(12, -1, 0)
  place(23, 0.7, -2.6)
  place(24, -0.7, -2.6)
  for (const side of [1, -1] as const) {
    const progress = side === 1 ? punch : 0
    const upper = -0.75 + 0.85 * progress
    const forearm = 1.45 - 1.25 * progress
    const elbowY = pose === 'guard' ? Math.sin(upper) * 1.2 : -1.2
    const wristY = pose === 'guard' ? elbowY + Math.sin(forearm) * 1.5 : -2.3
    place(side === 1 ? 13 : 14, side * 1.1, elbowY)
    place(side === 1 ? 15 : 16, side * (pose === 'guard' ? 0.95 : 1.1), wristY)
  }
  return { timestamp, landmarks, worldLandmarks: [] }
}

function calibrated(processor: PoseProcessor, frames: readonly PoseFrame[]): CalibrationProfile {
  const calibrator = new MotionCalibrator()
  calibrator.start()
  for (const frame of frames) calibrator.update(processor.process(frame))
  const { profile } = calibrator.snapshot
  if (!profile) throw new Error(`Calibration stopped: ${calibrator.snapshot.stage}`)
  return profile
}

describe('trial protocol', () => {
  it('is contiguous, deterministic and covers every attack, both dodges and everyday movement', () => {
    const steps = buildProtocol(3)
    expect(buildProtocol(3)).toEqual(steps)
    steps.forEach((step, index) => {
      expect(step.index).toBe(index)
      expect(step.startsAt).toBe(index === 0 ? 0 : steps[index - 1]!.endsAt)
      expect(step.cueAt).toBeGreaterThan(step.startsAt)
      expect(step.endsAt).toBeGreaterThan(step.cueAt)
    })
    const gestures = new Set(steps.flatMap(({ expected }) => expected ? [expected] : []))
    expect(gestures.size).toBe(8)
    expect(steps.filter(({ expected }) => expected === 'HOOK_RIGHT')).toHaveLength(3)
    expect(steps.filter(({ expected }) => expected === null)).toHaveLength(3)
    expect(steps.at(-1)!.endsAt).toBeLessThan(120_000)
  })
})

describe('trial scoring', () => {
  const steps = buildProtocol(2)
  const cue = (gesture: TrialGesture, repetition = 1) => steps.find((step) => step.expected === gesture && step.repetition === repetition)!.cueAt
  const perfect = (): TrialEvent[] => steps.flatMap(({ expected, cueAt }) => expected ? [{ type: expected, time: cueAt + 400 }] : [])

  it('recognizes a perfect session', () => {
    const summary = scoreTrials(steps, [...perfect(), { type: 'GUARD', time: 10 }])
    expect(summary).toMatchObject({ accuracy: 1, idleFalsePositives: 0, strayAttacks: 0 })
    expect(summary.gestures.every(({ correct, total, missed, medianDelayMs }) => correct === total && missed === 0 && medianDelayMs === 400)).toBe(true)
  })

  it('separates misses, confusions, extras, stray and idle attacks', () => {
    const events = perfect().filter(({ time }) => time !== cue('PUNCH_LEFT') + 400 && time !== cue('HOOK_LEFT') + 400)
    events.push({ type: 'PUNCH_LEFT', time: cue('HOOK_LEFT') + 300 })
    events.push({ type: 'PUNCH_RIGHT', time: cue('PUNCH_RIGHT') + 900 })
    events.push({ type: 'UPPERCUT_LEFT', time: cue('UPPERCUT_LEFT') - 600 })
    const idle = steps.find(({ expected }) => expected === null)!
    events.push({ type: 'HOOK_RIGHT', time: idle.cueAt + 100 }, { type: 'DODGE_LEFT', time: idle.cueAt + 200 })
    const summary = scoreTrials(steps, events)
    const score = (gesture: TrialGesture) => summary.gestures.find((item) => item.gesture === gesture)!
    expect(score('PUNCH_LEFT')).toMatchObject({ total: 2, correct: 1, missed: 1 })
    expect(score('HOOK_LEFT')).toMatchObject({ correct: 1, missed: 0, confusedWith: { PUNCH_LEFT: 1 } })
    expect(score('PUNCH_RIGHT')).toMatchObject({ correct: 2, extra: 1 })
    expect(summary).toMatchObject({ idleFalsePositives: 1, strayAttacks: 1 })
    expect(summary.results.find(({ outcome }) => outcome === 'false-positive')?.detected).toEqual(['HOOK_RIGHT'])
    expect(summary.accuracy).toBeLessThan(1)
  })

  it('accepts slight anticipation, ignores a lean during a punch and judges the first attack', () => {
    const at = cue('PUNCH_LEFT')
    const step = steps.filter(({ cueAt }) => cueAt === at)
    expect(scoreTrials(step, [{ type: 'PUNCH_LEFT', time: at - 200 }]).accuracy).toBe(1)
    expect(scoreTrials(step, [{ type: 'PUNCH_LEFT', time: at - 400 }]).accuracy).toBe(0)
    expect(scoreTrials(step, [{ type: 'DODGE_LEFT', time: at + 100 }, { type: 'PUNCH_LEFT', time: at + 300 }]).accuracy).toBe(1)
    expect(scoreTrials(step, [{ type: 'HOOK_LEFT', time: at + 100 }, { type: 'PUNCH_LEFT', time: at + 300 }]).results[0]?.outcome).toBe('confused')
  })
})

describe('recorded frames', () => {
  it('round-trip the tracked joints within the stored precision and drop everything else', () => {
    const source = bodyFrame(1234.56, 'guard', 0.4)
    const world = source.landmarks.map((point, index) => ({ ...point, x: index / 100, z: -0.2 }))
    const encoded = encodeFrame({ ...source, worldLandmarks: world }, 1000)
    const decoded = decodeFrame(encoded)
    expect(decoded.timestamp).toBeCloseTo(234.6, 1)
    for (const index of TRACKED_LANDMARKS) expect(decoded.landmarks[index]!.x).toBeCloseTo(source.landmarks[index]!.x, 3)
    for (const index of WORLD_POINTS) expect(decoded.worldLandmarks[index]!.z).toBeCloseTo(-0.2, 3)
    expect(decoded.landmarks[1]!.visibility).toBe(0)
    expect(decodeFrame(encodeFrame({ timestamp: 1, landmarks: [], worldLandmarks: [] }, 0)).landmarks).toEqual([])
  })
})

/** Twelve punches recorded through the real chain, at the given rate. */
function recordSession(fps: number): TrialRecording {
  const interval = 1000 / fps
  const calibration: PoseFrame[] = []
  for (let time = 0; time < 2000; time += interval) calibration.push(bodyFrame(time, 'neutral'))
  for (let time = 2000; time < 4500; time += interval) calibration.push(bodyFrame(time, 'guard'))
  const profile = calibrated(new PoseProcessor(), calibration)
  const origin = 5000
  const steps = buildProtocol(3).slice(0, 3)
  const runner = new TrialRunner(steps, origin)
  for (let time = 0; time < steps.at(-1)!.endsAt; time += interval) {
    const step = steps.find(({ endsAt }) => time < endsAt)!
    const since = time - step.cueAt - 300
    const punch = since < 0 ? 0 : since < 180 ? since / 180 : since < 260 ? 1 : since < 460 ? 1 - (since - 260) / 200 : 0
    runner.pushFrame(bodyFrame(origin + time, 'guard', punch))
  }
  return runner.finish({ recordedAt: '2026-11-26T12:00:00.000Z', aspectRatio: ASPECT, advancedAttacks: true, profile, performance: null, calibration }).recording
}

describe('offline evaluation', () => {
  it.each([16, 24, 30])('finds every recorded punch again at %s Hz, with both filters', (fps) => {
    const recording = recordSession(fps)
    for (const adaptive of [true, false]) {
      const summary = evaluateRecording(recording, { adaptive })!
      expect(summary.gestures[0]).toMatchObject({ gesture: 'PUNCH_LEFT', correct: 3, missed: 0, extra: 0 })
      expect(summary.strayAttacks).toBe(0)
    }
  })

  it('recognizes a punch sooner with the adaptive filter', () => {
    const recording = recordSession(24)
    const delay = (adaptive: boolean) => evaluateRecording(recording, { adaptive })!.gestures[0]!.medianDelayMs!
    expect(delay(true)).toBeLessThan(delay(false))
  })

  it('can recalibrate in a uniform metric and imitate a slower device', () => {
    const recording = recordSession(30)
    expect(evaluateRecording(recording, { aspectCorrected: true })).not.toBeNull()
    expect(evaluateRecording({ ...recording, calibrationFrames: [] }, { aspectCorrected: true })).toBeNull()
    expect(evaluateRecording(recording, { keepEvery: 2 })!.gestures[0]!.total).toBe(3)
  })

  it('survives a JSON round trip and rejects anything else', () => {
    const recording = recordSession(16)
    const parsed = parseRecording(JSON.stringify(recording))!
    expect(evaluateRecording(parsed)).toEqual(evaluateRecording(recording))
    for (const invalid of ['', 'null', '[]', '{}', JSON.stringify({ ...recording, version: 2 }), JSON.stringify({ ...recording, frames: [[1, 2]] }), JSON.stringify({ ...recording, steps: [] })]) {
      expect(parseRecording(invalid)).toBeNull()
    }
  })
})

describe('TrialRunner', () => {
  it('walks through preparation, cue and feedback, and ignores data from before the start', () => {
    const steps = buildProtocol(2)
    const runner = new TrialRunner(steps, 1000)
    runner.pushFrame(bodyFrame(900, 'guard'))
    runner.pushEvent({ type: 'PUNCH_LEFT', timestamp: 950, confidence: 1 })
    expect(runner.progress(1000)).toMatchObject({ phase: 'intro', lastResult: null })
    expect(runner.progress(1000 + steps[0]!.cueAt)).toMatchObject({ phase: 'go' })
    runner.pushEvent({ type: 'PUNCH_LEFT', timestamp: 1000 + steps[0]!.cueAt + 350, confidence: 1 })
    const next = runner.progress(1000 + steps[1]!.startsAt)
    expect(next).toMatchObject({ phase: 'prepare', lastResult: { outcome: 'correct', delayMs: 350 } })
    expect(runner.finished(1000 + steps.at(-1)!.endsAt - 1)).toBe(false)
    expect(runner.finished(1000 + steps.at(-1)!.endsAt)).toBe(true)
    const { recording } = runner.finish({ recordedAt: '', aspectRatio: 1, advancedAttacks: true, profile: {} as CalibrationProfile, performance: null, calibration: [] })
    expect(recording.frames).toHaveLength(0)
    expect(recording.events).toEqual([{ type: 'PUNCH_LEFT', time: steps[0]!.cueAt + 350 }])
  })
})

describe('adaptive smoothing', () => {
  const wristAt = (positions: readonly number[], adaptive: boolean, interval = 1000 / 24) => {
    const processor = new PoseProcessor({ adaptive })
    return positions.map((offset, index) => {
      const source = bodyFrame(index * interval, 'guard')
      const landmarks = source.landmarks.map((point, landmark) => landmark === 15 ? { ...point, x: point.x + offset } : point)
      return processor.process({ ...source, landmarks }).landmarks[15]!.x - source.landmarks[15]!.x
    })
  }

  it('follows sustained fast motion much more closely', () => {
    const ramp = [0, 0, 0.06, 0.12, 0.18, 0.24, 0.3]
    const error = (adaptive: boolean) => ramp.at(-1)! - wristAt(ramp, adaptive).at(-1)!
    expect(error(true)).toBeLessThan(error(false) * 0.65)
  })

  it('treats an isolated misplaced detection exactly like the fixed filter', () => {
    const glitch = [0, 0, 0, 0.3, 0, 0, 0]
    wristAt(glitch, true).forEach((value, index) => expect(value).toBeCloseTo(wristAt(glitch, false)[index]!, 10))
  })

  it('keeps alternating jitter fully smoothed', () => {
    const jitter = Array.from({ length: 30 }, (_, index) => index % 2 ? 0.004 : -0.004)
    expect(wristAt(jitter, true)).toEqual(wristAt(jitter, false))
  })

  it('bounds the smoothing time and needs agreement between movements', () => {
    expect(smoothingTime({ velocityX: 0, velocityY: 0 }, 5, 0, 0.3)).toBe(80)
    expect(smoothingTime({ velocityX: -5, velocityY: 0 }, 5, 0, 0.3)).toBe(80)
    expect(smoothingTime({ velocityX: 0.1, velocityY: 0 }, 5, 0, 0.3)).toBe(80)
    expect(smoothingTime({ velocityX: 9, velocityY: 0 }, 9, 0, 0.3)).toBe(28)
    expect(smoothingTime({ velocityX: 9, velocityY: 0 }, 9, 0, 0)).toBe(28)
  })
})

describe('PerformanceSampler', () => {
  const sample = (trackingHz: number, sceneFps: number | null = 30) => ({ sceneFps, trackingHz, inferenceMs: 50, latencyMs: 60, worstFrameMs: 25 })

  it('reports robust ranges and needs enough data', () => {
    const sampler = new PerformanceSampler()
    for (let index = 0; index < 7; index++) sampler.add(sample(16), true)
    expect(sampler.report()).toBeNull()
    for (let index = 0; index < 33; index++) sampler.add(sample(16 + index % 4), true)
    expect(sampler.report()).toMatchObject({ samples: 40, threaded: true, sceneFps: { median: 30 }, latencyMs: { median: 60, low: 60, high: 60 } })
  })

  it('skips empty windows and tolerates a closed scene', () => {
    const sampler = new PerformanceSampler()
    for (let index = 0; index < 10; index++) { sampler.add(sample(0), false); sampler.add(sample(18, null), false) }
    expect(sampler.count).toBe(10)
    expect(sampler.report()).toMatchObject({ threaded: false, sceneFps: null, trackingHz: { median: 18 } })
  })
})
