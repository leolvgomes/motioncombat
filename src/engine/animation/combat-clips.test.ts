import { Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { AttackSide, CombatClipSample, PunchClipOptions } from '../../types/animation'
import type { QuaternionTuple, RigJointName, RigPose } from '../../types/robot'
import {
  createCombatGuardPose, createPunchClipSampler, DEFAULT_PUNCH_OPTIONS, getPunchDuration, getPunchHitWindow,
  normalizePunchOptions, PUNCH_CLIP_CONFIG, samplePunchClip,
} from './combat-clips'

function quaternion(tuple: QuaternionTuple): Quaternion {
  return new Quaternion(...tuple)
}

function rotation(pose: RigPose, side: AttackSide, part: 'upper' | 'forearm' | 'fist'): Quaternion {
  const result = quaternion(pose.torso).multiply(quaternion(pose[`${side}Shoulder`]))
  if (part !== 'upper') result.multiply(quaternion(pose[`${side}Elbow`]))
  if (part === 'fist') result.multiply(quaternion(pose[`${side}Wrist`]))
  return result
}

function direction(pose: RigPose, side: AttackSide, part: 'upper' | 'forearm' | 'fist'): Vector3 {
  return new Vector3(0, -1, 0).applyQuaternion(rotation(pose, side, part))
}

function reach(pose: RigPose, side: AttackSide): Vector3 {
  return direction(pose, side, 'upper').multiplyScalar(0.47)
    .addScaledVector(direction(pose, side, 'forearm'), 0.43)
}

function expectSamePose(actual: RigPose, expected: RigPose): void {
  for (const name of Object.keys(expected) as RigJointName[]) {
    expect(quaternion(actual[name]).angleTo(quaternion(expected[name]))).toBeLessThan(1e-7)
  }
}

function expectValid(sample: CombatClipSample): void {
  expect(Number.isFinite(sample.progress)).toBe(true)
  expect(sample.progress).toBeGreaterThanOrEqual(0)
  expect(sample.progress).toBeLessThanOrEqual(1)
  for (const tuple of Object.values(sample.pose)) {
    expect(tuple.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...tuple)).toBeCloseTo(1, 10)
  }
  for (const weight of Object.values(sample.weights)) {
    expect(Number.isFinite(weight)).toBe(true)
    expect(weight).toBeGreaterThanOrEqual(0)
    expect(weight).toBeLessThanOrEqual(1)
  }
}

