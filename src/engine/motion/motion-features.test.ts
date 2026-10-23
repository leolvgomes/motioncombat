import { describe, expect, it } from 'vitest'
import type { CalibrationProfile } from '../../types/combat-motion'
import type { Landmark, ProcessedPose } from '../../types/motion'
import { MotionFeatureExtractor } from './motion-features'

function pose(timestamp = 0, changes: Partial<Record<number, Partial<Landmark>>> = {}): ProcessedPose {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const positions: Record<number, readonly [number, number]> = {
    0: [0.5, 0.15], 11: [0.65, 0.4], 12: [0.35, 0.4], 13: [0.66, 0.6], 14: [0.34, 0.6],
    15: [0.67, 0.8], 16: [0.33, 0.8], 23: [0.6, 0.9], 24: [0.4, 0.9],
  }
  for (const [key, [x, y]] of Object.entries(positions)) {
    const index = Number(key)
    landmarks[index] = { x, y, z: 0, visibility: 0.95, ...changes[index] }
  }
  const worldLandmarks = landmarks.map((point) => ({ ...point, x: 0, y: 0, z: 0 }))
  const world: Record<number, readonly [number, number, number]> = {
    11: [0.2, -0.2, 0], 12: [-0.2, -0.2, 0], 13: [0.21, 0.1, -0.02],
    14: [-0.21, 0.1, -0.02], 15: [0.22, 0.39, -0.04], 16: [-0.22, 0.39, -0.04],
  }
  for (const [key, [x, y, z]] of Object.entries(world)) worldLandmarks[Number(key)] = { x, y, z, visibility: 0.95 }
  return {
    timestamp, landmarks, worldLandmarks, confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9,
    status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0,
  }
}

const PROFILE: CalibrationProfile = {
  capturedAt: 0, shoulderWidth: 0.3, worldShoulderWidth: 0.4, neutralTorsoLean: 0,
  guardLeft: { x: 0.33, y: 0.55, z: 0.4 }, guardRight: { x: -0.33, y: 0.55, z: 0.4 },
}

function depth(source: ProcessedPose, index: number, z: number): ProcessedPose {
  return { ...source, worldLandmarks: source.worldLandmarks.map((point, key) => key === index ? { ...point, z } : point) }
}

