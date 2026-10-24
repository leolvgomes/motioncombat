import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { RigJointName } from '../../types/robot'
import { createRestPose } from '../motion/retarget'
import { RIG_JOINTS } from '../motion/rig-controller'
import { getPunchDuration, getPunchHitWindow } from './combat-clips'
import { HybridAnimationController } from './hybrid-controller'
import type { HybridInput } from './hybrid-controller'

type Base = Record<RigJointName, Quaternion>

function basePose(): Base {
  const rest = createRestPose()
  return Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion().fromArray(rest[name])])) as Base
}

function input(changes: Partial<HybridInput> = {}): HybridInput {
  return {
    enabled: true, mode: 'tracking', active: true, calibrated: true, trackingStatus: 'tracking',
    mirrored: false, posture: 'neutral', gesture: null, generation: 1, now: 1000,
    paused: false, durationScale: 1, intensity: 1, demoAttacks: false, ...changes,
  }
}

function pulse(sequence = 1, type: 'PUNCH_LEFT' | 'PUNCH_RIGHT' = 'PUNCH_LEFT', timestamp = 1000, generation = 1): NonNullable<HybridInput['gesture']> {
  return { sequence, generation, event: { type, timestamp, confidence: 0.95 } }
}

function advance(controller: HybridAnimationController, base: Base, seconds: number, changes: Partial<HybridInput> = {}, fps = 60): void {
  let elapsed = 0
  while (elapsed < seconds - 1e-10) {
    const dt = Math.min(1 / fps, seconds - elapsed)
    elapsed += dt
    controller.update(base, input({ ...changes, now: 1000 + elapsed * 1000 }), dt)
  }
}

function start(controller: HybridAnimationController, base: Base, changes: Partial<HybridInput> = {}): void {
  controller.update(base, input({ gesture: pulse(), ...changes }), 0)
}

function expectSamePose(actual: Base, expected: Base): void {
  for (const name of RIG_JOINTS) expect(actual[name].angleTo(expected[name])).toBeLessThan(1e-7)
}

const DEMO: Partial<HybridInput> = { mode: 'demo', active: false, calibrated: false, trackingStatus: 'demo', demoAttacks: true }

describe('HybridAnimationController base and priority', () => {
  it('copies the current base into stable reusable quaternion objects', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    const original = controller.rotations.leftShoulder
    controller.update(base, input({ active: false, trackingStatus: 'idle' }), 0)
    expect(controller.snapshot.state).toBe('IDLE')
    expectSamePose(controller.rotations, base)
    controller.update(base, input(), 1 / 60)
    expect(controller.snapshot.state).toBe('TRACKING')
    expect(controller.rotations.leftShoulder).toBe(original)
  })

  it('reflects guard and dodge without claiming an attack, even with hybrid disabled', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    controller.update(base, input({ enabled: false, posture: 'guard' }), 0)
    expect(controller.snapshot.state).toBe('GUARD')
    controller.update(base, input({ enabled: false, posture: 'dodge-left' }), 0)
    expect(controller.snapshot.state).toBe('DODGE')
    controller.update(base, input({ enabled: false, posture: 'dodge-right' }), 0)
    expect(controller.snapshot.state).toBe('DODGE')
    expect(controller.snapshot.source).toBeNull()
    expect(controller.snapshot.hitActive).toBe(false)
    expectSamePose(controller.rotations, base)
  })

  it('keeps an attack above lower-priority guard and dodge postures', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.17, { posture: 'guard' })
    expect(controller.snapshot.state).toBe('PUNCH_LEFT')
    expect(controller.snapshot.hitActive).toBe(true)
    advance(controller, base, 0.1, { posture: 'dodge-right' })
    expect(controller.snapshot.state).toBe('PUNCH_LEFT')
    expect(controller.snapshot.phase).toBe('recovery')
    advance(controller, base, 0.4, { posture: 'dodge-right' })
    expect(controller.snapshot.state).toBe('DODGE')
  })

  it.each([
    [false, 'PUNCH_LEFT', 'left'], [true, 'PUNCH_LEFT', 'right'],
    [false, 'PUNCH_RIGHT', 'right'], [true, 'PUNCH_RIGHT', 'left'],
  ] as const)('maps mirror=%s human %s to model %s', (mirrored, type, side) => {
    const controller = new HybridAnimationController(0)
    start(controller, basePose(), { mirrored, gesture: pulse(1, type) })
    expect(controller.snapshot.attackSide).toBe(side)
    expect(controller.snapshot.state).toBe(side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT')
    expect(controller.snapshot.source).toBe('gesture')
  })

  it('accepts a validated gesture when the other arm has only partial tracking', () => {
    const controller = new HybridAnimationController(0)
    start(controller, basePose(), { trackingStatus: 'partial' })
    expect(controller.snapshot.acceptedAttacks).toBe(1)
  })
})

