/** A MediaPipe landmark. Image x/y are normalized; world coordinates are metres. */
export interface Landmark {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly visibility: number
}

export interface PoseFrame {
  /** Monotonic capture time in milliseconds, from the same clock for every frame. */
  readonly timestamp: number
  readonly landmarks: readonly Landmark[]
  readonly worldLandmarks: readonly Landmark[]
}

export type TrackingStatus = 'tracking' | 'partial' | 'searching'
export type FramingStatus = 'ready' | 'too-close' | 'off-center' | 'partial' | 'searching'

export interface ProcessedPose {
  readonly timestamp: number
  /** Confidence-aware, temporally smoothed image coordinates. */
  readonly landmarks: readonly Landmark[]
  /** Validated world coordinates, deliberately unsmoothed for future motion engines. */
  readonly worldLandmarks: readonly Landmark[]
  /** Mean confidence of the nine tracked, on-screen landmarks, in the range 0–1. */
  readonly confidence: number
  readonly visibleCount: number
  readonly upperBodyVisibleCount: number
  readonly status: TrackingStatus
  readonly framing: FramingStatus
  /** Distance between the shoulders in normalized image coordinates. */
  readonly shoulderWidth: number
  /** Radians; positive means leaning toward the right side of the camera image. */
  readonly torsoLean: number | null
}
