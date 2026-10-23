import type { ArmMotionFeatures, CalibrationProfile, MotionFeatures, MotionVector } from '../../types/combat-motion'
import type { Landmark, ProcessedPose } from '../../types/motion'

const REQUIRED_CONFIDENCE = 0.6
const WORLD_CONFIDENCE = 0.7
const MAX_SAMPLE_GAP_MS = 200
const MIN_SAMPLE_INTERVAL_MS = 12
const VELOCITY_SMOOTHING_MS = 70
const MAX_SPEED = 12
const ZERO: MotionVector = { x: 0, y: 0, z: 0 }

interface MeasuredArm {
  readonly wrist: MotionVector
  readonly extension: number
  readonly elbowAngle: number
  readonly wristAboveElbow: number
  readonly confidence: number
  readonly depth: boolean
}

interface MeasuredBody {
  readonly shoulderWidth: number
  readonly worldShoulderWidth: number | null
  readonly center: MotionVector
  readonly nose: MotionVector | null
  readonly torsoLean: number
  readonly confidence: number
  readonly leftArm: MeasuredArm | null
  readonly rightArm: MeasuredArm | null
}

interface ArmHistory {
  readonly wrist: MotionVector
  readonly depth: boolean
  readonly velocity: MotionVector
}

function finitePoint(point: Landmark | undefined, confidence: number): point is Landmark {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Number.isFinite(point.z) && Number.isFinite(point.visibility) && point.visibility >= confidence
}

