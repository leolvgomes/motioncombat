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
  /** The arm has pulled back and may throw the next punch. */
  armed: boolean
  /** Lowest reach of the current attempt and when it was seen. */
  originReach: number
  originTime: number
  /** Highest reach since the last punch; Infinity when no punch is pending release. */
  peakReach: number
  cooldownUntil: number
}

const MIN_CONFIDENCE = 0.6
const MAX_SAMPLE_GAP_MS = 250
const PUNCH_COOLDOWN_MS = 350
// Gain over window sets the slowest accepted punch: 0.5 reach per second.
const PUNCH_WINDOW_MS = 400
const PUNCH_REACH = 0.8
const PUNCH_ELBOW_ANGLE = 2.3
const MIN_REACH_GAIN = 0.2
const RELEASE_DROP = 0.12
const PUNCH_LOWEST_WRIST = -0.6
const PUNCH_HIGHEST_WRIST = 1.2
const GUARD_DWELL_MS = 150
const DODGE_DWELL_MS = 100
const RELEASE_DWELL_MS = 90
const POSTURE_COOLDOWN_MS = 300
const DODGE_ENTER_RADIANS = 0.18
const DODGE_EXIT_RADIANS = 0.11

function armHistory(): ArmHistory {
  return { armed: false, originReach: 0, originTime: 0, peakReach: Infinity, cooldownUntil: 0 }
}

function finiteVector(vector: MotionVector): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function usableArm(arm: ArmMotionFeatures | null): ArmMotionFeatures | null {
  return arm && finiteVector(arm.wrist) && finiteVector(arm.velocity)
    && Number.isFinite(arm.confidence) && arm.confidence >= MIN_CONFIDENCE && arm.confidence <= 1
    && Number.isFinite(arm.extension) && arm.extension >= 0 && arm.extension <= 1
    && Number.isFinite(arm.elbowAngle) && arm.elbowAngle >= 0 && arm.elbowAngle <= Math.PI
    && Number.isFinite(arm.reach) && arm.reach >= 0 && arm.reach <= 1
    && Number.isFinite(arm.reachAngle) && arm.reachAngle >= 0 && arm.reachAngle <= Math.PI
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
  history.armed = false
  history.originReach = 0
  history.originTime = 0
  history.peakReach = Infinity
}

/**
 * Heuristics consume body-relative geometry, independently of React, the webcam and
 * display mirroring. Punches use the calibrated 2D reach reconstruction, so an
 * ordinary webcam without trustworthy depth still recognizes a punch at the camera.
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
    const leftPunch = this.punch(this.left, left, features, 'PUNCH_LEFT')
    const rightPunch = this.punch(this.right, right, features, 'PUNCH_RIGHT')
    const punch = leftPunch ?? rightPunch
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

  /**
   * One punch per extension: the reach must rise quickly from a bent arm to a nearly
   * straight one at upper-body height, then drop again before the next punch.
   */
  private punch(
    history: ArmHistory,
    arm: ArmMotionFeatures | null,
    features: MotionFeatures,
    type: 'PUNCH_LEFT' | 'PUNCH_RIGHT',
  ): GestureEvent | null {
    if (!arm) {
      clearArm(history)
      return null
    }
    const timestamp = features.timestamp
    if (!history.armed) {
      // An arm that starts extended, or just punched, must pull back first.
      history.peakReach = Math.max(history.peakReach, arm.reach)
      if (arm.reach >= PUNCH_REACH || history.peakReach - arm.reach < RELEASE_DROP) return null
      history.armed = true
      history.originReach = arm.reach
      history.originTime = timestamp
      return null
    }
    if (arm.reach <= history.originReach || timestamp - history.originTime > PUNCH_WINDOW_MS) {
      if (arm.reach < PUNCH_REACH) {
        history.originReach = arm.reach
        history.originTime = timestamp
      } else {
        // A slow push that reached full extension never counts.
        history.armed = false
        history.peakReach = arm.reach
      }
      return null
    }
    if (arm.reach < PUNCH_REACH || arm.reachAngle < PUNCH_ELBOW_ANGLE
      || arm.reach - history.originReach < MIN_REACH_GAIN
      || arm.wrist.y < PUNCH_LOWEST_WRIST || arm.wrist.y > PUNCH_HIGHEST_WRIST) return null

    // The extension is spent even inside the cooldown, so it can never fire late.
    history.armed = false
    history.peakReach = arm.reach
    if (timestamp < history.cooldownUntil) return null
    history.cooldownUntil = timestamp + PUNCH_COOLDOWN_MS
    return { type, timestamp, confidence: Math.min(features.confidence, arm.confidence) }
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
