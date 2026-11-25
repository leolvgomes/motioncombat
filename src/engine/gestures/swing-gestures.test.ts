import { describe, expect, it } from 'vitest'
import { MotionFeatureExtractor } from '../motion/motion-features'
import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures } from '../../types/combat-motion'
import type { Landmark, ProcessedPose } from '../../types/motion'
import { GestureEngine, attackOfGesture } from './gesture-engine'
import type { GestureContext } from './gesture-engine'

type Side = 'left' | 'right'
/** Wrist path in body units: outward from the midline on its own side, and height from the shoulders. */
type Point = readonly [outward: number, y: number]

const profile: CalibrationProfile = {
  capturedAt: 0, shoulderWidth: 0.3, worldShoulderWidth: 0.4, neutralTorsoLean: 0,
  guardLeft: { x: 0.35, y: 0.5, z: 0 }, guardRight: { x: -0.35, y: 0.5, z: 0 }, upperArm: 0.8, forearm: 0.7,
}
const context: GestureContext = { enabled: true, calibrating: false, profile, advancedAttacks: true }
const GUARD: Point = [0.35, 0.5]
const HOOK: readonly Point[] = [GUARD, [0.6, 0.35], [0.85, 0.25], [0.55, 0.22], [0.2, 0.2], [0, 0.2], [0.2, 0.35], GUARD]
const UPPERCUT: readonly Point[] = [GUARD, [0.35, 0.1], [0.35, -0.45], [0.32, -0.1], [0.3, 0.35], [0.3, 0.7], GUARD]

const signOf = (side: Side) => side === 'left' ? 1 : -1

function arm(side: Side, point: Point, previous: Point | null, dt: number, overrides: Partial<ArmMotionFeatures> = {}): ArmMotionFeatures {
  const sign = signOf(side)
  return {
    wrist: { x: point[0] * sign, y: point[1], z: 0 },
    velocity: { x: previous ? (point[0] - previous[0]) * sign / dt : 0, y: previous ? (point[1] - previous[1]) / dt : 0, z: 0 },
    extension: 0.56, elbowAngle: 1.5, reach: 0.56, reachAngle: 1.5, wristAboveElbow: 0.4, confidence: 0.95,
    forwardEvidence: false, depthAvailable: false, ...overrides,
  }
}

function play(
  paths: Partial<Record<Side, readonly Point[]>>,
  { engine = new GestureEngine(), interval = 50, start = 0, ctx = context, overrides = {} as Partial<Record<Side, Partial<ArmMotionFeatures>>> } = {},
): string[] {
  const length = Math.max(paths.left?.length ?? 0, paths.right?.length ?? 0)
  const events: string[] = []
  const point = (side: Side, index: number): Point => paths[side]?.[Math.min(index, paths[side]!.length - 1)] ?? GUARD
  for (let index = 0; index < length; index++) {
    const build = (side: Side) => arm(side, point(side, index), index > 0 ? point(side, index - 1) : null, interval / 1000, overrides[side])
    const features: MotionFeatures = {
      timestamp: start + index * interval, valid: true, confidence: 0.95, torsoLean: 0,
      leftArm: build('left'), rightArm: build('right'), depthAvailable: false,
    }
    const { event } = engine.update(features, ctx)
    if (event && attackOfGesture(event.type)) events.push(event.type)
  }
  return events
}

describe('attackOfGesture', () => {
  it('describes attacks and ignores postures', () => {
    expect(attackOfGesture('HOOK_LEFT')).toEqual({ kind: 'hook', side: 'left' })
    expect(attackOfGesture('UPPERCUT_RIGHT')).toEqual({ kind: 'uppercut', side: 'right' })
    expect(attackOfGesture('PUNCH_LEFT')).toEqual({ kind: 'straight', side: 'left' })
    expect(attackOfGesture('GUARD')).toBeNull()
    expect(attackOfGesture('DODGE_RIGHT')).toBeNull()
    expect(attackOfGesture('toString' as never)).toBeNull()
  })
})

