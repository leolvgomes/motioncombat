import { describe, expect, it } from 'vitest'
import type { Landmark, ProcessedPose } from '../../types/motion'
import { MotionCalibrator } from './calibration'

function frame(timestamp: number, guard = false, changes: Partial<Record<number, Partial<Landmark>>> = {}): ProcessedPose {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const positions: Record<number, readonly [number, number]> = {
    0: [0.5, 0.15], 11: [0.65, 0.4], 12: [0.35, 0.4],
    13: guard ? [0.68, 0.53] : [0.66, 0.6], 14: guard ? [0.32, 0.53] : [0.34, 0.6],
    15: guard ? [0.6, 0.24] : [0.67, 0.8], 16: guard ? [0.4, 0.24] : [0.33, 0.8],
    23: [0.6, 0.9], 24: [0.4, 0.9],
  }
  for (const [key, [x, y]] of Object.entries(positions)) {
    const index = Number(key)
    landmarks[index] = { x, y, z: 0, visibility: 0.95, ...changes[index] }
  }
  const worldLandmarks = landmarks.map((point) => ({ ...point, x: 0, y: 0, z: 0 }))
  const world: Record<number, readonly [number, number, number]> = {
    11: [0.2, -0.2, 0], 12: [-0.2, -0.2, 0],
    13: guard ? [0.23, 0.08, -0.04] : [0.21, 0.1, -0.02],
    14: guard ? [-0.23, 0.08, -0.04] : [-0.21, 0.1, -0.02],
    15: guard ? [0.14, -0.22, -0.15] : [0.22, 0.39, -0.04],
    16: guard ? [-0.14, -0.22, -0.15] : [-0.22, 0.39, -0.04],
  }
  for (const [key, [x, y, z]] of Object.entries(world)) worldLandmarks[Number(key)] = { x, y, z, visibility: 0.95 }
  return {
    timestamp, landmarks, worldLandmarks, confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9,
    status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0,
  }
}

function hold(calibrator: MotionCalibrator, start: number, duration: number, guard = false) {
  for (let time = start; time <= start + duration; time += 50) calibrator.update(frame(time, guard))
  return calibrator.snapshot
}

