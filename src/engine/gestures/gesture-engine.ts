import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures, MotionVector } from '../../types/combat-motion'

export type GestureType = 'PUNCH_LEFT' | 'PUNCH_RIGHT' | 'GUARD' | 'DODGE_LEFT' | 'DODGE_RIGHT'
export type GesturePosture = 'neutral' | 'guard' | 'dodge-left' | 'dodge-right'

export interface GestureEvent {
  readonly type: GestureType
  readonly timestamp: number
  /** Minimum confidence of the contributing inputs, not a gesture probability. */
  readonly confidence: number
}

export interface GestureSnapshot {
  readonly posture: GesturePosture
  /** An entry pulse. Holding a recognized movement never repeats this event. */
  readonly event: GestureEvent | null
}

export interface GestureContext {
  readonly enabled: boolean
  readonly calibrating: boolean
  readonly profile: CalibrationProfile | null
}

interface ArmHistory {
  origin: MotionVector | null
  originExtension: number
  originTime: number
  previousExtension: number | null
  forwardSamples: number
  cooldownUntil: number
}

const MIN_CONFIDENCE = 0.6
const MAX_SAMPLE_GAP_MS = 250
const PUNCH_COOLDOWN_MS = 500
const PUNCH_WINDOW_MS = 350
const MIN_PUNCH_WINDOW_MS = 60
const MIN_FORWARD_SPEED = 1.2
const MIN_FORWARD_TRAVEL = 0.18
const MIN_EXTENSION_GAIN = 0.18
const PUNCH_EXTENSION = 0.8
const RETRACTED_EXTENSION = 0.64
const GUARD_DWELL_MS = 150
const DODGE_DWELL_MS = 100
const RELEASE_DWELL_MS = 90
const POSTURE_COOLDOWN_MS = 300
const DODGE_ENTER_RADIANS = 0.18
const DODGE_EXIT_RADIANS = 0.11

function armHistory(): ArmHistory {
  return { origin: null, originExtension: 0, originTime: 0, previousExtension: null, forwardSamples: 0, cooldownUntil: 0 }
}

function finiteVector(vector: MotionVector): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function usableArm(arm: ArmMotionFeatures | null): ArmMotionFeatures | null {
  return arm && finiteVector(arm.wrist) && finiteVector(arm.velocity)
    && Number.isFinite(arm.confidence) && arm.confidence >= MIN_CONFIDENCE && arm.confidence <= 1
    && Number.isFinite(arm.extension) && arm.extension >= 0 && arm.extension <= 1
    && Number.isFinite(arm.elbowAngle) && arm.elbowAngle >= 0 && arm.elbowAngle <= Math.PI
    && Number.isFinite(arm.wristAboveElbow) ? arm : null
}

function validProfile(profile: CalibrationProfile): boolean {
  return Number.isFinite(profile.capturedAt)
    && Number.isFinite(profile.shoulderWidth) && profile.shoulderWidth > 0
    && Number.isFinite(profile.neutralTorsoLean)
    && finiteVector(profile.guardLeft) && finiteVector(profile.guardRight)
    && (profile.worldShoulderWidth === null || Number.isFinite(profile.worldShoulderWidth) && profile.worldShoulderWidth > 0)
}

/** Ignore uncertain depth for guard posture; calibrated image-plane proportions still work. */
function nearGuard(arm: ArmMotionFeatures | null, reference: MotionVector, holding: boolean): boolean {
  if (!arm) return false
  const radius = holding ? 0.68 : 0.46
  return Math.hypot(arm.wrist.x - reference.x, arm.wrist.y - reference.y) <= radius
    && arm.wrist.y >= reference.y - (holding ? 0.42 : 0.28)
    && arm.wristAboveElbow >= (holding ? -0.18 : -0.06)
    && arm.extension <= (holding ? 0.9 : 0.82)
    && arm.elbowAngle <= (holding ? 2.95 : 2.72)
}

function clearArm(history: ArmHistory): void {
  history.origin = null
  history.originExtension = 0
  history.originTime = 0
  history.previousExtension = null
  history.forwardSamples = 0
}

/**
 * Heuristics consume body-relative geometry, independently of React, the webcam and
 * display mirroring. Straight punches deliberately require trustworthy 3D evidence;
 * sideways or depth-free wrist motion is insufficient to claim a forward punch.
 */
export class GestureEngine {
  private readonly left = armHistory()
  private readonly right = armHistory()
  private profile: CalibrationProfile | null = null
  private previousTimestamp: number | null = null
  private posture: GesturePosture = 'neutral'
  private pendingPosture: GesturePosture = 'neutral'
  private pendingSince = 0
  private postureCooldownUntil = 0

  reset(): void {
    this.clearTracking()
    this.profile = null
    this.left.cooldownUntil = 0
    this.right.cooldownUntil = 0
    this.postureCooldownUntil = 0
  }

