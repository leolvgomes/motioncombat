import { describe, expect, it } from 'vitest'
import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures } from '../../types/combat-motion'
import { GestureEngine } from './gesture-engine'
import type { GestureContext, GestureSnapshot } from './gesture-engine'

const profile: CalibrationProfile = {
  capturedAt: 0, shoulderWidth: 0.3, worldShoulderWidth: 0.4, neutralTorsoLean: 0.12,
  guardLeft: { x: 0.35, y: 0.5, z: 0.2 }, guardRight: { x: -0.35, y: 0.5, z: 0.2 },
}
const context: GestureContext = { enabled: true, calibrating: false, profile }

function arm(side: 'left' | 'right', overrides: Partial<ArmMotionFeatures> = {}): ArmMotionFeatures {
  return {
    wrist: { ...(side === 'left' ? profile.guardLeft : profile.guardRight) },
    velocity: { x: 0, y: 0, z: 0 }, extension: 0.56, elbowAngle: 1.5,
    wristAboveElbow: 0.4, confidence: 0.95, forwardEvidence: false, depthAvailable: true, ...overrides,
  }
}

function features(timestamp: number, overrides: Partial<MotionFeatures> = {}): MotionFeatures {
  return { timestamp, valid: true, confidence: 0.95, torsoLean: 0, leftArm: arm('left'), rightArm: arm('right'), depthAvailable: true, ...overrides }
}

function extending(side: 'left' | 'right', progress: number, overrides: Partial<ArmMotionFeatures> = {}): ArmMotionFeatures {
  const origin = side === 'left' ? profile.guardLeft : profile.guardRight
  return arm(side, {
    wrist: { ...origin, z: origin.z + 0.7 * progress }, velocity: { x: 0, y: 0, z: 2.8 },
    extension: 0.56 + 0.38 * progress, elbowAngle: 1.5 + 1.35 * progress,
    forwardEvidence: true, ...overrides,
  })
}

function punchSequence(
  engine: GestureEngine,
  side: 'left' | 'right' = 'left',
  start = 0,
  transform: (sample: ArmMotionFeatures) => ArmMotionFeatures = (sample) => sample,
  currentContext: GestureContext = context,
): GestureSnapshot[] {
  return [0, 0.25, 0.65, 0.95].map((progress, index) => engine.update(features(start + index * 40, {
    [side === 'left' ? 'leftArm' : 'rightArm']: transform(extending(side, progress)),
  }), currentContext))
}