describe('MotionCalibrator', () => {
  it('requires explicit start and a complete 1.5-second neutral hold', () => {
    const calibrator = new MotionCalibrator()
    hold(calibrator, 0, 2000)
    expect(calibrator.snapshot.stage).toBe('idle')
    calibrator.start()
    expect(hold(calibrator, 0, 1450).stage).toBe('neutral')
    expect(calibrator.snapshot.progress).toBeCloseTo(1450 / 1500)
    expect(calibrator.update(frame(1500)).stage).toBe('guard')
    expect(calibrator.snapshot.progress).toBe(0)
    expect(calibrator.snapshot.profile).toBeNull()
  })

  it('completes only after the separate guard hold and captures actual references', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1500)
    expect(hold(calibrator, 1550, 1150, true).stage).toBe('guard')
    expect(calibrator.snapshot.profile).toBeNull()
    const result = calibrator.update(frame(2750, true))
    expect(result.stage).toBe('complete')
    expect(result.progress).toBe(1)
    expect(result.profile?.capturedAt).toBe(2750)
    expect(result.profile?.shoulderWidth).toBeCloseTo(0.3)
    expect(result.profile?.worldShoulderWidth).toBeCloseTo(0.4)
    expect(result.profile?.guardLeft.x).toBeCloseTo(1 / 3)
    expect(result.profile?.guardLeft.y).toBeCloseTo(0.16 / 0.3)
    expect(result.profile?.guardLeft.z).toBeCloseTo(0.375)
    expect(result.profile?.guardRight.x).toBeCloseTo(-1 / 3)
  })

  it('cannot complete neutral while the player is already holding guard', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 4000, true)
    expect(calibrator.snapshot.stage).toBe('neutral')
    expect(calibrator.snapshot.progress).toBe(0)
    expect(calibrator.snapshot.profile).toBeNull()
  })

  it('accepts visible hands in front of the waist with slightly bent elbows', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    for (let time = 0; time <= 1500; time += 50) {
      calibrator.update(frame(time, false, { 15: { x: 0.6, y: 0.68 }, 16: { x: 0.4, y: 0.68 } }))
    }
    expect(calibrator.snapshot.stage).toBe('guard')
  })

  it('cannot calibrate guard with hands down or far from the head', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1500)
    hold(calibrator, 1550, 3000)
    expect(calibrator.snapshot.stage).toBe('guard')
    expect(calibrator.snapshot.progress).toBe(0)
    for (let time = 4600; time <= 6600; time += 50) {
      calibrator.update(frame(time, true, { 15: { x: 0.95 }, 16: { x: 0.05 } }))
    }
    expect(calibrator.snapshot.stage).toBe('guard')
    expect(calibrator.snapshot.progress).toBe(0)
  })

  it('resets neutral progress when tracking is lost and counts no missing elapsed time', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    expect(hold(calibrator, 0, 1000).progress).toBeGreaterThan(0.6)
    expect(calibrator.update(null).progress).toBe(0)
    expect(calibrator.update(frame(5000)).progress).toBe(0)
    expect(hold(calibrator, 5050, 1000).stage).toBe('neutral')
  })

  it.each([0, 11, 13, 15])('restarts the hold when required landmark %s has insufficient confidence', (index) => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1000)
    const lost = calibrator.update(frame(1050, false, { [index]: { visibility: 0.6 } }))
    expect(lost.progress).toBe(0)
    expect(lost.stage).toBe('neutral')
    expect(lost.profile).toBeNull()
  })

  it('restarts a guard hold after occlusion without losing the neutral reference', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1500)
    expect(hold(calibrator, 1550, 800, true).progress).toBeGreaterThan(0.6)
    calibrator.update(frame(2400, true, { 16: { visibility: 0 } }))
    expect(calibrator.snapshot.stage).toBe('guard')
    expect(calibrator.snapshot.progress).toBe(0)
    expect(hold(calibrator, 2450, 1200, true).stage).toBe('complete')
  })

  it('does not bridge a large timestamp gap or duplicate timestamp into a hold', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1000)
    expect(calibrator.update(frame(5000)).progress).toBe(0)
    hold(calibrator, 5050, 500)
    expect(calibrator.update(frame(5550)).progress).toBe(0)
    expect(calibrator.snapshot.stage).toBe('neutral')
  })

  it('resets progress when wrists move too quickly despite staying visible', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1000)
    const moving = calibrator.update(frame(1050, false, { 15: { x: 0.77 } }))
    expect(moving.stage).toBe('neutral')
    expect(moving.progress).toBe(0)
    expect(moving.message).toContain('parados')
  })

  it('supports 2D-only calibration without inventing world depth references', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    for (let time = 0; time <= 1500; time += 50) calibrator.update({ ...frame(time), worldLandmarks: [] })
    for (let time = 1550; time <= 2750; time += 50) calibrator.update({ ...frame(time, true), worldLandmarks: [] })
    expect(calibrator.snapshot.stage).toBe('complete')
    expect(calibrator.snapshot.profile?.worldShoulderWidth).toBeNull()
    expect(calibrator.snapshot.profile?.guardLeft.z).toBe(0)
    expect(calibrator.snapshot.profile?.guardRight.z).toBe(0)
  })

  it('captures the neutral torso offset without interpreting it as a dodge', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    for (let time = 0; time <= 1500; time += 50) calibrator.update({ ...frame(time), torsoLean: 0.12 })
    for (let time = 1550; time <= 2750; time += 50) calibrator.update({ ...frame(time, true), torsoLean: 0.12 })
    expect(calibrator.snapshot.profile?.neutralTorsoLean).toBeCloseTo(0.12)
  })

  it('keeps completed references during temporary loss until explicit reset', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1500)
    const completed = hold(calibrator, 1550, 1200, true)
    expect(calibrator.update(null)).toBe(completed)
    calibrator.reset()
    expect(calibrator.snapshot).toEqual(expect.objectContaining({ stage: 'idle', profile: null, progress: 0 }))
  })

  it('cancels or restarts cleanly without preserving an old profile', () => {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    hold(calibrator, 0, 1500)
    hold(calibrator, 1550, 1200, true)
    calibrator.cancel()
    expect(calibrator.snapshot.stage).toBe('idle')
    expect(calibrator.snapshot.profile).toBeNull()
    calibrator.start()
    expect(calibrator.snapshot.stage).toBe('neutral')
    expect(calibrator.snapshot.profile).toBeNull()
    expect(calibrator.snapshot.progress).toBe(0)
  })
})