  update(features: MotionFeatures | null, context: GestureContext): GestureSnapshot {
    if (!context.enabled || context.calibrating || !context.profile || !validProfile(context.profile)) {
      this.reset()
      return this.snapshot()
    }
    if (this.profile !== context.profile) {
      this.reset()
      this.profile = context.profile
    }
    if (!features || !features.valid
      || !Number.isFinite(features.timestamp) || features.timestamp < 0
      || !Number.isFinite(features.confidence) || features.confidence < MIN_CONFIDENCE || features.confidence > 1
      || !Number.isFinite(features.torsoLean)) {
      this.clearTracking()
      return this.snapshot()
    }

    const timestamp = features.timestamp
    if (this.previousTimestamp !== null && timestamp <= this.previousTimestamp) {
      this.clearTracking()
      return this.snapshot()
    }
    if (this.previousTimestamp !== null && timestamp - this.previousTimestamp > MAX_SAMPLE_GAP_MS) this.clearTracking()
    this.previousTimestamp = timestamp

    const left = usableArm(features.leftArm)
    const right = usableArm(features.rightArm)
    const leftPunch = this.punch(this.left, left, context.profile.guardLeft, features, 'PUNCH_LEFT')
    const rightPunch = this.punch(this.right, right, context.profile.guardRight, features, 'PUNCH_RIGHT')
    const punch = leftPunch ?? rightPunch
    if (punch) {
      const history = punch.type === 'PUNCH_LEFT' ? this.left : this.right
      clearArm(history)
      history.cooldownUntil = timestamp + PUNCH_COOLDOWN_MS
    }
    const postureEvent = this.updatePosture(features, left, right, context.profile, punch === null)
    return this.snapshot(punch ?? postureEvent)
  }

  private clearTracking(): void {
    clearArm(this.left)
    clearArm(this.right)
    this.previousTimestamp = null
    this.posture = 'neutral'
    this.pendingPosture = 'neutral'
    this.pendingSince = 0
  }

  private snapshot(event: GestureEvent | null = null): GestureSnapshot {
    return { posture: this.posture, event }
  }

  private punch(
    history: ArmHistory,
    arm: ArmMotionFeatures | null,
    guard: MotionVector,
    features: MotionFeatures,
    type: 'PUNCH_LEFT' | 'PUNCH_RIGHT',
  ): GestureEvent | null {
    if (!arm || !features.depthAvailable || !arm.depthAvailable) {
      clearArm(history)
      return null
    }
    const previousExtension = history.previousExtension
    history.previousExtension = arm.extension
    const retracted = arm.extension <= RETRACTED_EXTENSION
      || arm.extension <= 0.72 && nearGuard(arm, guard, false)
    if (retracted) {
      history.origin = { ...arm.wrist }
      history.originExtension = arm.extension
      history.originTime = features.timestamp
      history.forwardSamples = 0
      return null
    }
    const origin = history.origin
    if (!origin || previousExtension === null) return null

    const elapsed = features.timestamp - history.originTime
    if (elapsed > PUNCH_WINDOW_MS) {
      clearArm(history)
      return null
    }
    const rising = arm.extension - previousExtension >= 0.008
    const movingForward = features.depthAvailable && arm.forwardEvidence
      && arm.velocity.z >= MIN_FORWARD_SPEED
      && arm.velocity.z >= Math.abs(arm.velocity.x) * 1.1
      && arm.velocity.z >= Math.abs(arm.velocity.y) * 0.8
    history.forwardSamples = rising && movingForward ? history.forwardSamples + 1 : 0
    const forwardTravel = arm.wrist.z - origin.z
    if (features.timestamp < history.cooldownUntil
      || elapsed < MIN_PUNCH_WINDOW_MS || history.forwardSamples < 2
      || arm.extension < PUNCH_EXTENSION || arm.elbowAngle < 2.35
      || arm.extension - history.originExtension < MIN_EXTENSION_GAIN
      || forwardTravel < MIN_FORWARD_TRAVEL
      || forwardTravel < Math.abs(arm.wrist.x - origin.x) * 0.65
      || forwardTravel < Math.abs(arm.wrist.y - origin.y) * 0.65) return null

    return { type, timestamp: features.timestamp, confidence: Math.min(features.confidence, arm.confidence) }
  }

  private updatePosture(
    features: MotionFeatures,
    left: ArmMotionFeatures | null,
    right: ArmMotionFeatures | null,
    profile: CalibrationProfile,
    emit: boolean,
  ): GestureEvent | null {
    // The extractor already subtracts neutralTorsoLean. Raw image-right is the
    // player's anatomical left when facing the camera; UI mirroring is irrelevant.
    const lean = features.torsoLean
    const leftThreshold = this.posture === 'dodge-left' ? DODGE_EXIT_RADIANS : DODGE_ENTER_RADIANS
    const rightThreshold = this.posture === 'dodge-right' ? DODGE_EXIT_RADIANS : DODGE_ENTER_RADIANS
    const holdingGuard = this.posture === 'guard'
    const desired: GesturePosture = lean >= leftThreshold ? 'dodge-left'
      : lean <= -rightThreshold ? 'dodge-right'
        : nearGuard(left, profile.guardLeft, holdingGuard) && nearGuard(right, profile.guardRight, holdingGuard) ? 'guard' : 'neutral'

    if (desired === this.posture) {
      this.pendingPosture = desired
      this.pendingSince = features.timestamp
      return null
    }
    if (desired !== this.pendingPosture) {
      this.pendingPosture = desired
      this.pendingSince = features.timestamp
      return null
    }
    const dwell = desired === 'guard' ? GUARD_DWELL_MS : desired === 'neutral' ? RELEASE_DWELL_MS : DODGE_DWELL_MS
    if (features.timestamp - this.pendingSince < dwell) return null
    this.posture = desired
    if (!emit || desired === 'neutral' || features.timestamp < this.postureCooldownUntil) return null
    this.postureCooldownUntil = features.timestamp + POSTURE_COOLDOWN_MS
    const type = desired === 'guard' ? 'GUARD' : desired === 'dodge-left' ? 'DODGE_LEFT' : 'DODGE_RIGHT'
    const confidence = desired === 'guard'
      ? Math.min(features.confidence, left?.confidence ?? 0, right?.confidence ?? 0)
      : features.confidence
    return { type, timestamp: features.timestamp, confidence }
  }
}