describe('authored punch clip configuration', () => {
  it('keeps defaults, ranges and central timing configuration immutable', () => {
    expect(Object.isFrozen(DEFAULT_PUNCH_OPTIONS)).toBe(true)
    expect(Object.isFrozen(PUNCH_CLIP_CONFIG)).toBe(true)
    expect(Object.isFrozen(PUNCH_CLIP_CONFIG.timing)).toBe(true)
    expect(Object.isFrozen(PUNCH_CLIP_CONFIG.hitWindow)).toBe(true)
    expect(Object.isFrozen(PUNCH_CLIP_CONFIG.durationScale)).toBe(true)
    expect(Object.isFrozen(PUNCH_CLIP_CONFIG.intensity)).toBe(true)
    expect(getPunchDuration()).toBeCloseTo(0.55)
    expect(PUNCH_CLIP_CONFIG.timing.windupEnd).toBeLessThan(PUNCH_CLIP_CONFIG.hitWindow.start)
    expect(PUNCH_CLIP_CONFIG.hitWindow.end).toBeLessThan(PUNCH_CLIP_CONFIG.timing.strikeEnd)
    expect(PUNCH_CLIP_CONFIG.timing.strikeEnd).toBeLessThan(PUNCH_CLIP_CONFIG.timing.duration)
  })

  it.each([
    { input: { intensity: -100, durationScale: -100 }, expected: { intensity: 0.6, durationScale: 0.75 } },
    { input: { intensity: 100, durationScale: 100 }, expected: { intensity: 1.3, durationScale: 1.35 } },
    { input: { intensity: Number.NaN, durationScale: Number.POSITIVE_INFINITY }, expected: { intensity: 1, durationScale: 1 } },
    { input: { intensity: Number.NEGATIVE_INFINITY, durationScale: Number.NaN }, expected: { intensity: 1, durationScale: 1 } },
  ])('sanitizes the same options for duration, hit timing and sampling: $input', ({ input, expected }) => {
    const original = { ...input }
    expect(normalizePunchOptions(input)).toEqual(expected)
    expect(getPunchDuration(input)).toBeCloseTo(0.55 * expected.durationScale)
    const hit = getPunchHitWindow(input)
    const expectedHit = getPunchHitWindow(expected)
    expect(hit).toEqual(expectedHit)
    const sample = samplePunchClip('left', hit.start, input)
    expect(sample.hitActive).toBe(true)
    expectSamePose(sample.pose, samplePunchClip('left', expectedHit.start, expected).pose)
    expect(input).toEqual(original)
    expectValid(sample)
  })

  it.each([0.75, 1, 1.35])('scales duration, all phases and hit window together by %s', (durationScale) => {
    const options = { durationScale, intensity: 1 }
    expect(getPunchDuration(options)).toBeCloseTo(0.55 * durationScale)
    const hit = getPunchHitWindow(options)
    expect(hit.start).toBeCloseTo(PUNCH_CLIP_CONFIG.hitWindow.start * durationScale)
    expect(hit.end).toBeCloseTo(PUNCH_CLIP_CONFIG.hitWindow.end * durationScale)
    for (const time of [0.01, 0.06, 0.1, 0.17, 0.3, 0.55]) {
      const scaled = samplePunchClip('left', time * durationScale, options)
      const original = samplePunchClip('left', time)
      expect(scaled.progress).toBeCloseTo(original.progress, 10)
      expect(scaled.phase).toBe(original.phase)
      expect(scaled.weights.leftShoulder).toBeCloseTo(original.weights.leftShoulder ?? 0, 10)
      expectSamePose(scaled.pose, original.pose)
    }
  })
})

describe('combat guard pose', () => {
  it('holds both fists in front with dropped elbows and folded forearms', () => {
    const guard = createCombatGuardPose()
    for (const side of ['left', 'right'] as const) {
      expect(direction(guard, side, 'upper').y).toBeLessThan(-0.5)
      expect(direction(guard, side, 'forearm').y).toBeGreaterThan(0.8)
      expect(reach(guard, side).z).toBeGreaterThan(0.45)
      expect(reach(guard, side).y).toBeGreaterThan(0.05)
      expect(quaternion(guard[`${side}Elbow`]).angleTo(new Quaternion())).toBeGreaterThan(1)
    }
    expectValid(samplePunchClip('left', 0))
  })

  it('returns independent guard poses without exposing mutable shared state', () => {
    const first = createCombatGuardPose()
    const second = createCombatGuardPose()
    expectSamePose(first, second)
    expect(first).not.toBe(second)
    expect(first.leftElbow).not.toBe(second.leftElbow)
  })
})

