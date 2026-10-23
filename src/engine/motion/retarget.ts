import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Landmark, ProcessedPose } from '../../types/motion'
import type { QuaternionTuple, RigPose } from '../../types/robot'
import { LANDMARK_VISIBILITY_THRESHOLD } from './pose-processor'

export interface RetargetOptions {
  readonly mirrored: boolean
  readonly aspectRatio: number
}

interface ArmRotation {
  readonly shoulder: QuaternionTuple
  readonly elbow: QuaternionTuple
  readonly wrist: QuaternionTuple
}

const DOWN = new Vector3(0, -1, 0)
const Z_AXIS = new Vector3(0, 0, 1)
const DEFAULT_ASPECT_RATIO = 16 / 9
const MAX_TORSO_ROLL = 0.35
const MAX_DEPTH_RATIO = 0.3
const MAX_ELBOW_BEND = 150 * Math.PI / 180
const MAX_INWARD_COMPONENT = 0.85
const MIN_SEGMENT_LENGTH = 0.00001

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function tuple(rotation: Quaternion): QuaternionTuple {
  return [rotation.x, rotation.y, rotation.z, rotation.w]
}

function identity(): QuaternionTuple {
  return [0, 0, 0, 1]
}

function finitePoint(point: Landmark | undefined, threshold: number): boolean {
  return point !== undefined
    && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && Number.isFinite(point.visibility) && point.visibility >= threshold
}

