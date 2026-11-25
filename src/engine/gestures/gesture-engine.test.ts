import { describe, expect, it } from 'vitest'
import { MotionFeatureExtractor } from '../motion/motion-features'
import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures } from '../../types/combat-motion'
import type { Landmark, ProcessedPose } from '../../types/motion'
import { GestureEngine } from './gesture-engine'
import type { GestureContext, GestureSnapshot } from './gesture-engine'

const profile: CalibrationProfile = {
  capturedAt: 0, shoulderWidth: 0.3, worldShoulderWidth: 0.4, neutralTorsoLean: 0.12,
  guardLeft: { x: 0.35, y: 0.5, z: 0.2 }, guardRight: { x: -0.35, y: 0.5, z: 0.2 },
  upperArm: 0.8, forearm: 0.7,
}
const context: GestureContext = { enabled: true, calibrating: false, profile }

function arm(side: 'left' | 'right', overrides: Partial<ArmMotionFeatures> = {}): ArmMotionFeatures {
  return {
    wrist: { ...(side === 'left' ? profile.guardLeft : profile.guardRight) },
    velocity: { x: 0, y: 0, z: 0 }, extension: 0.56, elbowAngle: 1.5, reach: 0.56, reachAngle: 1.5,
    wristAboveElbow: 0.4, confidence: 0.95, forwardEvidence: false, depthAvailable: false, ...overrides,
  }
}

function features(timestamp: number, overrides: Partial<MotionFeatures> = {}): MotionFeatures {
  return { timestamp, valid: true, confidence: 0.95, torsoLean: 0, leftArm: arm('left'), rightArm: arm('right'), depthAvailable: false, ...overrides }
}

/** Progress 0 is the guard (reach 0.56); progress 1 is a straight arm (reach 0.96). */
function extending(side: 'left' | 'right', progress: number, overrides: Partial<ArmMotionFeatures> = {}): ArmMotionFeatures {
  const origin = side === 'left' ? profile.guardLeft : profile.guardRight
  return arm(side, {
    wrist: { ...origin, y: origin.y * (1 - progress) },
    extension: 0.56 + 0.4 * progress, elbowAngle: 1.5 + 1.4 * progress,
    reach: 0.56 + 0.4 * progress, reachAngle: 1.5 + 1.4 * progress, ...overrides,
  })
}

function punchSequence(
  engine: GestureEngine,
  side: 'left' | 'right' = 'left',
  start = 0,
  transform: (sample: ArmMotionFeatures) => ArmMotionFeatures = (sample) => sample,
  currentContext: GestureContext = context,
): GestureSnapshot[] {
  return [0, 0.3, 0.95].map((progress, index) => engine.update(features(start + index * 40, {
    [side === 'left' ? 'leftArm' : 'rightArm']: transform(extending(side, progress)),
  }), currentContext))
}

function punches(results: readonly GestureSnapshot[]): string[] {
  return results.flatMap((result) => result.event?.type.startsWith('PUNCH') ? [result.event.type] : [])
}