describe('GestureEngine hooks and uppercuts', () => {
  it.each(['left', 'right'] as const)('recognizes one %s hook and one uppercut', (side) => {
    expect(play({ [side]: HOOK })).toEqual([side === 'left' ? 'HOOK_LEFT' : 'HOOK_RIGHT'])
    expect(play({ [side]: UPPERCUT })).toEqual([side === 'left' ? 'UPPERCUT_LEFT' : 'UPPERCUT_RIGHT'])
  })

  it.each([33, 42, 60])('works at a %s ms capture interval', (interval) => {
    expect(play({ left: HOOK }, { interval })).toEqual(['HOOK_LEFT'])
    expect(play({ left: UPPERCUT }, { interval })).toEqual(['UPPERCUT_LEFT'])
  })

  it('emits nothing new when advanced attacks are off', () => {
    const ctx = { ...context, advancedAttacks: false }
    expect(play({ left: HOOK }, { ctx })).toEqual([])
    expect(play({ left: UPPERCUT }, { ctx })).toEqual([])
    const { advancedAttacks: _omitted, ...basic } = context
    expect(play({ left: HOOK }, { ctx: basic })).toEqual([])
  })

  it('requires a fast movement', () => {
    expect(play({ left: HOOK }, { interval: 160 })).toEqual([])
    expect(play({ left: UPPERCUT }, { interval: 240 })).toEqual([])
  })

  it.each([
    ['raising both fists into guard', [[0.4, -1.1], [0.4, -0.5], [0.38, 0], [0.36, 0.35], GUARD]],
    ['closing both open arms', [[1.2, 0.2], [0.9, 0.2], [0.5, 0.2], [0.15, 0.2], [0, 0.2]]],
  ] as const)('ignores %s', (_label, path) => {
    expect(play({ left: path, right: path })).toEqual([])
  })

  it.each([
    ['a hook', HOOK], ['an uppercut', UPPERCUT],
  ] as const)('ignores %s shape while the other arm hangs', (_label, path) => {
    expect(play({ left: path, right: [[0.5, -1.4]] })).toEqual([])
  })

  it.each([
    ['a hand brought in from the waist', [[0.8, -1], [0.6, -0.7], [0.3, -0.5], [0.1, -0.4]]],
    ['a short guard adjustment', [GUARD, [0.6, 0.45], [0.4, 0.5], GUARD]],
    ['a diagonal slap downwards', [[0.8, 0.9], [0.5, 0.4], [0.1, -0.2]]],
    ['a hand raised from a low guard without passing the shoulder line', [[0.3, -0.5], [0.3, -0.2], [0.3, 0], [0.3, 0.1]]],
    ['a fist thrown outwards', [[0, 0.2], [0.4, 0.2], [0.9, 0.2]]],
  ] as const)('ignores %s', (_label, path) => {
    expect(play({ left: path })).toEqual([])
  })

  it('rejects straightened or unreliable arms', () => {
    expect(play({ left: HOOK }, { overrides: { left: { reachAngle: 2.8 } } })).toEqual([])
    expect(play({ left: HOOK }, { overrides: { left: { confidence: 0.3 } } })).toEqual([])
    expect(play({ left: HOOK }, { overrides: { right: { confidence: 0.3 } } })).toEqual([])
    expect(play({ left: UPPERCUT }, { overrides: { left: { wristAboveElbow: 0 } } })).toEqual([])
  })

  it('never repeats a held end position and accepts a new complete swing after the cooldown', () => {
    const engine = new GestureEngine()
    const held: Point[] = [...HOOK.slice(0, 6), ...Array.from({ length: 12 }, (): Point => [0, 0.2])]
    expect(play({ left: held }, { engine })).toEqual(['HOOK_LEFT'])
    expect(play({ left: HOOK }, { engine, start: 1000 })).toEqual(['HOOK_LEFT'])
  })

  it('discards the path across gaps, resets and lost frames', () => {
    const engine = new GestureEngine()
    expect(play({ left: HOOK.slice(0, 3) }, { engine })).toEqual([])
    engine.update(null, context)
    expect(play({ left: HOOK.slice(4) }, { engine, start: 200 })).toEqual([])
  })

  it('still emits exactly one straight punch, with no swing before or after it', () => {
    for (const interval of [33, 42, 60]) {
      const engine = new GestureEngine()
      const extractor = new MotionFeatureExtractor()
      const events: string[] = []
      const shape = (progress: number) => {
        const upperAngle = -0.7 + 0.8 * progress
        const forearmAngle = 1.5 - 1.25 * progress
        const elbowY = Math.sin(upperAngle) * 0.8
        // The fist drifts inwards like a crossing punch.
        return { elbowY, wristY: elbowY + Math.sin(forearmAngle) * 0.7, inward: 0.3 * progress }
      }
      const pose = (timestamp: number, progress: number): ProcessedPose => {
        const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
        const place = (index: number, x: number, y: number) => { landmarks[index] = { x: 0.5 + x * 0.3, y: 0.4 - y * 0.3, z: 0, visibility: 0.95 } }
        place(0, 0, 0.8)
        place(11, 0.5, 0)
        place(12, -0.5, 0)
        const moving = shape(progress)
        const still = shape(0)
        place(13, 0.5 - moving.inward / 2, moving.elbowY)
        place(15, 0.5 - moving.inward, moving.wristY)
        place(14, -0.5, still.elbowY)
        place(16, -0.5, still.wristY)
        return { timestamp, landmarks, worldLandmarks: [], confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9,
          status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0 }
      }
      for (let time = 0; time <= 2400; time += interval) {
        // Extend, hold, retract, twice.
        const cycle = time % 1200
        const progress = cycle < 200 ? 0 : cycle < 420 ? (cycle - 200) / 220 : cycle < 520 ? 1 : cycle < 760 ? 1 - (cycle - 520) / 240 : 0
        const { event } = engine.update(extractor.update(pose(time, progress), profile), context)
        if (event && attackOfGesture(event.type)) events.push(event.type)
      }
      expect(events).toEqual(['PUNCH_LEFT', 'PUNCH_LEFT'])
    }
  })

  it('lets a straight punch follow a hook of the same arm', () => {
    const engine = new GestureEngine()
    expect(play({ left: HOOK }, { engine })).toEqual(['HOOK_LEFT'])
    const base = { valid: true, confidence: 0.95, torsoLean: 0, depthAvailable: false, rightArm: arm('right', GUARD, null, 0.05) }
    const reach = [0.5, 0.5, 0.56, 0.7, 0.95]
    const events = reach.flatMap((value, index) => {
      const left = arm('left', [0.35, 0.3 - index * 0.05], null, 0.05, { reach: value, reachAngle: 1.3 + value * 1.6 })
      const { event } = engine.update({ ...base, timestamp: 400 + index * 60, leftArm: left }, context)
      return event && attackOfGesture(event.type) ? [event.type] : []
    })
    expect(events).toEqual(['PUNCH_LEFT'])
  })
})