describe('MotionFeatureExtractor', () => {
  it('uses raw anatomical labels, shoulder-relative coordinates and zero first velocities', () => {
    const features = new MotionFeatureExtractor().update(pose(), PROFILE)
    expect(features.valid).toBe(true)
    expect(features.depthAvailable).toBe(true)
    expect(features.leftArm?.wrist.x).toBeGreaterThan(0)
    expect(features.rightArm?.wrist.x).toBeLessThan(0)
    expect(features.leftArm?.wrist.y).toBeCloseTo(-4 / 3)
    expect(features.leftArm?.wrist.z).toBeCloseTo(0.1)
    expect(features.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(features.leftArm?.depthAvailable).toBe(true)
    expect(features.leftArm?.forwardEvidence).toBe(false)
  })

  it('keeps normalized features invariant when image position and distance change', () => {
    const original = pose()
    const resized = {
      ...original,
      landmarks: original.landmarks.map((point) => ({ ...point, x: 0.54 + (point.x - 0.5) * 0.5, y: 0.42 + (point.y - 0.4) * 0.5 })),
    }
    const first = new MotionFeatureExtractor().update(original, PROFILE)
    const second = new MotionFeatureExtractor().update(resized, PROFILE)
    expect(second.leftArm?.wrist.x).toBeCloseTo(first.leftArm?.wrist.x ?? 0)
    expect(second.leftArm?.wrist.y).toBeCloseTo(first.leftArm?.wrist.y ?? 0)
    expect(second.leftArm?.extension).toBeCloseTo(first.leftArm?.extension ?? 0)
  })

  it('does not turn global body translation or approach into wrist velocity', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(pose(), PROFILE)
    const next = pose(50)
    const translated = {
      ...next,
      landmarks: next.landmarks.map((point) => ({ ...point, x: point.x + 0.02, y: point.y - 0.01 })),
      worldLandmarks: next.worldLandmarks.map((point) => ({ ...point, x: point.x + 0.1, y: point.y - 0.1, z: point.z + 0.7 })),
    }
    const features = extractor.update(translated, PROFILE)
    expect(features.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(features.rightArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(features.leftArm?.forwardEvidence).toBe(false)
  })

  it('keeps velocity zero under proportional image zoom with unchanged relative posture', () => {
    const extractor = new MotionFeatureExtractor()
    const source = pose()
    extractor.update(source, PROFILE)
    const zoomed = { ...source, timestamp: 50, landmarks: source.landmarks.map((point) => ({ ...point, x: 0.5 + (point.x - 0.5) * 0.8, y: 0.4 + (point.y - 0.4) * 0.8 })) }
    expect(extractor.update(zoomed, PROFILE).leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('estimates bounded smoothed forward velocity from a plausible world chain', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(depth(pose(), 15, -0.1), PROFILE)
    const features = extractor.update(depth(pose(50), 15, -0.3), PROFILE)
    expect(features.leftArm?.velocity.z).toBeGreaterThan(3)
    expect(features.leftArm?.velocity.z).toBeLessThanOrEqual(12)
    expect(features.leftArm?.forwardEvidence).toBe(true)
    expect(features.rightArm?.velocity.z).toBe(0)
  })

  it('does not report backward retraction as forward evidence', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(depth(pose(), 15, -0.3), PROFILE)
    const features = extractor.update(depth(pose(50), 15, -0.1), PROFILE)
    expect(features.leftArm?.velocity.z).toBeLessThan(0)
    expect(features.leftArm?.forwardEvidence).toBe(false)
  })

  it('calculates a straight projected arm as extension one and elbow angle PI', () => {
    const source = pose()
    const features = new MotionFeatureExtractor().update({ ...source, worldLandmarks: [] }, PROFILE)
    expect(features.leftArm?.extension).toBeCloseTo(1)
    expect(features.leftArm?.elbowAngle).toBeCloseTo(Math.PI)
    expect(features.leftArm?.wristAboveElbow).toBeLessThan(0)
    expect(features.leftArm?.depthAvailable).toBe(false)
    expect(features.depthAvailable).toBe(false)
  })

  it('preserves fully forward arms even when their valid image projection collapses', () => {
    const source = pose(0, { 13: { x: 0.65, y: 0.4 }, 15: { x: 0.650001, y: 0.400001 } })
    const worldLandmarks = source.worldLandmarks.map((point, index) => index === 13
      ? { ...point, x: 0.2, y: -0.2, z: -0.28 }
      : index === 15 ? { ...point, x: 0.2, y: -0.2, z: -0.55 } : point)
    const features = new MotionFeatureExtractor().update({ ...source, worldLandmarks }, PROFILE)
    expect(features.leftArm).not.toBeNull()
    expect(features.leftArm?.depthAvailable).toBe(true)
    expect(features.leftArm?.extension).toBeCloseTo(1)
    expect(features.leftArm?.elbowAngle).toBeCloseTo(Math.PI)
    expect(features.leftArm?.wrist.z).toBeCloseTo(1.375)
    const hidden = { ...source, landmarks: source.landmarks.map((point, index) => index === 15 ? { ...point, visibility: 0.2 } : point), worldLandmarks }
    expect(new MotionFeatureExtractor().update(hidden, PROFILE).leftArm).toBeNull()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -10])('rejects non-finite or implausible world wrist depth %s', (z) => {
    const features = new MotionFeatureExtractor().update(depth(pose(), 15, z), PROFILE)
    expect(features.leftArm?.depthAvailable).toBe(false)
    expect(features.leftArm?.wrist.z).toBe(0)
    expect(features.leftArm?.velocity.z).toBe(0)
    expect(features.leftArm?.forwardEvidence).toBe(false)
    expect(features.rightArm?.depthAvailable).toBe(true)
    expect(features.depthAvailable).toBe(true)
  })

  it('rejects low-confidence depth while preserving valid image geometry', () => {
    const source = pose()
    const features = new MotionFeatureExtractor().update({ ...source, worldLandmarks: source.worldLandmarks.map((point) => ({ ...point, visibility: 0.2 })) }, PROFILE)
    expect(features.leftArm).not.toBeNull()
    expect(features.leftArm?.depthAvailable).toBe(false)
    expect(features.depthAvailable).toBe(false)
  })

  it('does not create a depth velocity when 2D guard tracking acquires world coordinates', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update({ ...pose(), worldLandmarks: [] }, PROFILE)
    const acquired = extractor.update(depth(pose(50), 15, -0.3), PROFILE)
    expect(acquired.leftArm?.depthAvailable).toBe(true)
    expect(acquired.leftArm?.velocity.z).toBe(0)
    expect(acquired.leftArm?.forwardEvidence).toBe(false)
    const steady = extractor.update(depth(pose(100), 15, -0.3), PROFILE)
    expect(steady.leftArm?.velocity.z).toBe(0)
    expect(steady.leftArm?.forwardEvidence).toBe(false)
    const lost = extractor.update({ ...pose(150), worldLandmarks: [] }, PROFILE)
    expect(lost.leftArm?.depthAvailable).toBe(false)
    expect(lost.leftArm?.velocity.z).toBe(0)
    const reacquired = extractor.update(depth(pose(200), 15, -0.4), PROFILE)
    expect(reacquired.leftArm?.velocity.z).toBe(0)
    expect(reacquired.leftArm?.forwardEvidence).toBe(false)
  })

  it('zeros only the reacquired arm after occlusion', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(pose(), PROFILE)
    const hidden = extractor.update(pose(50, { 15: { visibility: 0.1 } }), PROFILE)
    expect(hidden.leftArm).toBeNull()
    expect(hidden.rightArm).not.toBeNull()
    const reacquired = extractor.update(pose(100, { 15: { x: 0.75, y: 0.7 } }), PROFILE)
    expect(reacquired.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it.each([0, -50, 500])('zeros derivatives for duplicate, backwards or long-gap timestamps %s', (timestamp) => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(pose(), PROFILE)
    const result = extractor.update(depth(pose(timestamp, { 15: { x: 0.75, y: 0.7 } }), 15, -0.3), PROFILE)
    expect(result.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.leftArm?.forwardEvidence).toBe(false)
  })

  it('returns invalid data safely and resets histories until a fresh capture', () => {
    const extractor = new MotionFeatureExtractor()
    extractor.update(pose(), PROFILE)
    const invalid = extractor.update({ ...pose(50), confidence: 0.2 }, PROFILE)
    expect(invalid.valid).toBe(false)
    expect(invalid.leftArm).toBeNull()
    const fresh = extractor.update(depth(pose(100), 15, -0.3), PROFILE)
    expect(fresh.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
    extractor.reset()
    expect(extractor.update(depth(pose(150), 15, -0.4), PROFILE).leftArm?.velocity.z).toBe(0)
  })

  it('subtracts neutral torso lean exactly once and resets after a new calibration', () => {
    const extractor = new MotionFeatureExtractor()
    const profile = { ...PROFILE, neutralTorsoLean: 0.12 }
    expect(extractor.update({ ...pose(), torsoLean: 0.2 }, profile).torsoLean).toBeCloseTo(0.08)
    const fresh = extractor.update(depth(pose(50), 15, -0.3), { ...profile, capturedAt: 50 })
    expect(fresh.leftArm?.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('never mutates the pose or calibration profile', () => {
    const source = pose()
    const copy = structuredClone(source)
    const profile = structuredClone(PROFILE)
    new MotionFeatureExtractor().update(source, PROFILE)
    expect(source).toEqual(copy)
    expect(PROFILE).toEqual(profile)
  })
})
