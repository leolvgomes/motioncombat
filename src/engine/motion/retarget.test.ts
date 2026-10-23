import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Landmark, ProcessedPose } from '../../types/motion'
import type { QuaternionTuple, RigPose } from '../../types/robot'
import { createRestPose, retargetPose, sampleDemoPose } from './retarget'

type PointOverrides = Readonly<Partial<Record<number, Partial<Landmark>>>>

function pose(overrides: PointOverrides = {}): ProcessedPose {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const positions: Readonly<Record<number, readonly [number, number]>> = {
    0: [0.5, 0.1],
    11: [0.65, 0.35], 12: [0.35, 0.35],
    13: [0.65, 0.55], 14: [0.35, 0.55],
    15: [0.65, 0.75], 16: [0.35, 0.75],
    23: [0.6, 0.95], 24: [0.4, 0.95],
  }
  for (const [key, position] of Object.entries(positions)) {
    const index = Number(key)
    landmarks[index] = { x: position[0], y: position[1], z: 0, visibility: 0.95, ...overrides[index] }
  }
  return {
    timestamp: 1000, landmarks, worldLandmarks: [], confidence: 0.95,
    visibleCount: 9, upperBodyVisibleCount: 9, status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0,
  }
}

function quaternion(rotation: QuaternionTuple): Quaternion {
  return new Quaternion(...rotation)
}

function direction(rig: RigPose, side: 'left' | 'right', segment: 'upper' | 'forearm'): Vector3 {
  const rotation = quaternion(rig.torso).multiply(quaternion(rig[`${side}Shoulder`]))
  if (segment === 'forearm') rotation.multiply(quaternion(rig[`${side}Elbow`]))
  return new Vector3(0, -1, 0).applyQuaternion(rotation)
}

function expectDirection(actual: Vector3, expected: readonly [number, number, number]): void {
  const normalized = new Vector3(...expected).normalize()
  expect(actual.x).toBeCloseTo(normalized.x, 7)
  expect(actual.y).toBeCloseTo(normalized.y, 7)
  expect(actual.z).toBeCloseTo(normalized.z, 7)
}

function expectFiniteUnit(rig: RigPose): void {
  for (const rotation of Object.values(rig)) {
    expect(rotation.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...rotation)).toBeCloseTo(1, 9)
  }
}

function expectSameRotations(actual: RigPose, expected: RigPose): void {
  for (const name of Object.keys(expected) as (keyof RigPose)[]) {
    expect(quaternion(actual[name]).angleTo(quaternion(expected[name]))).toBeLessThan(1e-7)
  }
}

const OPTIONS = { mirrored: false, aspectRatio: 16 / 9 } as const