describe('prepared punch sampler', () => {
  it('reuses the same sample, weights, pose and all quaternion tuples during playback', () => {
    const sampler = createPunchClipSampler('left')
    const initial = sampler.sample(0)
    const pose = initial.pose
    const weights = initial.weights
    const tupleReferences = { ...initial.pose }
    const impact = sampler.sample(sampler.hitWindow.start)
    expect(impact).toBe(initial)
    expect(impact.pose).toBe(pose)
    expect(impact.weights).toBe(weights)
    for (const name of Object.keys(pose) as RigJointName[]) {
      expect(impact.pose[name]).toBe(tupleReferences[name])
    }
    expect(impact.hitActive).toBe(true)
    expect(direction(impact.pose, 'left', 'fist').z).toBeGreaterThan(0.98)
    expect(sampler.sample(sampler.duration)).toBe(initial)
    expect(initial.progress).toBe(1)
    expect(initial.weights.leftShoulder).toBe(0)
  })

  it('prepares keyframes once and only interpolates existing rotations while sampling', () => {
    const sampler = createPunchClipSampler('right')
    const authorDirection = vi.spyOn(Quaternion.prototype, 'setFromUnitVectors')
    const authorAxis = vi.spyOn(Quaternion.prototype, 'setFromAxisAngle')
    const cloneVector = vi.spyOn(Vector3.prototype, 'clone')
    try {
      for (let frame = 0; frame <= 60; frame += 1) sampler.sample(frame / 60 * sampler.duration)
      expect(authorDirection).not.toHaveBeenCalled()
      expect(authorAxis).not.toHaveBeenCalled()
      expect(cloneVector).not.toHaveBeenCalled()
    } finally {
      authorDirection.mockRestore()
      authorAxis.mockRestore()
      cloneVector.mockRestore()
    }
  })

  it('captures sanitized immutable options instead of retaining the caller object', () => {
    const input = { intensity: 100, durationScale: Number.NaN }
    const sampler = createPunchClipSampler('left', input)
    expect(sampler.options).toEqual({ intensity: 1.3, durationScale: 1 })
    expect(sampler.options).not.toBe(input)
    expect(Object.isFrozen(sampler.options)).toBe(true)
    expect(Object.isFrozen(sampler.hitWindow)).toBe(true)
    expect(Object.isFrozen(sampler)).toBe(true)
    input.intensity = 0.6
    input.durationScale = 1.35
    expect(sampler.duration).toBeCloseTo(0.55)
    expectSamePose(sampler.sample(0.17).pose, samplePunchClip('left', 0.17, { intensity: 1.3, durationScale: 1 }).pose)
  })

  it('isolates playback data between samplers and independent pure samples', () => {
    const left = createPunchClipSampler('left')
    const right = createPunchClipSampler('right')
    const leftSample = left.sample(0.17)
    const rightSample = right.sample(0.17)
    const rightBefore = structuredClone(rightSample)
    const independent = samplePunchClip('left', 0.17)
    const independentBefore = structuredClone(independent)
    expect(leftSample).not.toBe(rightSample)
    expect(leftSample.pose.leftShoulder).not.toBe(rightSample.pose.leftShoulder)
    left.sample(left.duration)
    expect(rightSample).toEqual(rightBefore)
    expect(independent).toEqual(independentBefore)
  })
})