function imagePoint(point: Landmark | undefined): point is Landmark {
  return finitePoint(point, REQUIRED_CONFIDENCE) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

function distance(first: MotionVector, second: MotionVector): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function worldShoulderWidth(pose: ProcessedPose, profile?: CalibrationProfile): number | null {
  const left = pose.worldLandmarks[11]
  const right = pose.worldLandmarks[12]
  if (!finitePoint(left, WORLD_CONFIDENCE) || !finitePoint(right, WORLD_CONFIDENCE)) return null
  const width = distance(left, right)
  if (width < 0.15 || width > 0.85) return null
  const reference = profile?.worldShoulderWidth
  return reference && (width / reference < 0.6 || width / reference > 1.6) ? null : width
}

function armGeometry(shoulder: MotionVector, elbow: MotionVector, wrist: MotionVector) {
  const upperLength = distance(shoulder, elbow)
  const forearmLength = distance(elbow, wrist)
  const dot = (shoulder.x - elbow.x) * (wrist.x - elbow.x)
    + (shoulder.y - elbow.y) * (wrist.y - elbow.y)
    + (shoulder.z - elbow.z) * (wrist.z - elbow.z)
  return {
    upperLength,
    forearmLength,
    extension: clamp(distance(shoulder, wrist) / (upperLength + forearmLength), 0, 1),
    elbowAngle: Math.acos(clamp(dot / (upperLength * forearmLength), -1, 1)),
  }
}

function measureArm(
  pose: ProcessedPose,
  indices: readonly [number, number, number],
  center: MotionVector,
  width: number,
  worldWidth: number | null,
): MeasuredArm | null {
  const [shoulderIndex, elbowIndex, wristIndex] = indices
  const shoulder = pose.landmarks[shoulderIndex]
  const elbow = pose.landmarks[elbowIndex]
  const wrist = pose.landmarks[wristIndex]
  if (!imagePoint(shoulder) || !imagePoint(elbow) || !imagePoint(wrist)) return null
  const normalized = (point: Landmark): MotionVector => ({ x: (point.x - center.x) / width, y: (center.y - point.y) / width, z: 0 })
  const imageGeometry = armGeometry(normalized(shoulder), normalized(elbow), normalized(wrist))

  const worldShoulder = pose.worldLandmarks[shoulderIndex]
  const worldElbow = pose.worldLandmarks[elbowIndex]
  const worldWrist = pose.worldLandmarks[wristIndex]
  let depth = false
  let z = 0
  let geometry = imageGeometry
  if (worldWidth !== null && finitePoint(worldShoulder, WORLD_CONFIDENCE)
    && finitePoint(worldElbow, WORLD_CONFIDENCE) && finitePoint(worldWrist, WORLD_CONFIDENCE)) {
    const worldGeometry = armGeometry(worldShoulder, worldElbow, worldWrist)
    const proportion = worldGeometry.upperLength / worldGeometry.forearmLength
    if (worldGeometry.upperLength >= 0.12 && worldGeometry.upperLength <= 0.65
      && worldGeometry.forearmLength >= 0.1 && worldGeometry.forearmLength <= 0.6
      && proportion >= 0.5 && proportion <= 1.9
      && (worldGeometry.upperLength + worldGeometry.forearmLength) / worldWidth <= 3.5) {
      const worldLeft = pose.worldLandmarks[11]
      const worldRight = pose.worldLandmarks[12]
      if (worldLeft && worldRight) {
        z = ((worldLeft.z + worldRight.z) / 2 - worldWrist.z) / worldWidth
        depth = Number.isFinite(z) && Math.abs(z) <= 3
        if (depth) geometry = worldGeometry
      }
    }
  }
  // A genuine forward punch can collapse to almost one image point. The valid
  // world chain must take precedence over 2D projection length in that case.
  if (!depth && (imageGeometry.upperLength < 0.06 || imageGeometry.forearmLength < 0.06
    || imageGeometry.upperLength > 3 || imageGeometry.forearmLength > 3)) return null
  return {
    wrist: { ...normalized(wrist), z: depth ? z : 0 },
    extension: geometry.extension,
    elbowAngle: geometry.elbowAngle,
    wristAboveElbow: (elbow.y - wrist.y) / width,
    confidence: Math.min(shoulder.visibility, elbow.visibility, wrist.visibility),
    depth,
  }
}

/** Shared geometric measurement for calibration and live extraction; contains no temporal state. */
export function measureMotionPose(pose: ProcessedPose, profile?: CalibrationProfile): MeasuredBody | null {
  const left = pose.landmarks[11]
  const right = pose.landmarks[12]
  if (!Number.isFinite(pose.timestamp) || pose.status === 'searching'
    || !Number.isFinite(pose.confidence) || pose.confidence < REQUIRED_CONFIDENCE
    || !imagePoint(left) || !imagePoint(right)) return null
  const width = Math.hypot(left.x - right.x, left.y - right.y)
  if (width < 0.06 || width > 0.72) return null
  if (profile && (!Number.isFinite(profile.shoulderWidth) || profile.shoulderWidth <= 0
    || width / profile.shoulderWidth < 0.45 || width / profile.shoulderWidth > 2.2)) return null

  const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: 0 }
  const worldWidth = worldShoulderWidth(pose, profile)
  const nose = pose.landmarks[0]
  const leftArm = measureArm(pose, [11, 13, 15], center, width, worldWidth)
  const rightArm = measureArm(pose, [12, 14, 16], center, width, worldWidth)
  const rawLean = pose.torsoLean !== null && Number.isFinite(pose.torsoLean)
    ? pose.torsoLean : Math.atan2(left.y - right.y, Math.abs(left.x - right.x))
  return {
    shoulderWidth: width,
    worldShoulderWidth: worldWidth,
    center,
    nose: imagePoint(nose) ? { x: (nose.x - center.x) / width, y: (center.y - nose.y) / width, z: 0 } : null,
    torsoLean: rawLean,
    confidence: clamp(Math.min(left.visibility, right.visibility, pose.confidence), 0, 1),
    leftArm,
    rightArm,
  }
}