describe('GestureEngine straight punches', () => {
  it.each(['left', 'right'] as const)('recognizes a primed %s forward punch as exactly one pulse', (side) => {
    const engine = new GestureEngine()
    const results = punchSequence(engine, side)
    expect(results.flatMap((result) => result.event ? [result.event.type] : [])).toEqual([side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT'])
    expect(results[3]?.event).toEqual({ type: side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', timestamp: 120, confidence: 0.95 })
    for (const timestamp of [160, 200, 240, 280]) {
      const result = engine.update(features(timestamp, { [side === 'left' ? 'leftArm' : 'rightArm']: extending(side, 0.95) }), context)
      expect(result.event?.type).not.toBe(side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT')
    }
  })

  it('requires retraction even after the per-arm cooldown expires', () => {
    const engine = new GestureEngine()
    punchSequence(engine)
    for (let timestamp = 160; timestamp <= 1000; timestamp += 40) {
      expect(engine.update(features(timestamp, { leftArm: extending('left', 1) }), context).event?.type).not.toBe('PUNCH_LEFT')
    }
    const next = punchSequence(engine, 'left', 1040)
    expect(next[3]?.event?.type).toBe('PUNCH_LEFT')
  })

  it('does not bypass cooldown by retracting immediately', () => {
    const engine = new GestureEngine()
    punchSequence(engine)
    expect(punchSequence(engine, 'left', 160).some((result) => result.event?.type === 'PUNCH_LEFT')).toBe(false)
    for (const timestamp of [320, 400, 480, 560]) engine.update(features(timestamp), context)
    expect(punchSequence(engine, 'left', 600)[3]?.event?.type).toBe('PUNCH_LEFT')
  })

  it('keeps the opposite arm independent of a punch cooldown', () => {
    const engine = new GestureEngine()
    punchSequence(engine, 'left')
    expect(punchSequence(engine, 'right', 160)[3]?.event?.type).toBe('PUNCH_RIGHT')
  })

  it('does not recognize a session starting with an extended fist', () => {
    const engine = new GestureEngine()
    for (const [index, progress] of [0.65, 0.8, 0.95, 1].entries()) {
      expect(engine.update(features(index * 40, { leftArm: extending('left', progress) }), context).event?.type).not.toBe('PUNCH_LEFT')
    }
  })

  it('rejects a single forward spike followed by a held pose', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    for (const timestamp of [80, 120, 160]) {
      expect(engine.update(features(timestamp, { leftArm: extending('left', 1) }), context).event?.type).not.toBe('PUNCH_LEFT')
    }
  })

  it('rejects fast sideways swings even with incidental depth progress', () => {
    const engine = new GestureEngine()
    const results = punchSequence(engine, 'left', 0, (sample) => ({ ...sample, velocity: { x: 5, y: 0, z: 1.4 } }))
    expect(results.every((result) => result.event?.type !== 'PUNCH_LEFT')).toBe(true)
  })

  it('requires actual forward wrist travel, beyond a velocity estimate', () => {
    const engine = new GestureEngine()
    const results = punchSequence(engine, 'left', 0, (sample) => ({ ...sample, wrist: { ...sample.wrist, z: profile.guardLeft.z } }))
    expect(results.every((result) => result.event?.type !== 'PUNCH_LEFT')).toBe(true)
  })

  it('rejects slow extension and depth-free or untrusted forward evidence', () => {
    const slow = punchSequence(new GestureEngine(), 'left', 0, (sample) => ({ ...sample, velocity: { x: 0, y: 0, z: 0.6 } }))
    const untrusted = punchSequence(new GestureEngine(), 'left', 0, (sample) => ({ ...sample, forwardEvidence: false }))
    expect([...slow, ...untrusted].every((result) => result.event?.type !== 'PUNCH_LEFT')).toBe(true)
    const engine = new GestureEngine()
    for (const [index, progress] of [0, 0.25, 0.65, 0.95].entries()) {
      expect(engine.update(features(index * 40, { leftArm: extending('left', progress), depthAvailable: false }), context).event?.type).not.toBe('PUNCH_LEFT')
    }
  })

  it('expires a slow trajectory instead of recognizing a late acceleration', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(150, { leftArm: extending('left', 0.45, { velocity: { x: 0, y: 0, z: 0.5 } }) }), context)
    engine.update(features(300, { leftArm: extending('left', 0.7) }), context)
    expect(engine.update(features(400, { leftArm: extending('left', 1) }), context).event?.type).not.toBe('PUNCH_LEFT')
  })

  it.each(['left', 'right'] as const)('recognizes one %s punch in a coherent two-segment 3D arm trace sampled at 24 Hz', (side) => {
    const engine = new GestureEngine()
    const interval = 1000 / 24
    const segmentLength = 0.67
    const shoulderX = side === 'left' ? 0.5 : -0.5
    const geometry = (progress: number) => {
      // Two fixed-length segments rotate from a folded guard toward the camera.
      const upperAngle = -0.7 + 0.8 * progress
      const forearmAngle = 1.5 - 1.25 * progress
      const elbow = { x: shoulderX, y: Math.sin(upperAngle) * segmentLength, z: Math.cos(upperAngle) * segmentLength }
      const wrist = { x: shoulderX, y: elbow.y + Math.sin(forearmAngle) * segmentLength, z: elbow.z + Math.cos(forearmAngle) * segmentLength }
      return { wrist, elbow, elbowAngle: Math.PI - Math.abs(upperAngle - forearmAngle), extension: Math.hypot(wrist.y, wrist.z) / (2 * segmentLength) }
    }
    const neutral = geometry(0)
    const calibrated = { ...profile, [side === 'left' ? 'guardLeft' : 'guardRight']: neutral.wrist }
    const calibratedContext = { ...context, profile: calibrated }
    const events: string[] = []
    let previousWrist = neutral.wrist
    for (let frame = 0; frame <= 14; frame++) {
      const movingFrame = Math.max(0, frame - 6)
      const progress = (1 - Math.cos(Math.PI * Math.min(1, movingFrame / 6))) / 2
      const current = geometry(progress)
      const velocity = { x: 0, y: (current.wrist.y - previousWrist.y) * 24, z: (current.wrist.z - previousWrist.z) * 24 }
      const sample = arm(side, { ...current, wristAboveElbow: current.wrist.y - current.elbow.y, velocity, forwardEvidence: velocity.z > 0.25 })
      const result = engine.update(features(frame * interval, { [side === 'left' ? 'leftArm' : 'rightArm']: sample }), calibratedContext)
      if (result.event) events.push(result.event.type)
      previousWrist = current.wrist
    }
    expect(events.filter((event) => event.startsWith('PUNCH'))).toEqual([side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT'])
  })

  it('does not use the opposite arm depth as evidence for the punching arm', () => {
    const engine = new GestureEngine()
    const results = punchSequence(engine, 'left', 0, (sample) => ({ ...sample, depthAvailable: false }))
    expect(results.every((result) => result.event?.type !== 'PUNCH_LEFT')).toBe(true)
  })

  it('discards 2D priming and depth-loss history before a forward position jump', () => {
    for (const initialDepth of [true, false]) {
      const engine = new GestureEngine()
      engine.update(features(0, { leftArm: arm('left', { depthAvailable: initialDepth }) }), context)
      engine.update(features(40, { leftArm: arm('left', { depthAvailable: false }) }), context)
      for (const [index, progress] of [0.65, 0.85, 1].entries()) {
        expect(engine.update(features(80 + index * 40, { leftArm: extending('left', progress) }), context).event?.type).not.toBe('PUNCH_LEFT')
      }
    }
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
      engine.update(features(40, { leftArm: extending('left', 0.65) }), context)
      engine.update(bad, context)
      expect(engine.update(features(80, { leftArm: extending('left', 0.9) }), context).event).toBeNull()
      expect(engine.update(features(120, { leftArm: extending('left', 1) }), context).event).toBeNull()
    }
  })

  it('rejects an unreliable arm without treating it as a retraction', () => {
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(40, { leftArm: extending('left', 0.65, { confidence: 0.1 }) }), context)
    for (const [index, progress] of [0.9, 1].entries()) {
      expect(engine.update(features(80 + index * 40, { leftArm: extending('left', progress) }), context).event).toBeNull()
    }
  })

  it('resets temporal evidence after gaps, stale timestamps and recalibration', () => {
    for (const breakTime of [40, -10, 500]) {
      const engine = new GestureEngine()
      engine.update(features(0), context)
      engine.update(features(40, { leftArm: extending('left', 0.65) }), context)
      expect(engine.update(features(breakTime, { leftArm: extending('left', 0.9) }), context).event).toBeNull()
      expect(engine.update(features(breakTime + 40, { leftArm: extending('left', 1) }), context).event).toBeNull()
    }
    const engine = new GestureEngine()
    engine.update(features(0), context)
    engine.update(features(40, { leftArm: extending('left', 0.65) }), context)
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