describe('samplePunchClip', () => {
  it.each(['left', 'right'] as const)('starts and ends the %s clip at zero influence over current tracking', (side) => {
    const start = samplePunchClip(side, 0)
    const end = samplePunchClip(side, getPunchDuration())
    expect(Object.values(start.weights).every((weight) => weight === 0)).toBe(true)
    expect(Object.values(end.weights).every((weight) => weight === 0)).toBe(true)
    expect(start.progress).toBe(0)
    expect(end.progress).toBe(1)
    expect(start.phase).toBe('windup')
    expect(end.phase).toBe('recovery')
    expect(start.hitActive).toBe(false)
    expect(end.hitActive).toBe(false)
    expectSamePose(start.pose, createCombatGuardPose())
    expectSamePose(end.pose, createCombatGuardPose())
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('handles an invalid or negative time safely: %s', (time) => {
    const sample = samplePunchClip('left', time)
    expect(sample.progress).toBe(0)
    expect(Object.values(sample.weights).every((weight) => weight === 0)).toBe(true)
    expect(sample.hitActive).toBe(false)
    expectValid(sample)
  })

  it('clamps samples beyond the duration to a completed zero-weight recovery', () => {
    const sample = samplePunchClip('right', 100)
    expect(sample.progress).toBe(1)
    expect(sample.phase).toBe('recovery')
    expect(sample.hitActive).toBe(false)
    expect(Object.values(sample.weights).every((weight) => weight === 0)).toBe(true)
    expectValid(sample)
  })

  it('reports phase boundaries without coupling logical hit timing to a render frame', () => {
    const { timing } = PUNCH_CLIP_CONFIG
    expect(samplePunchClip('left', timing.windupEnd - 1e-6).phase).toBe('windup')
    expect(samplePunchClip('left', timing.windupEnd).phase).toBe('strike')
    expect(samplePunchClip('left', timing.impactAt).phase).toBe('strike')
    expect(samplePunchClip('left', timing.strikeEnd).phase).toBe('recovery')
    expect(samplePunchClip('left', timing.duration).phase).toBe('recovery')
  })

  it.each([0.75, 1, 1.35])('activates the hit metadata only inside its scaled half-open strike window: %s', (durationScale) => {
    const options = { intensity: 1, durationScale }
    const hit = getPunchHitWindow(options)
    expect(samplePunchClip('left', hit.start - 1e-6, options).hitActive).toBe(false)
    expect(samplePunchClip('left', hit.start, options).hitActive).toBe(true)
    expect(samplePunchClip('left', hit.end - 1e-6, options).hitActive).toBe(true)
    expect(samplePunchClip('left', hit.end, options).hitActive).toBe(false)
    expect(samplePunchClip('left', hit.end, options).phase).toBe('strike')
  })

  it.each(['left', 'right'] as const)('authors a straight, forward %s punch with the fist aligned during every active sample', (side) => {
    for (const intensity of [0.6, 1, 1.3]) {
      const options = { intensity, durationScale: 1 }
      const hit = getPunchHitWindow(options)
      for (const time of [hit.start, (hit.start + hit.end) / 2, hit.end - 1e-6]) {
        const sample = samplePunchClip(side, time, options)
        const upper = direction(sample.pose, side, 'upper')
        const forearm = direction(sample.pose, side, 'forearm')
        const fist = direction(sample.pose, side, 'fist')
        expect(sample.hitActive).toBe(true)
        expect(sample.phase).toBe('strike')
        expect(sample.weights[`${side}Shoulder`]).toBe(1)
        expect(upper.z).toBeGreaterThan(0.98)
        expect(forearm.z).toBeGreaterThan(0.98)
        expect(fist.dot(forearm)).toBeCloseTo(1, 10)
        expect(fist.z).toBeGreaterThan(0.98)
        expect(side === 'left' ? upper.x : -upper.x).toBeLessThan(0)
        expect(upper.angleTo(forearm)).toBeLessThan(1e-7)
        expect(quaternion(sample.pose[`${side}Elbow`]).angleTo(new Quaternion())).toBeLessThan(1e-7)
        expect(reach(sample.pose, side).length()).toBeCloseTo(0.9, 10)
        expect(reach(sample.pose, side).z).toBeGreaterThan(0.88)
        expectValid(sample)
      }
    }
  })

  it.each(['left', 'right'] as const)('masks only the attacking %s arm and a small torso contribution', (side) => {
    const other = side === 'left' ? 'right' : 'left'
    for (let time = 0; time <= 0.55; time += 0.005) {
      const sample = samplePunchClip(side, time)
      expect(Object.keys(sample.weights).sort()).toEqual([`${side}Shoulder`, `${side}Elbow`, `${side}Wrist`, 'torso'].sort())
      expect(sample.weights[`${other}Shoulder`]).toBeUndefined()
      expect(sample.weights[`${other}Elbow`]).toBeUndefined()
      expect(sample.weights[`${other}Wrist`]).toBeUndefined()
      expect(sample.weights.head).toBeUndefined()
      expect(sample.weights[`${side}Elbow`]).toBe(sample.weights[`${side}Shoulder`])
      expect(sample.weights[`${side}Wrist`]).toBe(sample.weights[`${side}Shoulder`])
      expect(sample.weights.torso).toBeCloseTo((sample.weights[`${side}Shoulder`] ?? 0) * 0.25, 10)
      expect(sample.pose[`${other}Shoulder`]).toEqual(createCombatGuardPose()[`${other}Shoulder`])
    }
  })

  it('mirrors anatomical left and right punches symmetrically throughout the clip', () => {
    for (const time of [0, 0.015, 0.04, 0.06, 0.08, 0.13, 0.17, 0.22, 0.37, 0.55]) {
      const left = samplePunchClip('left', time)
      const right = samplePunchClip('right', time)
      for (const part of ['upper', 'forearm', 'fist'] as const) {
        const leftDirection = direction(left.pose, 'left', part)
        const rightDirection = direction(right.pose, 'right', part)
        expect(leftDirection.x).toBeCloseTo(-rightDirection.x, 9)
        expect(leftDirection.y).toBeCloseTo(rightDirection.y, 9)
        expect(leftDirection.z).toBeCloseTo(rightDirection.z, 9)
      }
      expect(left.weights.leftShoulder).toBeCloseTo(right.weights.rightShoulder ?? 0, 10)
      expect(left.hitActive).toBe(right.hitActive)
    }
  })

  it('increases influence smoothly until impact and releases it smoothly through recovery', () => {
    const { timing } = PUNCH_CLIP_CONFIG
    let previous = 0
    for (let sample = 0; sample <= 100; sample += 1) {
      const weight = samplePunchClip('left', sample / 100 * timing.impactAt).weights.leftShoulder ?? 0
      expect(weight).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = weight
    }
    expect(previous).toBe(1)
    for (let sample = 0; sample <= 100; sample += 1) {
      const time = timing.strikeEnd + sample / 100 * (timing.duration - timing.strikeEnd)
      const weight = samplePunchClip('left', time).weights.leftShoulder ?? 0
      expect(weight).toBeLessThanOrEqual(previous + 1e-12)
      previous = weight
    }
    expect(previous).toBe(0)
  })

  it('has no quaternion or weight discontinuity at any authored boundary', () => {
    const { timing } = PUNCH_CLIP_CONFIG
    for (const boundary of [0, timing.windupEnd, timing.impactAt, timing.strikeEnd, timing.duration]) {
      const before = samplePunchClip('left', boundary - 1e-6)
      const after = samplePunchClip('left', boundary + 1e-6)
      expectSamePose(before.pose, after.pose)
      expect(Math.abs((before.weights.leftShoulder ?? 0) - (after.weights.leftShoulder ?? 0))).toBeLessThan(1e-7)
    }
    const firstInfluence = samplePunchClip('left', 0.0001).weights.leftShoulder ?? 0
    expect(firstInfluence).toBeGreaterThan(0)
    expect(firstInfluence).toBeLessThan(1e-5)
  })

  it('keeps all joint rotations finite and elbow flexion within anatomical bounds across configured extremes', () => {
    for (const side of ['left', 'right'] as const) {
      for (const intensity of [0.6, 1.3]) {
        for (const durationScale of [0.75, 1.35]) {
          const options: PunchClipOptions = { intensity, durationScale }
          const duration = getPunchDuration(options)
          for (let step = 0; step <= 40; step += 1) {
            const sample = samplePunchClip(side, step / 40 * duration, options)
            expectValid(sample)
            expect(quaternion(sample.pose[`${side}Elbow`]).angleTo(new Quaternion())).toBeLessThan(150 * Math.PI / 180)
            expect(quaternion(sample.pose.torso).angleTo(new Quaternion())).toBeLessThan(0.2)
            expect(reach(sample.pose, side).length()).toBeLessThanOrEqual(0.9 + 1e-10)
          }
        }
      }
    }
  })

  it('changes authored intensity without modifying timing or exceeding full extension', () => {
    const low = samplePunchClip('left', 0.17, { durationScale: 1, intensity: 0.6 })
    const high = samplePunchClip('left', 0.17, { durationScale: 1, intensity: 1.3 })
    expect(quaternion(high.pose.torso).angleTo(new Quaternion())).toBeGreaterThan(quaternion(low.pose.torso).angleTo(new Quaternion()))
    expect(quaternion(high.pose.leftWrist).angleTo(new Quaternion())).toBeGreaterThan(quaternion(low.pose.leftWrist).angleTo(new Quaternion()))
    expect(high.progress).toBe(low.progress)
    expect(reach(high.pose, 'left').length()).toBeCloseTo(reach(low.pose, 'left').length(), 10)
  })

  it('returns repeatable independent samples without mutating a previous pose', () => {
    const first = samplePunchClip('left', 0.17)
    const original = structuredClone(first)
    samplePunchClip('right', 0.4, { intensity: 1.3, durationScale: 0.75 })
    const repeated = samplePunchClip('left', 0.17)
    expect(first).toEqual(original)
    expect(repeated).toEqual(first)
    expect(repeated).not.toBe(first)
    expect(repeated.pose).not.toBe(first.pose)
  })
})