describe('GestureEngine punches from 2D reach', () => {
  it.each(['left', 'right'] as const)('recognizes a %s punch without any depth as exactly one pulse', (side) => {
    const engine = new GestureEngine()
    const results = punchSequence(engine, side)
    expect(punches(results)).toEqual([side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT'])
    expect(results[2]?.event).toEqual({ type: side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', timestamp: 80, confidence: 0.95 })
    const held = [120, 160, 600, 1000].map((timestamp) => engine.update(features(timestamp, { [side === 'left' ? 'leftArm' : 'rightArm']: extending(side, 0.95) }), context))
    expect(punches(held)).toEqual([])
  })

  it('accepts a fast punch seen in only two camera frames', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    expect(engine.update(features(33, { leftArm: extending('left', 1) }), context).event?.type).toBe('PUNCH_LEFT')
  })

  it('requires pulling back before the next punch, then accepts it after the cooldown', () => {
    const engine = new GestureEngine()
    punchSequence(engine)
    const jitter = [0.9, 0.86, 0.92, 0.85, 0.9, 0.84, 0.93, 0.86, 0.91, 0.85].map((reach, index) =>
      engine.update(features(120 + index * 80, { leftArm: extending('left', 1, { reach }) }), context))
    expect(punches(jitter)).toEqual([])
    expect(punches(punchSequence(engine, 'left', 1000))).toEqual(['PUNCH_LEFT'])
  })

  it('does not bypass the cooldown by retracting immediately', () => {
    const engine = new GestureEngine()
    punchSequence(engine)
    expect(punches(punchSequence(engine, 'left', 120))).toEqual([])
    expect(punches(punchSequence(engine, 'left', 440))).toEqual(['PUNCH_LEFT'])
  })

  it('keeps the opposite arm independent of a punch cooldown', () => {
    const engine = new GestureEngine()
    punchSequence(engine, 'left')
    expect(punches(punchSequence(engine, 'right', 120))).toEqual(['PUNCH_RIGHT'])
  })

  it('does not recognize a session starting with an extended fist', () => {
    const engine = new GestureEngine()
    const results = [0.7, 0.85, 0.95, 1].map((progress, index) => engine.update(features(index * 40, { leftArm: extending('left', progress) }), context))
    expect(punches(results)).toEqual([])
  })

  it('rejects a slow push of more than a second, even split into smaller gains', () => {
    const engine = new GestureEngine()
    const results = Array.from({ length: 24 }, (_, index) =>
      engine.update(features(index * 50, { leftArm: extending('left', index / 23) }), context))
    expect(punches(results)).toEqual([])
  })

  it.each([
    ['a bent arm', 0.15, { reachAngle: 2.1 }],
    ['a hanging arm', 0.15, { wrist: { x: 0.35, y: -1.2, z: 0 } }],
    ['an arm raised overhead', 0.15, { wrist: { x: 0.35, y: 1.6, z: 0 } }],
    ['a small reach gain from a half-extended arm', 0.55, {}],
  ] as const)('rejects %s', (_label, start, change) => {
    const engine = new GestureEngine()
    engine.update(features(0, { leftArm: extending('left', start) }), context)
    expect(engine.update(features(40, { leftArm: extending('left', 0.98, change) }), context).event).toBeNull()
  })

  it.each(['left', 'right'] as const)('recognizes one %s punch toward the camera from projected 2D landmarks only', (side) => {
    const width = 0.3
    const upper = 0.8
    const forearm = 0.7
    const geometry = (progress: number) => {
      // A guard (upper arm down and forward, forearm raised) rotating toward the camera.
      const upperAngle = -0.7 + 0.8 * progress
      const forearmAngle = 1.5 - 1.25 * progress
      const elbowY = Math.sin(upperAngle) * upper
      return { elbowY, wristY: elbowY + Math.sin(forearmAngle) * forearm }
    }
    const pose = (timestamp: number, progress: number): ProcessedPose => {
      const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
      const guard = geometry(0)
      const current = geometry(progress)
      const place = (index: number, x: number, y: number) => { landmarks[index] = { x, y: 0.4 - y * width, z: 0, visibility: 0.95 } }
      place(0, 0.5, 0.8)
      place(11, 0.65, 0)
      place(12, 0.35, 0)
      for (const [arm, value] of [['left', side === 'left' ? current : guard], ['right', side === 'right' ? current : guard]] as const) {
        const x = arm === 'left' ? 0.65 : 0.35
        place(arm === 'left' ? 13 : 14, x, value.elbowY)
        place(arm === 'left' ? 15 : 16, x, value.wristY)
      }
      return { timestamp, landmarks, worldLandmarks: [], confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9,
        status: 'tracking', framing: 'ready', shoulderWidth: width, torsoLean: 0 }
    }
    const calibrated: CalibrationProfile = { ...profile, shoulderWidth: width, neutralTorsoLean: 0, upperArm: upper, forearm,
      guardLeft: { x: 0.5, y: geometry(0).wristY, z: 0 }, guardRight: { x: -0.5, y: geometry(0).wristY, z: 0 } }
    const extractor = new MotionFeatureExtractor()
    const engine = new GestureEngine()
    const interval = 1000 / 24
    const results: GestureSnapshot[] = []
    let guardReach = 0
    let punchReach = 0
    for (let frame = 0; frame <= 16; frame++) {
      const progress = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, frame - 6) / 6))) / 2
      const current = extractor.update(pose(frame * interval, progress), calibrated)
      const arm = side === 'left' ? current.leftArm : current.rightArm
      if (frame === 0) guardReach = arm?.reach ?? 0
      if (frame === 12) punchReach = arm?.reach ?? 0
      expect(current.depthAvailable).toBe(false)
      results.push(engine.update(current, { ...context, profile: calibrated }))
    }
    expect(guardReach).toBeLessThan(0.55)
    expect(punchReach).toBeGreaterThan(0.95)
    expect(punches(results)).toEqual([side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT'])
  })
})

describe('GestureEngine reliability gates', () => {
  it.each(['disabled', 'calibrating', 'missing-profile'] as const)('never emits while %s', (condition) => {
    const disabled = { ...context, enabled: condition !== 'disabled', calibrating: condition === 'calibrating', profile: condition === 'missing-profile' ? null : profile }
    const engine = new GestureEngine()
    expect(punchSequence(engine, 'left', 0, (sample) => sample, disabled).every((result) => result.event === null && result.posture === 'neutral')).toBe(true)
    expect(engine.update(features(500, { torsoLean: 0.3 }), disabled).event).toBeNull()
  })

  it('discards priming across missing, invalid or low-confidence frames', () => {
    for (const bad of [null, features(60, { valid: false }), features(60, { confidence: 0.2 }), features(60, { torsoLean: Number.NaN })]) {
      const engine = new GestureEngine()
      engine.update(features(0), context)
      engine.update(features(40, { leftArm: extending('left', 0.3) }), context)
      engine.update(bad, context)
      expect(engine.update(features(80, { leftArm: extending('left', 0.9) }), context).event).toBeNull()
      expect(engine.update(features(120, { leftArm: extending('left', 1) }), context).event).toBeNull()
    }
  })

  it('rejects an unreliable arm without treating it as a retraction', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(40, { leftArm: extending('left', 0.3, { confidence: 0.1 }) }), context)
    for (const [index, progress] of [0.9, 1].entries()) {
      expect(engine.update(features(80 + index * 40, { leftArm: extending('left', progress) }), context).event).toBeNull()
    }
  })

  it('resets temporal evidence after gaps, stale timestamps and recalibration', () => {
    for (const breakTime of [40, -10, 500]) {
      const engine = new GestureEngine()
      engine.update(features(0), context)
      engine.update(features(40, { leftArm: extending('left', 0.3) }), context)
      expect(engine.update(features(breakTime, { leftArm: extending('left', 0.9) }), context).event).toBeNull()
      expect(engine.update(features(breakTime + 40, { leftArm: extending('left', 1) }), context).event).toBeNull()
    }
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(40, { leftArm: extending('left', 0.3) }), context)
    const recalibrated = { ...context, profile: { ...profile, capturedAt: 80 } }
    expect(engine.update(features(80, { leftArm: extending('left', 0.9) }), recalibrated).event).toBeNull()
    expect(engine.update(features(120, { leftArm: extending('left', 1) }), recalibrated).event).toBeNull()
  })

  it('clears all state when explicitly reset or disabled', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(180), context)
    engine.reset()
    expect(engine.update(features(220), { ...context, enabled: false })).toEqual({ posture: 'neutral', event: null })
    expect(engine.update(features(260), context)).toEqual({ posture: 'neutral', event: null })
  })
})

