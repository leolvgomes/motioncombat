/** Body-relative units: X toward anatomical left, Y up, Z toward the webcam. */
export interface MotionVector {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface CalibrationProfile {
  readonly capturedAt: number
  /** Neutral shoulder width in normalized image coordinates. */
  readonly shoulderWidth: number
  /** Neutral shoulder distance in MediaPipe world metres, when trustworthy. */
  readonly worldShoulderWidth: number | null
  /** Radians. Positive means leaning toward raw camera image right. */
  readonly neutralTorsoLean: number
  readonly guardLeft: MotionVector
  readonly guardRight: MotionVector
}

export interface ArmMotionFeatures {
  readonly wrist: MotionVector
  /** Shoulder-relative units per second; first/reacquired samples are zero. */
  readonly velocity: MotionVector
  /** Shoulder-to-wrist distance / total arm length, in the range 0–1. */
  readonly extension: number
  /** Interior elbow angle in radians: 0 folded, PI straight. */
  readonly elbowAngle: number
  readonly wristAboveElbow: number
  readonly confidence: number
  /** This arm has a current, plausible world-space chain, independent of its velocity. */
  readonly depthAvailable: boolean
  /** Trustworthy depth and current forward wrist motion; never inferred from 2D. */
  readonly forwardEvidence: boolean
}

export interface MotionFeatures {
  readonly timestamp: number
  readonly valid: boolean
  readonly confidence: number
  /** Radians relative to neutral; positive toward raw camera image right. */
  readonly torsoLean: number
  readonly leftArm: ArmMotionFeatures | null
  readonly rightArm: ArmMotionFeatures | null
  readonly depthAvailable: boolean
}

export interface CalibrationSnapshot {
  readonly stage: 'idle' | 'neutral' | 'guard' | 'complete'
  readonly progress: number
  readonly message: string
  readonly profile: CalibrationProfile | null
}
