/** Quaternion components in Three.js order: x, y, z, w. */
export type QuaternionTuple = readonly [number, number, number, number]

/**
 * Local joint rotations for a rig facing +Z, with anatomical left on +X.
 * Arm segments extend along local -Y. Shoulders inherit torso, elbows inherit
 * shoulders, wrists inherit elbows and the head inherits torso.
 */
export interface RigPose {
  readonly torso: QuaternionTuple
  readonly head: QuaternionTuple
  readonly leftShoulder: QuaternionTuple
  readonly leftElbow: QuaternionTuple
  readonly leftWrist: QuaternionTuple
  readonly rightShoulder: QuaternionTuple
  readonly rightElbow: QuaternionTuple
  readonly rightWrist: QuaternionTuple
}

export type RigJointName = keyof RigPose