function imagePoint(point: Landmark | undefined): boolean {
  return finitePoint(point, LANDMARK_VISIBILITY_THRESHOLD)
    && point !== undefined && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

/** World depth can bend a limb out of the image plane by at most atan(0.3). */
function depthRatio(start: Landmark | undefined, end: Landmark | undefined): number {
  if (!finitePoint(start, 0.65) || !finitePoint(end, 0.65) || !start || !end) return 0
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = start.z - end.z // MediaPipe camera -Z becomes the robot's forward +Z.
  const length = Math.hypot(dx, dy, dz)
  if (!Number.isFinite(length) || length < MIN_SEGMENT_LENGTH) return 0
  return clamp(dz / length * 0.5, -MAX_DEPTH_RATIO, MAX_DEPTH_RATIO)
}

function imageDirection(
  start: Landmark,
  end: Landmark,
  worldStart: Landmark | undefined,
  worldEnd: Landmark | undefined,
  aspect: number,
  xSign: number,
): Vector3 {
  const x = (end.x - start.x) * aspect * xSign
  const y = start.y - end.y
  const projectedLength = Math.hypot(x, y)
  return new Vector3(x, y, projectedLength * depthRatio(worldStart, worldEnd)).normalize()
}

function limitUpperArm(direction: Vector3, side: 1 | -1): Vector3 {
  if (direction.x * side >= -MAX_INWARD_COMPONENT) return direction
  // Reject extreme cross-body shoulder swings while preserving the measured Y/Z plane.
  const remaining = Math.sqrt(1 - MAX_INWARD_COMPONENT ** 2)
  const length = Math.hypot(direction.y, direction.z)
  direction.x = -MAX_INWARD_COMPONENT * side
  if (length < MIN_SEGMENT_LENGTH) return direction.set(direction.x, -remaining, 0)
  direction.y *= remaining / length
  direction.z *= remaining / length
  return direction
}

function limitElbow(upper: Vector3, forearm: Vector3): Vector3 {
  const cosine = clamp(upper.dot(forearm), -1, 1)
  if (cosine >= Math.cos(MAX_ELBOW_BEND)) return forearm

  const tangent = forearm.clone().addScaledVector(upper, -cosine)
  if (tangent.lengthSq() < MIN_SEGMENT_LENGTH ** 2) {
    // The exact opposite direction has no bend plane; prefer the front of the body.
    tangent.set(0, 0, 1).addScaledVector(upper, -upper.z)
    if (tangent.lengthSq() < MIN_SEGMENT_LENGTH ** 2) tangent.set(1, 0, 0)
  }
  tangent.normalize()
  return forearm.copy(upper).multiplyScalar(Math.cos(MAX_ELBOW_BEND))
    .addScaledVector(tangent, Math.sin(MAX_ELBOW_BEND)).normalize()
}

function shoulderOrientation(direction: Vector3): Quaternion {
  // Constrain roll with a stable forward reference instead of a minimal swing.
  // DOWN -> UP is then continuous; bounded depth keeps this reference away from
  // its own singularity (an arm pointing exactly along the model's Z axis).
  const y = direction.clone().negate()
  const x = new Vector3().crossVectors(y, Z_AXIS).normalize()
  const z = new Vector3().crossVectors(x, y).normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize()
}

function solveArm(upper: Vector3, forearm: Vector3, torso: Quaternion, side: 1 | -1): ArmRotation {
  const inverseTorso = torso.clone().invert()
  const localUpper = limitUpperArm(upper.clone().applyQuaternion(inverseTorso).normalize(), side)
  const shoulder = shoulderOrientation(localUpper)
  const constrainedUpper = localUpper.clone().applyQuaternion(torso)
  const localForearm = limitElbow(constrainedUpper, forearm.clone())
    .applyQuaternion(inverseTorso)
    .applyQuaternion(shoulder.clone().invert())
    .normalize()
  const elbow = new Quaternion().setFromUnitVectors(DOWN, localForearm)
  return { shoulder: tuple(shoulder), elbow: tuple(elbow), wrist: identity() }
}

function restDirections(side: 1 | -1): { upper: Vector3; forearm: Vector3 } {
  return {
    upper: new Vector3(side * 0.14, -0.97, 0.18).normalize(),
    forearm: new Vector3(side * 0.08, -0.62, 0.78).normalize(),
  }
}

function assemble(torso: Quaternion, left: ArmRotation, right: ArmRotation, roll: number): RigPose {
  return {
    torso: tuple(torso),
    // A small counter-rotation keeps the head composed; no gaze is inferred.
    head: tuple(new Quaternion().setFromAxisAngle(Z_AXIS, -roll * 0.3)),
    leftShoulder: left.shoulder,
    leftElbow: left.elbow,
    leftWrist: left.wrist,
    rightShoulder: right.shoulder,
    rightElbow: right.elbow,
    rightWrist: right.wrist,
  }
}

/** Relaxed arms with a gentle forward elbow bend, never a T-pose. */
export function createRestPose(): RigPose {
  const torso = new Quaternion()
  const left = restDirections(1)
  const right = restDirections(-1)
  return assemble(torso, solveArm(left.upper, left.forearm, torso, 1), solveArm(right.upper, right.forearm, torso, -1), 0)
}

function torsoRoll(points: readonly Landmark[], aspect: number, xSign: number): number {
  const left = points[11]
  const right = points[12]
  if (!imagePoint(left) || !imagePoint(right)) return 0
  const leftHip = points[23]
  const rightHip = points[24]
  let roll: number
  if (imagePoint(leftHip) && imagePoint(rightHip)) {
    const horizontal = (left.x + right.x - leftHip.x - rightHip.x) / 2 * aspect * xSign
    const vertical = (leftHip.y + rightHip.y - left.y - right.y) / 2
    if (vertical < MIN_SEGMENT_LENGTH) return 0
    roll = -Math.atan2(horizontal, vertical)
  } else {
    // A waist-up crop may hide the hips. Shoulder slope supplies a conservative fallback.
    const horizontal = Math.abs(left.x - right.x) * aspect
    if (horizontal < MIN_SEGMENT_LENGTH) return 0
    roll = Math.atan2((right.y - left.y) * xSign, horizontal) * 0.6
  }
  return clamp(roll, -MAX_TORSO_ROLL, MAX_TORSO_ROLL)
}

function trackedArm(
  pose: ProcessedPose,
  indices: readonly [number, number, number],
  torso: Quaternion,
  side: 1 | -1,
  aspect: number,
  xSign: number,
  rest: ArmRotation,
): ArmRotation {
  const [shoulderIndex, elbowIndex, wristIndex] = indices
  const shoulder = pose.landmarks[shoulderIndex]
  const elbow = pose.landmarks[elbowIndex]
  const wrist = pose.landmarks[wristIndex]
  if (!imagePoint(shoulder) || !imagePoint(elbow) || !imagePoint(wrist)) return rest

  const upperLength = Math.hypot((elbow.x - shoulder.x) * aspect, shoulder.y - elbow.y)
  const forearmLength = Math.hypot((wrist.x - elbow.x) * aspect, elbow.y - wrist.y)
  if (Math.min(upperLength, forearmLength) < Math.max(MIN_SEGMENT_LENGTH, Math.max(upperLength, forearmLength) * 0.04)) {
    return rest
  }

  return solveArm(
    imageDirection(shoulder, elbow, pose.worldLandmarks[shoulderIndex], pose.worldLandmarks[elbowIndex], aspect, xSign),
    imageDirection(elbow, wrist, pose.worldLandmarks[elbowIndex], pose.worldLandmarks[wristIndex], aspect, xSign),
    torso,
    side,
  )
}

/**
 * Resolve fresh local rotations at the inference rate. The renderer should slerp
 * toward this target independently. Each missing arm returns to its own rest pose.
 */
export function retargetPose(pose: ProcessedPose, options: RetargetOptions): RigPose {
  const aspect = Number.isFinite(options.aspectRatio) && options.aspectRatio > 0
    ? clamp(options.aspectRatio, 0.5, 3)
    : DEFAULT_ASPECT_RATIO
  const xSign = options.mirrored ? -1 : 1
  const roll = torsoRoll(pose.landmarks, aspect, xSign)
  const torso = new Quaternion().setFromAxisAngle(Z_AXIS, roll)
  const rest = createRestPose()
  const leftIndices = options.mirrored ? [12, 14, 16] as const : [11, 13, 15] as const
  const rightIndices = options.mirrored ? [11, 13, 15] as const : [12, 14, 16] as const
  const left = trackedArm(pose, leftIndices, torso, 1, aspect, xSign, {
    shoulder: rest.leftShoulder, elbow: rest.leftElbow, wrist: rest.leftWrist,
  })
  const right = trackedArm(pose, rightIndices, torso, -1, aspect, xSign, {
    shoulder: rest.rightShoulder, elbow: rest.rightElbow, wrist: rest.rightWrist,
  })
  return assemble(torso, left, right, roll)
}

/** A deterministic 16-second rig demonstration; no webcam or synthetic landmarks. */
export function sampleDemoPose(timeSeconds: number): RigPose {
  const safeTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0
  const phase = safeTime % 16 / 16 * Math.PI * 2
  const raise = (1 - Math.cos(phase)) / 2
  const roll = Math.sin(phase) * 0.13
  const torso = new Quaternion().setFromAxisAngle(Z_AXIS, roll)
  const left = restDirections(1)
  const right = restDirections(-1)
  const wave = Math.sin(phase * 5) * 0.18 * raise
  const leftForearmAngle = 2.8 + wave
  const rightForearmAngle = 2.7 - wave * 0.6
  left.upper.lerp(new Vector3(Math.sin(2), -Math.cos(2), 0.12).normalize(), raise).normalize()
  right.upper.lerp(new Vector3(-Math.sin(1.8), -Math.cos(1.8), 0.12).normalize(), raise).normalize()
  left.forearm.lerp(new Vector3(Math.sin(leftForearmAngle), -Math.cos(leftForearmAngle), 0.15).normalize(), raise).normalize()
  right.forearm.lerp(new Vector3(-Math.sin(rightForearmAngle), -Math.cos(rightForearmAngle), 0.15).normalize(), raise).normalize()
  return assemble(torso, solveArm(left.upper, left.forearm, torso, 1), solveArm(right.upper, right.forearm, torso, -1), roll)
}
