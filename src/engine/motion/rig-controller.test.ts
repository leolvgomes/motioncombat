import { describe, expect, it } from 'vitest'
import { Quaternion } from 'three'
import { RigController, RIG_JOINTS } from './rig-controller'
import type { RigInput } from './rig-controller'
import { createRestPose } from './retarget'
import type { Landmark, ProcessedPose } from '../../types/motion'

function capturedPose(): ProcessedPose {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const positions = { 0: [0.5, 0.1], 11: [0.65, 0.4], 12: [0.35, 0.4], 13: [0.8, 0.3], 14: [0.2, 0.3], 15: [0.85, 0.1], 16: [0.15, 0.1], 23: [0.6, 0.9], 24: [0.4, 0.9] }
  for (const [id, [x, y]] of Object.entries(positions)) landmarks[Number(id)] = { x, y, z: 0, visibility: 0.95 }
  return { timestamp: 1000, landmarks, worldLandmarks: [], confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9, status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0 }
}

function input(overrides: Partial<RigInput> = {}): RigInput {
  return { mode: 'tracking', paused: false, active: true, pose: capturedPose(), mirrored: true, aspectRatio: 16 / 9, now: 1000, ...overrides }
}

describe('RigController', () => {
  it('starts at the explicit rest pose with stable reusable rotation objects', () => {
    const controller = new RigController()
    const rest = createRestPose()
    const initial = controller.rotations.leftShoulder
    for (const joint of RIG_JOINTS) expect(controller.rotations[joint].toArray()).toEqual(rest[joint])
    controller.step(input(), 1 / 60)
    expect(controller.rotations.leftShoulder).toBe(initial)
    expect(controller.sourceStatus).toBe('tracking')
  })

  it('interpolates the same target equally across display frame rates', () => {
    const state = input()
    const atRate = (fps: number) => {
      const controller = new RigController()
      for (let i = 0; i < fps; i++) controller.step(state, 1 / fps)
      return controller
    }
    const thirty = atRate(30)
    const sixty = atRate(60)
    for (const joint of RIG_JOINTS) expect(thirty.rotations[joint].angleTo(sixty.rotations[joint])).toBeLessThan(0.000001)
  })

  it('returns smoothly to rest for stale data and rejects future capture timestamps', () => {
    const controller = new RigController()
    const state = input()
    for (let i = 0; i < 30; i++) controller.step(state, 1 / 60)
    const before = controller.rotations.leftShoulder.clone()
    const rest = new Quaternion().fromArray(createRestPose().leftShoulder)
    controller.step({ ...state, now: 1500 }, 1 / 60)
    expect(controller.sourceStatus).toBe('lost')
    expect(controller.rotations.leftShoulder.angleTo(before)).toBeGreaterThan(0)
    expect(controller.rotations.leftShoulder.angleTo(rest)).toBeGreaterThan(0.01)
    for (let i = 0; i < 120; i++) controller.step({ ...state, now: 1500 }, 1 / 60)
    expect(controller.rotations.leftShoulder.angleTo(rest)).toBeLessThan(0.001)
    controller.step({ ...state, now: 500 }, 1 / 60)
    expect(controller.sourceStatus).toBe('lost')
  })

  it('cannot apply tracking while the webcam session is inactive', () => {
    const controller = new RigController()
    controller.step(input({ active: false }), 1 / 60)
    expect(controller.sourceStatus).toBe('idle')
    expect(controller.rotations.leftShoulder.angleTo(new Quaternion().fromArray(createRestPose().leftShoulder))).toBeLessThan(0.000001)
  })

  it('freezes demo immediately when paused and resumes without a time jump', () => {
    const controller = new RigController()
    const demo = input({ mode: 'demo', active: false, pose: null })
    for (let i = 0; i < 60; i++) controller.step(demo, 1 / 60)
    const frozen = controller.rotations.leftShoulder.toArray()
    for (let i = 0; i < 100; i++) controller.step({ ...demo, paused: true }, 1 / 60)
    expect(controller.rotations.leftShoulder.toArray()).toEqual(frozen)
    expect(controller.sourceStatus).toBe('demo')
    controller.step(demo, 1 / 60)
    expect(controller.rotations.leftShoulder.toArray()).not.toEqual(frozen)
  })

  it('clears demo motion and returns to rest when the source switches to an inactive camera', () => {
    const controller = new RigController()
    for (let i = 0; i < 120; i++) controller.step(input({ mode: 'demo' }), 1 / 60)
    const before = controller.rotations.leftShoulder.clone()
    const resting = new Quaternion().fromArray(createRestPose().leftShoulder)
    expect(before.angleTo(resting)).toBeGreaterThan(0.01)
    for (let i = 0; i < 180; i++) controller.step(input({ active: false, pose: null }), 1 / 60)
    expect(controller.sourceStatus).toBe('idle')
    expect(controller.rotations.leftShoulder.angleTo(resting)).toBeLessThan(0.001)
  })

  it('ignores invalid elapsed values instead of corrupting rotations', () => {
    const controller = new RigController()
    controller.step(input(), Number.NaN)
    for (const joint of RIG_JOINTS) expect(controller.rotations[joint].toArray().every(Number.isFinite)).toBe(true)
  })
})