describe('HybridAnimationController event safety', () => {
  it.each([
    { enabled: false }, { active: false }, { calibrated: false },
    { trackingStatus: 'lost' }, { trackingStatus: 'idle' },
    { mode: 'demo', active: false, calibrated: false, trackingStatus: 'demo' },
  ] as const)('rejects new attacks under an invalid context %j', (context) => {
    const controller = new HybridAnimationController(0)
    start(controller, basePose(), context)
    expect(controller.snapshot.acceptedAttacks).toBe(0)
    expect(controller.snapshot.hitActive).toBe(false)
  })

  it('consumes disabled pulses so toggling the layer on cannot replay them', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base, { enabled: false })
    start(controller, base, { enabled: true, now: 1020 })
    expect(controller.snapshot.acceptedAttacks).toBe(0)
    expect(controller.snapshot.ignoredGestures).toBe(1)
    start(controller, base, { gesture: pulse(2, 'PUNCH_RIGHT', 1020), now: 1020 })
    expect(controller.snapshot.acceptedAttacks).toBe(1)
  })

  it.each([699, 1001, Number.NaN])('rejects stale, future or invalid event timestamp %s', (timestamp) => {
    const controller = new HybridAnimationController(0)
    start(controller, basePose(), { gesture: pulse(1, 'PUNCH_LEFT', timestamp) })
    expect(controller.snapshot.acceptedAttacks).toBe(0)
  })

  it.each([1000, 1001])('never replays an event at or before mounting time %s, even if it is still fresh', (createdAt) => {
    const controller = new HybridAnimationController(createdAt)
    const base = basePose()
    start(controller, base, { now: 1010 })
    expect(controller.snapshot.acceptedAttacks).toBe(0)
    start(controller, base, { now: 1020, gesture: pulse(2, 'PUNCH_LEFT', 1020) })
    expect(controller.snapshot.acceptedAttacks).toBe(1)
  })

  it('ignores duplicate or old-generation events without queuing attacks', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.7, { gesture: pulse() })
    expect(controller.snapshot.acceptedAttacks).toBe(1)
    start(controller, base, { generation: 2, now: 1100, gesture: pulse(2, 'PUNCH_LEFT', 1100, 1) })
    expect(controller.snapshot.acceptedAttacks).toBe(1)
    start(controller, base, { generation: 2, now: 1100, gesture: pulse(1, 'PUNCH_RIGHT', 1100, 2) })
    expect(controller.snapshot.acceptedAttacks).toBe(2)
  })

  it('drops opposite punches during recovery and never starts them after becoming free', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.5)
    const pending = pulse(2, 'PUNCH_RIGHT', 1500)
    controller.update(base, input({ now: 1500, gesture: pending }), 0)
    expect(controller.snapshot.acceptedAttacks).toBe(1)
    expect(controller.snapshot.ignoredGestures).toBe(1)
    advance(controller, base, 0.06)
    controller.update(base, input({ now: 1560, gesture: pending }), 0)
    expect(controller.snapshot.state).toBe('TRACKING')
    expect(controller.snapshot.acceptedAttacks).toBe(1)
  })

  it('consumes posture events without manufacturing attack clips', () => {
    const controller = new HybridAnimationController(0)
    const event = { sequence: 1, generation: 1, event: { type: 'GUARD', timestamp: 1000, confidence: 0.9 } } as const
    start(controller, basePose(), { gesture: event, posture: 'guard' })
    expect(controller.snapshot.state).toBe('GUARD')
    expect(controller.snapshot.acceptedAttacks).toBe(0)
    expect(controller.snapshot.ignoredGestures).toBe(0)
  })
})