function smoothVelocity(current: MeasuredArm, previous: ArmHistory | null, elapsed: number): MotionVector {
  if (!previous || elapsed < MIN_SAMPLE_INTERVAL_MS || elapsed > MAX_SAMPLE_GAP_MS) return ZERO
  const seconds = elapsed / 1000
  let x = (current.wrist.x - previous.wrist.x) / seconds
  let y = (current.wrist.y - previous.wrist.y) / seconds
  let z = current.depth && previous.depth ? (current.wrist.z - previous.wrist.z) / seconds : 0
  const speed = Math.hypot(x, y, z)
  if (speed > MAX_SPEED) { x *= MAX_SPEED / speed; y *= MAX_SPEED / speed; z *= MAX_SPEED / speed }
  const alpha = -Math.expm1(-elapsed / VELOCITY_SMOOTHING_MS)
  const clean = (value: number) => Math.abs(value) < 0.00001 ? 0 : value
  return {
    x: clean(previous.velocity.x + alpha * (x - previous.velocity.x)),
    y: clean(previous.velocity.y + alpha * (y - previous.velocity.y)),
    z: current.depth && previous.depth ? clean(previous.velocity.z + alpha * (z - previous.velocity.z)) : 0,
  }
}

export class MotionFeatureExtractor {
  private previousTimestamp: number | null = null
  private previousProfile: CalibrationProfile | null = null
  private leftHistory: ArmHistory | null = null
  private rightHistory: ArmHistory | null = null

  reset(): void {
    this.previousTimestamp = null
    this.previousProfile = null
    this.leftHistory = null
    this.rightHistory = null
  }

  update(pose: ProcessedPose, profile: CalibrationProfile): MotionFeatures {
    const body = measureMotionPose(pose, profile)
    const timestamp = Number.isFinite(pose.timestamp) ? pose.timestamp : 0
    if (!body || (!body.leftArm && !body.rightArm)) {
      this.reset()
      return { timestamp, valid: false, confidence: 0, torsoLean: 0, leftArm: null, rightArm: null, depthAvailable: false }
    }
    const elapsed = this.previousTimestamp === null ? 0 : timestamp - this.previousTimestamp
    const changedProfile = this.previousProfile !== null && (
      profile.capturedAt !== this.previousProfile.capturedAt || profile.shoulderWidth !== this.previousProfile.shoulderWidth
      || profile.worldShoulderWidth !== this.previousProfile.worldShoulderWidth
    )
    if (elapsed < MIN_SAMPLE_INTERVAL_MS || elapsed > MAX_SAMPLE_GAP_MS || changedProfile) {
      this.leftHistory = null
      this.rightHistory = null
    }
    const extract = (arm: MeasuredArm | null, previous: ArmHistory | null): ArmMotionFeatures | null => {
      if (!arm) return null
      const velocity = smoothVelocity(arm, previous, elapsed)
      return {
        wrist: arm.wrist, velocity, extension: arm.extension, elbowAngle: arm.elbowAngle,
        wristAboveElbow: arm.wristAboveElbow, confidence: Math.min(body.confidence, arm.confidence),
        depthAvailable: arm.depth,
        forwardEvidence: arm.depth && velocity.z > 0.25 && arm.wrist.z > 0.08,
      }
    }
    const leftArm = extract(body.leftArm, this.leftHistory)
    const rightArm = extract(body.rightArm, this.rightHistory)
    this.leftHistory = leftArm ? { wrist: leftArm.wrist, velocity: leftArm.velocity, depth: body.leftArm?.depth === true } : null
    this.rightHistory = rightArm ? { wrist: rightArm.wrist, velocity: rightArm.velocity, depth: body.rightArm?.depth === true } : null
    this.previousTimestamp = timestamp
    this.previousProfile = profile
    return {
      timestamp, valid: true, confidence: body.confidence,
      torsoLean: clamp(body.torsoLean - (Number.isFinite(profile.neutralTorsoLean) ? profile.neutralTorsoLean : 0), -1.2, 1.2),
      leftArm, rightArm, depthAvailable: body.leftArm?.depth === true || body.rightArm?.depth === true,
    }
  }
}