describe('GestureEngine posture events', () => {
  it('requires both raised, bent arms and a guard dwell; emits only on entry', () => {
    const engine = new GestureEngine()
    expect(engine.update(features(0), context).event).toBeNull()
    expect(engine.update(features(100), context).posture).toBe('neutral')
    expect(engine.update(features(160), context)).toMatchObject({ posture: 'guard', event: { type: 'GUARD' } })
    expect(engine.update(features(200), context)).toEqual({ posture: 'guard', event: null })
    const lowered = new GestureEngine()
    for (const timestamp of [0, 100, 200]) {
      const result = lowered.update(features(timestamp, { leftArm: arm('left', { wristAboveElbow: -0.5 }) }), context)
      expect(result.posture).toBe('neutral')
      expect(result.event).toBeNull()
    }
  })

  it('keeps a guard through its wider release threshold and clears lost input', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(160), context)
    const slightShift = arm('left', { wrist: { ...profile.guardLeft, x: profile.guardLeft.x + 0.55 } })
    expect(engine.update(features(200, { leftArm: slightShift }), context).posture).toBe('guard')
    expect(engine.update(features(320, { leftArm: slightShift }), context).posture).toBe('guard')
    expect(engine.update(null, context)).toEqual({ posture: 'neutral', event: null })
  })

  it.each([{ lean: 0.23, posture: 'dodge-left', type: 'DODGE_LEFT' }, { lean: -0.23, posture: 'dodge-right', type: 'DODGE_RIGHT' }] as const)('recognizes $type with dwell and anatomical sign', ({ lean, posture, type }) => {
    const engine = new GestureEngine()
    expect(engine.update(features(0, { torsoLean: lean }), context).event).toBeNull()
    expect(engine.update(features(60, { torsoLean: lean }), context).posture).toBe('neutral')
    expect(engine.update(features(110, { torsoLean: lean }), context)).toMatchObject({ posture, event: { type } })
    expect(engine.update(features(160, { torsoLean: lean * 0.6 }), context)).toEqual({ posture, event: null })
    engine.update(features(200, { torsoLean: 0, leftArm: null }), context)
    expect(engine.update(features(300, { torsoLean: 0, leftArm: null }), context).posture).toBe('neutral')
  })

  it('uses already-neutralized lean without subtracting calibration twice', () => {
    const engine = new GestureEngine()
    const calibratedContext = { ...context, profile: { ...profile, neutralTorsoLean: 0.3 } }
    for (const timestamp of [0, 100, 200]) {
      expect(engine.update(features(timestamp, { leftArm: null, rightArm: null, torsoLean: 0 }), calibratedContext).event).toBeNull()
    }
  })

  it('does not turn transient leaning or threshold jitter into dodge events', () => {
    const engine = new GestureEngine()
    for (const [index, lean] of [0, 0.2, 0.1, 0.19, 0.12, 0.17, 0].entries()) {
      expect(engine.update(features(index * 40, { torsoLean: lean, leftArm: null }), context).event).toBeNull()
    }
  })

  it('suppresses repeated posture events when rapidly leaving and reentering', () => {
    const engine = new GestureEngine()
    engine.update(features(0, { torsoLean: 0.25 }), context)
    expect(engine.update(features(100, { torsoLean: 0.25 }), context).event?.type).toBe('DODGE_LEFT')
    engine.update(features(120, { torsoLean: 0, leftArm: null }), context)
    engine.update(features(210, { torsoLean: 0, leftArm: null }), context)
    engine.update(features(220, { torsoLean: 0.25 }), context)
    expect(engine.update(features(320, { torsoLean: 0.25 }), context)).toEqual({ posture: 'dodge-left', event: null })
  })
})
