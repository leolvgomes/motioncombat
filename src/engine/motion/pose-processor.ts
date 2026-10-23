import type { FramingStatus, Landmark, PoseFrame, ProcessedPose, TrackingStatus } from '../../types/motion'

/** Nose, shoulders, elbows, wrists and hips in MediaPipe's 33-landmark topology. */
export const TRACKED_LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 23, 24] as const

export const UPPER_BODY_CONNECTIONS: readonly (readonly [number, number])[] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
]

export const LANDMARK_VISIBILITY_THRESHOLD = 0.5

const ARM_LANDMARKS = [11, 12, 13, 14, 15, 16] as const
const SMOOTHING_TIME_MS = 80
const RESET_GAP_MS = 400
const MIN_TORSO_HEIGHT = 0.0001

function isFiniteLandmark(point: Landmark): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function validateLandmark(point: Landmark): Landmark {
  if (!isFiniteLandmark(point)) return { x: 0, y: 0, z: 0, visibility: 0 }

  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: Number.isFinite(point.visibility) ? Math.max(0, Math.min(1, point.visibility)) : 0,
  }
}

function isInImage(point: Landmark): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

function validateImageLandmark(point: Landmark): Landmark {
  const validated = validateLandmark(point)
  return isInImage(validated) ? validated : { ...validated, visibility: 0 }
}

function isVisible(point: Landmark | undefined): boolean {
  return point !== undefined && point.visibility >= LANDMARK_VISIBILITY_THRESHOLD && isInImage(point)
}

function trackingStatus(points: readonly Landmark[], visibleCount: number): TrackingStatus {
  if (visibleCount >= 7 && ARM_LANDMARKS.every((index) => isVisible(points[index]))) return 'tracking'
  if (visibleCount >= 4) return 'partial'
  return 'searching'
}

function framingStatus(
  points: readonly Landmark[],
  status: TrackingStatus,
  shoulderWidth: number,
): FramingStatus {
  if (status === 'searching') return 'searching'

  const leftShoulder = points[11]
  const rightShoulder = points[12]
  if (!isVisible(leftShoulder) || !isVisible(rightShoulder)) return 'partial'
  if (shoulderWidth > 0.52) return 'too-close'

  const center = (leftShoulder.x + rightShoulder.x) / 2
  const margin = Math.max(0.18, shoulderWidth * 0.7)
  if (center < margin || center > 1 - margin) return 'off-center'

  // Both hips may sit below the image in a valid waist-up camera framing.
  return status === 'tracking' ? 'ready' : 'partial'
}

/** Pure pose processing with no React, camera or inference dependency. */
export class PoseProcessor {
  private previousTimestamp: number | null = null
  private lastUsableTimestamp: number | null = null
  private previousPoints: Landmark[] = []
  private lastSeenAt: (number | undefined)[] = []

  reset(): void {
    this.previousTimestamp = null
    this.lastUsableTimestamp = null
    this.previousPoints = []
    this.lastSeenAt = []
  }

  process(frame: PoseFrame): ProcessedPose {
    const timestamp = Number.isFinite(frame.timestamp) ? frame.timestamp : (this.previousTimestamp ?? 0)
    const points = frame.landmarks.map(validateImageLandmark)
    const upperBodyVisibleCount = TRACKED_LANDMARKS.reduce<number>(
      (count, index) => count + Number(isVisible(points[index])),
      0,
    )
    const status = trackingStatus(points, upperBodyVisibleCount)

    if (this.previousTimestamp !== null && (
      timestamp <= this.previousTimestamp
      || timestamp - this.previousTimestamp > RESET_GAP_MS
      || (this.lastUsableTimestamp !== null && timestamp - this.lastUsableTimestamp > RESET_GAP_MS)
    )) this.reset()

    const elapsed = this.previousTimestamp === null ? 0 : timestamp - this.previousTimestamp
    const alpha = this.previousTimestamp === null ? 1 : -Math.expm1(-elapsed / SMOOTHING_TIME_MS)
    const landmarks = points.map((point, index): Landmark => {
      const previous = this.previousPoints[index]
      const lastSeen = this.lastSeenAt[index]
      if (!isVisible(point)) {
        // Retain the last trustworthy position while current visibility immediately reflects the loss.
        return previous && lastSeen !== undefined
          ? { ...previous, visibility: point.visibility }
          : point
      }
      this.lastSeenAt[index] = timestamp
      if (!previous || lastSeen === undefined || timestamp - lastSeen > RESET_GAP_MS) return point
      return {
        x: previous.x + alpha * (point.x - previous.x),
        y: previous.y + alpha * (point.y - previous.y),
        z: previous.z + alpha * (point.z - previous.z),
        visibility: point.visibility,
      }
    })

    const leftShoulder = points[11]
    const rightShoulder = points[12]
    const shoulderWidth = isVisible(leftShoulder) && isVisible(rightShoulder)
      ? Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y)
      : 0

    const confidence = TRACKED_LANDMARKS.reduce<number>((total, index) => {
      const point = points[index]
      return total + (point && isInImage(point)
        ? point.visibility
        : 0)
    }, 0) / TRACKED_LANDMARKS.length

    this.previousTimestamp = timestamp
    if (status !== 'searching') this.lastUsableTimestamp = timestamp
    this.previousPoints = landmarks

    return {
      timestamp,
      landmarks,
      worldLandmarks: frame.worldLandmarks.map(validateLandmark),
      confidence,
      visibleCount: points.reduce((total, point) => total + Number(isVisible(point)), 0),
      upperBodyVisibleCount,
      status,
      framing: framingStatus(points, status, shoulderWidth),
      shoulderWidth,
      torsoLean: this.torsoLean(landmarks),
    }
  }

  private torsoLean(points: readonly Landmark[]): number | null {
    const leftShoulder = points[11]
    const rightShoulder = points[12]
    const leftHip = points[23]
    const rightHip = points[24]
    if (!isVisible(leftShoulder) || !isVisible(rightShoulder) || !isVisible(leftHip) || !isVisible(rightHip)) {
      return null
    }

    const shoulderX = (leftShoulder.x + rightShoulder.x) / 2
    const hipX = (leftHip.x + rightHip.x) / 2
    const torsoHeight = (leftHip.y + rightHip.y - leftShoulder.y - rightShoulder.y) / 2
    return torsoHeight > MIN_TORSO_HEIGHT ? Math.atan2(shoulderX - hipX, torsoHeight) : null
  }
}
