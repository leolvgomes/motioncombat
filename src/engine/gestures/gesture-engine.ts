import type { AttackKind, AttackSide } from '../../types/animation'
import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures, MotionVector } from '../../types/combat-motion'

export type AttackGestureType = 'PUNCH_LEFT' | 'PUNCH_RIGHT' | 'HOOK_LEFT' | 'HOOK_RIGHT' | 'UPPERCUT_LEFT' | 'UPPERCUT_RIGHT'
export type GestureType = AttackGestureType | 'GUARD' | 'DODGE_LEFT' | 'DODGE_RIGHT'
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
  /** Hooks and uppercuts are optional; straight punches never depend on them. */
  readonly advancedAttacks?: boolean
}

export interface AttackRequest {
  readonly kind: AttackKind
  /** The player's anatomical side, before display mirroring. */
  readonly side: AttackSide
}

const ATTACK_GESTURES: Readonly<Record<AttackGestureType, AttackRequest>> = {
  PUNCH_LEFT: { kind: 'straight', side: 'left' }, PUNCH_RIGHT: { kind: 'straight', side: 'right' },
  HOOK_LEFT: { kind: 'hook', side: 'left' }, HOOK_RIGHT: { kind: 'hook', side: 'right' },
  UPPERCUT_LEFT: { kind: 'uppercut', side: 'left' }, UPPERCUT_RIGHT: { kind: 'uppercut', side: 'right' },
}

/** The attack a gesture asks for, or null for posture gestures. */
export function attackOfGesture(type: GestureType): AttackRequest | null {
  return Object.hasOwn(ATTACK_GESTURES, type) ? ATTACK_GESTURES[type as AttackGestureType] : null
}

/** One wrist position. Outward grows away from the body's midline on that arm's side. */
interface SwingSample {
  readonly timestamp: number
  readonly outward: number
  readonly y: number
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
  /** Recent wrist path, at most SWING_WINDOW_MS long. */
  swing: SwingSample[]
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
const SWING_WINDOW_MS = 380
// A fighting stance keeps the other fist up; a hanging arm means an everyday gesture.
const SWING_SUPPORT_LOWEST_WRIST = -0.7
const SWING_SUPPORT_TRAVEL = 0.35
const SWING_SPEED = 1.2
const SWING_MAX_ELBOW_ANGLE = 2.5
const HOOK_ORIGIN = 0.6
const HOOK_END = 0.15
const HOOK_TRAVEL = 0.5
const HOOK_LOWEST_ORIGIN = -0.6
const HOOK_LOWEST_WRIST = -0.45
const HOOK_HIGHEST_WRIST = 0.8
const UPPERCUT_ORIGIN = -0.3
const UPPERCUT_END = 0.15
const UPPERCUT_RISE = 0.6
const UPPERCUT_WRIST_ABOVE_ELBOW = 0.2
const GUARD_DWELL_MS = 150
const DODGE_DWELL_MS = 100
const RELEASE_DWELL_MS = 90
const POSTURE_COOLDOWN_MS = 300
const DODGE_ENTER_RADIANS = 0.18
const DODGE_EXIT_RADIANS = 0.11

function armHistory(): ArmHistory {
  return { armed: false, originReach: 0, originTime: 0, peakReach: Infinity, cooldownUntil: 0, swing: [] }
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
  history.swing.length = 0
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
    const swing = context.advancedAttacks ? this.swings(left, right, features, leftPunch !== null || rightPunch !== null) : null
    const punch = leftPunch ?? rightPunch ?? swing
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

  /** Curved attacks from the wrist path. The opposite arm must hold still, so raising or crossing both arms never counts. */
  private swings(left: ArmMotionFeatures | null, right: ArmMotionFeatures | null, features: MotionFeatures, punched: boolean): GestureEvent | null {
    this.recordSwing(this.left, left, 1, features.timestamp)
    this.recordSwing(this.right, right, -1, features.timestamp)
    if (punched) {
      this.left.swing.length = 0
      this.right.swing.length = 0
      return null
    }
    if (!left || !right) return null
    return this.swing('left', this.left, left, 1, this.right, right, features)
      ?? this.swing('right', this.right, right, -1, this.left, left, features)
  }

  private recordSwing(history: ArmHistory, arm: ArmMotionFeatures | null, side: 1 | -1, timestamp: number): void {
    if (!arm) { history.swing.length = 0; return }
    while (history.swing.length > 0 && timestamp - history.swing[0]!.timestamp > SWING_WINDOW_MS) history.swing.shift()
    history.swing.push({ timestamp, outward: arm.wrist.x * side, y: arm.wrist.y })
  }

  private swing(
    side: AttackSide,
    history: ArmHistory,
    arm: ArmMotionFeatures,
    sign: 1 | -1,
    supportHistory: ArmHistory,
    support: ArmMotionFeatures,
    features: MotionFeatures,
  ): GestureEvent | null {
    const samples = history.swing
    const now = samples[samples.length - 1]
    if (!now || samples.length < 2 || features.timestamp < history.cooldownUntil
      || arm.reachAngle > SWING_MAX_ELBOW_ANGLE || support.wrist.y < SWING_SUPPORT_LOWEST_WRIST) return null
    let widest = now
    let lowest = now
    for (const sample of samples) {
      if (sample.outward > widest.outward) widest = sample
      if (sample.y < lowest.y) lowest = sample
    }
    let supportTravel = 0
    const supportNow = supportHistory.swing[supportHistory.swing.length - 1]
    if (supportNow) for (const sample of supportHistory.swing) {
      supportTravel = Math.max(supportTravel, Math.hypot(supportNow.outward - sample.outward, supportNow.y - sample.y))
    }
    if (supportTravel > SWING_SUPPORT_TRAVEL) return null

    const travel = widest.outward - now.outward
    const rise = now.y - lowest.y
    const hook = widest.outward >= HOOK_ORIGIN && now.outward <= HOOK_END && travel >= HOOK_TRAVEL
      && widest.y >= HOOK_LOWEST_ORIGIN && now.y >= HOOK_LOWEST_WRIST && now.y <= HOOK_HIGHEST_WRIST
      && Math.abs(now.y - widest.y) <= travel * 0.7 && -arm.velocity.x * sign >= SWING_SPEED
    const uppercut = lowest.y <= UPPERCUT_ORIGIN && now.y >= UPPERCUT_END && rise >= UPPERCUT_RISE
      && now.outward >= -0.45 && now.outward <= 0.65 && Math.abs(now.outward - lowest.outward) <= rise * 0.7
      && arm.wristAboveElbow >= UPPERCUT_WRIST_ABOVE_ELBOW && arm.velocity.y >= SWING_SPEED
    if (!hook && !uppercut) return null

    // The same motion must not continue into a straight punch or another swing.
    samples.length = 0
    history.cooldownUntil = features.timestamp + PUNCH_COOLDOWN_MS
    if (history.armed) {
      history.originReach = arm.reach
      history.originTime = features.timestamp
    }
    const suffix = side === 'left' ? 'LEFT' : 'RIGHT'
    return {
      type: hook ? `HOOK_${suffix}` : `UPPERCUT_${suffix}`,
      timestamp: features.timestamp,
      confidence: Math.min(features.confidence, arm.confidence, support.confidence),
    }
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