describe('HybridAnimationController blending and interruption', () => {
  it('reuses every output quaternion through prepared sampling and cancellation without mutating the base', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    const originalBase = Object.fromEntries(RIG_JOINTS.map((name) => [name, base[name].toArray()]))
    const outputs = { ...controller.rotations }
    const record = controller.rotations
    start(controller, base)
    advance(controller, base, 0.17)
    controller.update(base, input({ active: false }), 0)
    advance(controller, base, 0.2, { active: false })
    expect(controller.rotations).toBe(record)
    for (const name of RIG_JOINTS) {
      expect(controller.rotations[name]).toBe(outputs[name])
      expect(base[name].toArray()).toEqual(originalBase[name])
    }
  })

  it('preserves unmasked arm and head transforms while tracking changes during an attack', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.17)
    base.rightShoulder.setFromAxisAngle(new Vector3(0, 1, 0), 0.6)
    base.rightElbow.setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
    base.rightWrist.setFromAxisAngle(new Vector3(0, 0, 1), -0.2)
    base.head.setFromAxisAngle(new Vector3(0, 1, 0), 0.3)
    controller.update(base, input(), 1 / 60)
    for (const name of ['rightShoulder', 'rightElbow', 'rightWrist', 'head'] as const) {
      expect(controller.rotations[name].toArray()).toEqual(base[name].toArray())
    }
    expect(controller.rotations.leftShoulder.angleTo(base.leftShoulder)).toBeGreaterThan(0.1)
  })

  it('returns to the current tracking pose instead of the pre-attack pose', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.4)
    base.leftShoulder.setFromAxisAngle(new Vector3(0, 0, 1), -0.45)
    base.leftElbow.setFromAxisAngle(new Vector3(1, 0, 0), 0.8)
    advance(controller, base, 0.2)
    expect(controller.snapshot.state).toBe('TRACKING')
    expectSamePose(controller.rotations, base)
  })

  it.each([
    { active: false, trackingStatus: 'idle' }, { trackingStatus: 'lost' },
    { calibrated: false }, { enabled: false }, { generation: 2 }, { mirrored: true },
    { mode: 'demo', active: false, calibrated: false, trackingStatus: 'demo' },
  ] as const)('closes the hit window immediately and fades after context interruption %j', (context) => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.17)
    expect(controller.snapshot.hitActive).toBe(true)
    const before = controller.rotations.leftShoulder.clone()
    controller.update(base, input(context), 0)
    expect(controller.snapshot.state).toBe('RETURNING')
    expect(controller.snapshot.phase).toBeNull()
    expect(controller.snapshot.hitActive).toBe(false)
    expect(controller.rotations.leftShoulder.angleTo(before)).toBeLessThan(1e-7)
    base.leftShoulder.setFromAxisAngle(new Vector3(0, 0, 1), 0.5)
    advance(controller, base, 0.2, context)
    expect(controller.snapshot.state).not.toBe('RETURNING')
    expectSamePose(controller.rotations, base)
  })

  it('drops even a new-epoch pulse while the previous attack is returning', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    start(controller, base)
    advance(controller, base, 0.17)
    const next = pulse(1, 'PUNCH_RIGHT', 1170, 2)
    controller.update(base, input({ generation: 2, gesture: next, now: 1170 }), 0)
    expect(controller.snapshot.state).toBe('RETURNING')
    advance(controller, base, 0.2, { generation: 2 })
    controller.update(base, input({ generation: 2, gesture: next, now: 1370 }), 0)
    expect(controller.snapshot.acceptedAttacks).toBe(1)
  })

  it('freezes duration and intensity settings for an already accepted attack', () => {
    const first = new HybridAnimationController(0)
    const second = new HybridAnimationController(0)
    const base = basePose()
    start(first, base)
    start(second, base)
    advance(first, base, 0.18)
    advance(second, base, 0.18)
    advance(first, base, 0.1, { durationScale: 1.35, intensity: 0.6 })
    advance(second, base, 0.1)
    expect(first.snapshot.progress).toBeCloseTo(second.snapshot.progress)
    expectSamePose(first.rotations, second.rotations)
    advance(first, base, 0.3, { durationScale: 1.35, intensity: 0.6 })
    expect(first.snapshot.state).toBe('TRACKING')
    start(first, base, { durationScale: 1.35, intensity: 0.6, now: 2000, gesture: pulse(2, 'PUNCH_LEFT', 2000) })
    advance(first, base, 0.6, { durationScale: 1.35, intensity: 0.6 })
    expect(first.snapshot.state).toBe('PUNCH_LEFT')
  })

  it('samples equivalent poses and metadata at 30, 60 and 120 display FPS', () => {
    const base = basePose()
    const sampleAt = (fps: number) => {
      const controller = new HybridAnimationController(0)
      start(controller, base)
      advance(controller, base, 0.3, {}, fps)
      return controller
    }
    const thirty = sampleAt(30)
    for (const fps of [60, 120]) {
      const sampled = sampleAt(fps)
      expectSamePose(sampled.rotations, thirty.rotations)
      expect(sampled.snapshot.progress).toBeCloseTo(thirty.snapshot.progress, 10)
      expect(sampled.snapshot.phase).toBe(thirty.snapshot.phase)
      expect(sampled.snapshot.hitActive).toBe(thirty.snapshot.hitActive)
    }
  })

  it('exposes the authored hit window only during the applied attack sample', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    const window = getPunchHitWindow()
    start(controller, base)
    expect(controller.snapshot.hitActive).toBe(false)
    advance(controller, base, (window.start + window.end) / 2)
    expect(controller.snapshot.phase).toBe('strike')
    expect(controller.snapshot.hitActive).toBe(true)
    advance(controller, base, getPunchDuration())
    expect(controller.snapshot.hitActive).toBe(false)
    expect(controller.snapshot.blendWeight).toBe(0)
  })
})

