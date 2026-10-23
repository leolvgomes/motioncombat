import { Quaternion, Vector3 } from 'three'
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

interface ArmDirections {
  readonly upper: Vector3
  readonly forearm: Vector3
}

const DOWN = new Vector3(0, -1, 0)
const Z_AXIS = new Vector3(0, 0, 1)
const DEFAULT_ASPECT_RATIO = 16 / 9
const MAX_TORSO_ROLL = 0.35
const MAX_ELBOW_BEND = 150 * Math.PI / 180
const MAX_INWARD_COMPONENT = 0.85
const MIN_SEGMENT_LENGTH = 0.00001
const WORLD_VISIBILITY_THRESHOLD = 0.65
const MIN_WORLD_BONE_LENGTH = 0.06
const MAX_WORLD_BONE_LENGTH = 0.85

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
    && Number.isFinite(point.visibility) && point.visibility >= threshold && point.visibility <= 1
}

function imagePoint(point: Landmark | undefined): boolean {
  return finitePoint(point, LANDMARK_VISIBILITY_THRESHOLD)
    && point !== undefined && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

function worldDirection(start: Landmark, end: Landmark, xSign: number): Vector3 {
  // World landmarks are metric, with the hip midpoint as origin. Camera +Y is
  // down and camera -Z points toward the webcam, hence both sign inversions.
  return new Vector3((end.x - start.x) * xSign, start.y - end.y, start.z - end.z)
}

function projectionConsistent(
  image: Vector3,
  world: Vector3,
  worldLength: number,
  imageScale: number,
): boolean {
  const imageLength = Math.hypot(image.x, image.y)
  const worldProjection = Math.hypot(world.x, world.y)
  // A genuinely foreshortened arm has almost no useful projected direction.
  // Do not require a nonzero 2D segment to accept a reliable 3D extension.
  if (worldProjection / worldLength < 0.15 || imageLength < Math.max(MIN_SEGMENT_LENGTH, imageScale * 0.04)) return true
  const cosine = (image.x * world.x + image.y * world.y) / (imageLength * worldProjection)
  return cosine >= 0.35
}

function worldArmDirections(
  pose: ProcessedPose,
  indices: readonly [number, number, number],
  imageUpper: Vector3,
  imageForearm: Vector3,
  imageScale: number,
  xSign: number,
): ArmDirections | null {
  const [shoulderIndex, elbowIndex, wristIndex] = indices
  const shoulder = pose.worldLandmarks[shoulderIndex]
  const elbow = pose.worldLandmarks[elbowIndex]
  const wrist = pose.worldLandmarks[wristIndex]
  if (!finitePoint(shoulder, WORLD_VISIBILITY_THRESHOLD)
    || !finitePoint(elbow, WORLD_VISIBILITY_THRESHOLD)
    || !finitePoint(wrist, WORLD_VISIBILITY_THRESHOLD)) return null

  const upper = worldDirection(shoulder, elbow, xSign)
  const forearm = worldDirection(elbow, wrist, xSign)
  const upperLength = upper.length()
  const forearmLength = forearm.length()
  if (!Number.isFinite(upperLength) || !Number.isFinite(forearmLength)
    || Math.min(upperLength, forearmLength) < MIN_WORLD_BONE_LENGTH
    || Math.max(upperLength, forearmLength) > MAX_WORLD_BONE_LENGTH) return null

  // Broad metric limits catch exploded estimates; ratios reject distorted arms
  // without tying the result to pixels or requiring a particular camera distance.
  const ratio = forearmLength / upperLength
  if (ratio < 0.45 || ratio > 1.65) return null
  const leftShoulder = pose.worldLandmarks[11]
  const rightShoulder = pose.worldLandmarks[12]
  if (finitePoint(leftShoulder, WORLD_VISIBILITY_THRESHOLD) && finitePoint(rightShoulder, WORLD_VISIBILITY_THRESHOLD)) {
    const shoulderSpan = worldDirection(leftShoulder, rightShoulder, 1).length()
    if (!Number.isFinite(shoulderSpan) || shoulderSpan < 0.08 || shoulderSpan > 0.95
      || Math.min(upperLength, forearmLength) / shoulderSpan < 0.2
      || Math.max(upperLength, forearmLength) / shoulderSpan > 2) return null
  }
  if (!projectionConsistent(imageUpper, upper, upperLength, imageScale)
    || !projectionConsistent(imageForearm, forearm, forearmLength, imageScale)) return null

  return { upper: upper.normalize(), forearm: forearm.normalize() }
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

function shoulderOrientation(direction: Vector3, side: 1 | -1): Quaternion {
  // Swing from the body's outward axis, then apply the fixed -Y bone offset.
  // Its only opposite-vector pole lies beyond the cross-body shoulder limit.
  // Both overhead and fully forward/backward directions remain continuous.
  const outward = new Vector3(side, 0, 0)
  const boneOffset = new Quaternion().setFromUnitVectors(DOWN, outward)
  return new Quaternion().setFromUnitVectors(outward, direction).multiply(boneOffset).normalize()
}

function solveArm(upper: Vector3, forearm: Vector3, torso: Quaternion, side: 1 | -1): ArmRotation {
  const inverseTorso = torso.clone().invert()
  const localUpper = limitUpperArm(upper.clone().applyQuaternion(inverseTorso).normalize(), side)
  const shoulder = shoulderOrientation(localUpper, side)
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

  const imageUpper = new Vector3((elbow.x - shoulder.x) * aspect * xSign, shoulder.y - elbow.y, 0)
  const imageForearm = new Vector3((wrist.x - elbow.x) * aspect * xSign, elbow.y - wrist.y, 0)
  const leftShoulder = pose.landmarks[11]
  const rightShoulder = pose.landmarks[12]
  const imageScale = imagePoint(leftShoulder) && imagePoint(rightShoulder)
    ? Math.hypot((leftShoulder.x - rightShoulder.x) * aspect, leftShoulder.y - rightShoulder.y)
    : Math.max(imageUpper.length(), imageForearm.length())
  const world = worldArmDirections(pose, indices, imageUpper, imageForearm, imageScale, xSign)
  if (world) return solveArm(world.upper, world.forearm, torso, side)

  const upperLength = imageUpper.length()
  const forearmLength = imageForearm.length()
  if (Math.min(upperLength, forearmLength) < Math.max(MIN_SEGMENT_LENGTH, Math.max(upperLength, forearmLength) * 0.04)) {
    return rest
  }

  return solveArm(imageUpper.normalize(), imageForearm.normalize(), torso, side)
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