describe('retargetPose', () => {
  it('returns a fresh relaxed rest pose with down-pointing upper arms and bent elbows', () => {
    const first = createRestPose()
    const second = createRestPose()
    expect(first).not.toBe(second)
    expect(first.leftShoulder).not.toBe(second.leftShoulder)
    expect(first).toEqual(second)
    expectFiniteUnit(first)
    expect(direction(first, 'left', 'upper').y).toBeLessThan(-0.9)
    expect(direction(first, 'left', 'forearm').z).toBeGreaterThan(0.7)
    expect(quaternion(first.leftElbow).angleTo(new Quaternion())).toBeGreaterThan(0.5)
  })

  it('reconstructs both straight downward arm directions through the local hierarchy', () => {
    const rig = retargetPose(pose(), OPTIONS)
    for (const side of ['left', 'right'] as const) {
      expectDirection(direction(rig, side, 'upper'), [0, -1, 0])
      expectDirection(direction(rig, side, 'forearm'), [0, -1, 0])
    }
    expectFiniteUnit(rig)
  })

  it('raises the anatomical left arm without changing the right arm', () => {
    const rig = retargetPose(pose({ 13: { y: 0.18 }, 15: { y: 0.02 } }), OPTIONS)
    expectDirection(direction(rig, 'left', 'upper'), [0, 1, 0])
    expectDirection(direction(rig, 'left', 'forearm'), [0, 1, 0])
    expectDirection(direction(rig, 'right', 'upper'), [0, -1, 0])
    expectFiniteUnit(rig)
  })

  it('avoids mechanical shoulder twists while sweeping through the overhead pole', () => {
    let previous: Quaternion | null = null
    for (let sample = 0; sample <= 32; sample += 1) {
      const phase = sample / 32 * Math.PI * 2
      const x = 0.65 + Math.cos(phase) * 0.0003
      const depth = Math.sin(phase) * 0.0003
      const source = pose({ 13: { x, y: 0.15 }, 15: { x, y: 0.02 } })
      const worldLandmarks = source.landmarks.map((point, index) => ({
        ...point, z: index === 13 || index === 15 ? -depth : 0,
      }))
      const rig = retargetPose({ ...source, worldLandmarks }, OPTIONS)
      const shoulder = quaternion(rig.leftShoulder)
      if (previous) expect(shoulder.angleTo(previous)).toBeLessThan(0.01)
      expect(direction(rig, 'left', 'upper').y).toBeGreaterThan(0.98)
      expectFiniteUnit(rig)
      previous = shoulder
    }
  })

  it('swaps source arms when mirroring so the raised hand follows the preview side', () => {
    const source = pose({ 13: { y: 0.18 }, 15: { y: 0.02 } })
    const rig = retargetPose(source, { ...OPTIONS, mirrored: true })
    expectDirection(direction(rig, 'left', 'upper'), [0, -1, 0])
    expectDirection(direction(rig, 'right', 'upper'), [0, 1, 0])
    expectDirection(direction(rig, 'right', 'forearm'), [0, 1, 0])
  })

  it('negates image X as well as swapping the anatomical chains in mirror mode', () => {
    const source = pose({ 13: { x: 0.8, y: 0.4 }, 15: { x: 0.9, y: 0.5 } })
    const unmirrored = retargetPose(source, OPTIONS)
    const mirrored = retargetPose(source, { ...OPTIONS, mirrored: true })
    const left = direction(unmirrored, 'left', 'upper')
    const right = direction(mirrored, 'right', 'upper')
    expect(left.x).toBeGreaterThan(0)
    expect(right.x).toBeCloseTo(-left.x, 7)
    expect(right.y).toBeCloseTo(left.y, 7)
    expect(right.z).toBeCloseTo(left.z, 7)
  })

  it('resolves the elbow relative to its rotated shoulder instead of rotating the forearm twice', () => {
    const rig = retargetPose(pose({ 13: { x: 0.8, y: 0.35 }, 15: { x: 0.8, y: 0.15 } }), OPTIONS)
    expectDirection(direction(rig, 'left', 'upper'), [1, 0, 0])
    expectDirection(direction(rig, 'left', 'forearm'), [0, 1, 0])
  })

  it('corrects image aspect ratio before deriving limb directions', () => {
    const source = pose({ 13: { x: 0.8, y: 0.5 }, 15: { x: 0.9, y: 0.6 } })
    expectDirection(direction(retargetPose(source, { ...OPTIONS, aspectRatio: 1 }), 'left', 'upper'), [1, -1, 0])
    expectDirection(direction(retargetPose(source, { ...OPTIONS, aspectRatio: 2 }), 'left', 'upper'), [2, -1, 0])
  })

  it('keeps orientations unchanged when a valid person is translated and scaled in the image', () => {
    const source = pose({ 13: { x: 0.8, y: 0.5 }, 15: { x: 0.9, y: 0.6 } })
    const resized = {
      ...source,
      landmarks: source.landmarks.map((point) => ({ ...point, x: 0.55 + (point.x - 0.5) * 0.5, y: 0.5 + (point.y - 0.5) * 0.5 })),
    }
    const first = retargetPose(source, OPTIONS)
    const second = retargetPose(resized, OPTIONS)
    for (const side of ['left', 'right'] as const) {
      for (const segment of ['upper', 'forearm'] as const) {
        const expected = direction(first, side, segment)
        expectDirection(direction(second, side, segment), [expected.x, expected.y, expected.z])
      }
    }
  })

  it('compensates torso rotation at the shoulder so world arm directions remain correct', () => {
    const source = pose({
      11: { x: 0.75 }, 12: { x: 0.45 },
      13: { x: 0.75 }, 14: { x: 0.45 },
      15: { x: 0.75 }, 16: { x: 0.45 },
    })
    const rig = retargetPose(source, OPTIONS)
    expect(quaternion(rig.torso).angleTo(new Quaternion())).toBeGreaterThan(0.2)
    expectDirection(direction(rig, 'left', 'upper'), [0, -1, 0])
    expectDirection(direction(rig, 'right', 'forearm'), [0, -1, 0])
    expect(quaternion(rig.leftShoulder).angleTo(quaternion(rig.torso).invert())).toBeCloseTo(0, 7)
  })

  it('bounds torso lean, mirrors its direction and keeps the head counter-rotation modest', () => {
    const source = pose({ 23: { x: 0.2, y: 0.45 }, 24: { x: 0.1, y: 0.45 } })
    const first = retargetPose(source, OPTIONS)
    const mirrored = retargetPose(source, { ...OPTIONS, mirrored: true })
    expect(quaternion(first.torso).angleTo(new Quaternion())).toBeCloseTo(0.35)
    expect(mirrored.torso[2]).toBeCloseTo(-first.torso[2])
    expect(quaternion(first.head).angleTo(new Quaternion())).toBeLessThan(0.11)
  })

  it('uses conservative shoulder slope when the waist is outside the image', () => {
    const rig = retargetPose(pose({ 11: { y: 0.4 }, 23: { visibility: 0 }, 24: { visibility: 0 } }), OPTIONS)
    expect(quaternion(rig.torso).angleTo(new Quaternion())).toBeGreaterThan(0)
    expect(quaternion(rig.torso).angleTo(new Quaternion())).toBeLessThan(0.1)
    expectFiniteUnit(rig)
  })

  it.each([
    { visibility: 0.1 },
    { x: Number.NaN },
    { z: Number.POSITIVE_INFINITY },
    { x: -0.1 },
    { visibility: Number.NaN },
  ])('returns only the affected arm to rest for an invalid wrist: %j', (invalid) => {
    const rig = retargetPose(pose({ 15: invalid }), OPTIONS)
    const rest = createRestPose()
    expect(rig.leftShoulder).toEqual(rest.leftShoulder)
    expect(rig.leftElbow).toEqual(rest.leftElbow)
    expect(rig.leftWrist).toEqual(rest.leftWrist)
    expectDirection(direction(rig, 'right', 'upper'), [0, -1, 0])
    expectFiniteUnit(rig)
  })

  it('returns rest for missing landmarks and degenerate segments', () => {
    const empty = { ...pose(), landmarks: [], worldLandmarks: [] }
    expect(retargetPose(empty, OPTIONS)).toEqual(createRestPose())
    const collapsed = retargetPose(pose({ 13: { x: 0.65, y: 0.35 } }), OPTIONS)
    expect(collapsed.leftShoulder).toEqual(createRestPose().leftShoulder)
  })

  it('uses the proper depth sign and keeps world-space elbow solving correct', () => {
    const source = pose({ 13: { x: 0.8, y: 0.35 }, 15: { x: 0.8, y: 0.15 } })
    const worldLandmarks = source.landmarks.map((point, index) => ({
      ...point, z: index === 13 || index === 15 ? -0.3 : 0,
    }))
    const rig = retargetPose({ ...source, worldLandmarks }, OPTIONS)
    const upper = direction(rig, 'left', 'upper')
    expect(upper.z).toBeGreaterThan(0)
    expect(upper.z / Math.hypot(upper.x, upper.y)).toBeLessThanOrEqual(0.3 + 1e-9)
    expectDirection(direction(rig, 'left', 'forearm'), [0, 1, 0])
    expectFiniteUnit(rig)
  })

  it('limits unreliable finite depth estimates and ignores non-finite world coordinates', () => {
    const source = pose()
    const depthPose = (depth: number): ProcessedPose => ({
      ...source,
      worldLandmarks: source.landmarks.map((point, index) => ({ ...point, z: index === 13 || index === 15 ? depth : 0 })),
    })
    const large = retargetPose(depthPose(-100), OPTIONS)
    const enormous = retargetPose(depthPose(-1e300), OPTIONS)
    expect(large.leftShoulder).toEqual(enormous.leftShoulder)
    const invalid = retargetPose(depthPose(Number.NaN), OPTIONS)
    expectDirection(direction(invalid, 'left', 'upper'), [0, -1, 0])
    expectFiniteUnit(enormous)
    expectFiniteUnit(invalid)
  })

  it('does not let low-confidence world depth perturb a valid projected arm', () => {
    const source = pose()
    const worldLandmarks = source.landmarks.map((point, index) => ({
      ...point, visibility: 0.2, z: index === 13 ? -1 : 0,
    }))
    const rig = retargetPose({ ...source, worldLandmarks }, OPTIONS)
    expectDirection(direction(rig, 'left', 'upper'), [0, -1, 0])
  })

  it('prevents an elbow folding beyond 150 degrees and extreme cross-body upper-arm swings', () => {
    const folded = retargetPose(pose({ 13: { y: 0.7 }, 15: { y: 0.4 } }), OPTIONS)
    const upper = direction(folded, 'left', 'upper')
    const forearm = direction(folded, 'left', 'forearm')
    expect(upper.angleTo(forearm)).toBeCloseTo(150 * Math.PI / 180)
    const crossed = retargetPose(pose({ 13: { x: 0.25, y: 0.35 }, 15: { x: 0.1, y: 0.35 } }), OPTIONS)
    expect(direction(crossed, 'left', 'upper').x).toBeGreaterThanOrEqual(-0.85 - 1e-9)
    expectFiniteUnit(folded)
    expectFiniteUnit(crossed)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to a valid aspect ratio for %s', (aspectRatio) => {
    const source = pose({ 13: { x: 0.8, y: 0.5 }, 15: { x: 0.9, y: 0.6 } })
    expectSameRotations(retargetPose(source, { mirrored: false, aspectRatio }), retargetPose(source, OPTIONS))
  })

  it('never mutates source landmarks or world coordinates', () => {
    const source = pose()
    const before = structuredClone(source)
    retargetPose(source, OPTIONS)
    expect(source).toEqual(before)
  })
})

describe('sampleDemoPose', () => {
  it('begins at rest, raises the arms, then loops without a positional jump', () => {
    expectSameRotations(sampleDemoPose(0), createRestPose())
    expect(sampleDemoPose(16)).toEqual(sampleDemoPose(0))
    expect(direction(sampleDemoPose(8), 'left', 'upper').y).toBeGreaterThan(0)
    expect(direction(sampleDemoPose(8), 'left', 'forearm').y).toBeGreaterThan(0.8)
    expect(quaternion(sampleDemoPose(15.999).leftShoulder).angleTo(quaternion(sampleDemoPose(16).leftShoulder))).toBeLessThan(0.001)
  })

  it('stays finite and normalized throughout the deterministic non-combat sequence', () => {
    for (let time = 0; time < 32; time += 0.125) expectFiniteUnit(sampleDemoPose(time))
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expectSameRotations(sampleDemoPose(time), createRestPose())
  })
})