describe('HybridAnimationController explicit demo source', () => {
  it('does not inject attacks into the existing movement-only demo', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    advance(controller, base, 5, { ...DEMO, demoAttacks: false })
    expect(controller.snapshot.acceptedAttacks).toBe(0)
    expect(controller.snapshot.source).toBeNull()
    expectSamePose(controller.rotations, base)
  })

  it('alternates authored attacks without active webcam, calibration or gesture events', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    advance(controller, base, 1.17, DEMO)
    expect(controller.snapshot.acceptedAttacks).toBe(1)
    expect(controller.snapshot.attackSide).toBe('left')
    expect(controller.snapshot.source).toBe('demo')
    advance(controller, base, 1.65, DEMO)
    expect(controller.snapshot.acceptedAttacks).toBe(2)
    expect(controller.snapshot.attackSide).toBe('right')
    expect(controller.snapshot.source).toBe('demo')
  })

  it('freezes pose, clock and phase immediately when a demo is paused', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    advance(controller, base, 1.17, DEMO)
    const frozen = { ...controller.snapshot }
    const pose = Object.fromEntries(RIG_JOINTS.map((name) => [name, controller.rotations[name].clone()])) as Base
    advance(controller, base, 3, { ...DEMO, paused: true })
    expect(controller.snapshot).toEqual(frozen)
    expectSamePose(controller.rotations, pose)
    advance(controller, base, 0.01, DEMO)
    expect(controller.snapshot.progress).toBeGreaterThan(frozen.progress)
    expect(controller.snapshot.progress - frozen.progress).toBeLessThan(0.03)
  })

  it('cancels and restarts the demo clock when changing routines', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    advance(controller, base, 1.17, DEMO)
    controller.update(base, input({ ...DEMO, demoAttacks: false }), 0)
    expect(controller.snapshot.state).toBe('RETURNING')
    expect(controller.snapshot.hitActive).toBe(false)
    advance(controller, base, 0.2, { ...DEMO, demoAttacks: false })
    expect(controller.snapshot.source).toBeNull()
    advance(controller, base, 0.99, DEMO)
    expect(controller.snapshot.acceptedAttacks).toBe(1)
    advance(controller, base, 0.02, DEMO)
    expect(controller.snapshot.acceptedAttacks).toBe(2)
    expect(controller.snapshot.attackSide).toBe('left')
  })

  it('cancels a paused demo hit immediately when the layer is disabled', () => {
    const controller = new HybridAnimationController(0)
    const base = basePose()
    advance(controller, base, 1.17, DEMO)
    expect(controller.snapshot.hitActive).toBe(true)
    controller.update(base, input({ ...DEMO, paused: true, enabled: false }), 0)
    expect(controller.snapshot.state).toBe('RETURNING')
    expect(controller.snapshot.phase).toBeNull()
    expect(controller.snapshot.progress).toBe(0)
    expect(controller.snapshot.hitActive).toBe(false)
  })
})
