export const ROBOT_CAMERA_TARGET = [0, 1.35, 0] as const
export const ROBOT_CAMERA_FOV = 35

type CameraView = 'front' | 'perspective'
type Position = readonly [number, number, number]

const FIT_MARGIN = 0.9
const NEAR_DISTANCE = 0.1
const TAN_VERTICAL_HALF_FOV = Math.tan(ROBOT_CAMERA_FOV * Math.PI / 360)
const DEFAULT_ASPECT = 16 / 9

/**
 * Fit the complete movement envelope, including the platform, without cropping
 * raised or outstretched hands on portrait canvases. Called only on view/size changes.
 * The broad Z envelope deliberately includes the full platform at every height.
 */
export function getRobotCameraPosition(view: CameraView, aspect: number): Position {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, Number.EPSILON) : DEFAULT_ASPECT
  const offset: Position = view === 'front' ? [0, 0.3, 6.1] : [3.6, 0.85, 5.7]
  const originalLength = Math.hypot(...offset)
  // Back points from the target toward the camera. Right and up form its view basis.
  const back: Position = [offset[0] / originalLength, offset[1] / originalLength, offset[2] / originalLength]
  const horizontalLength = Math.hypot(back[0], back[2])
  const right: Position = [back[2] / horizontalLength, 0, -back[0] / horizontalLength]
  const up: Position = [
    back[1] * right[2],
    back[2] * right[0] - back[0] * right[2],
    -back[1] * right[0],
  ]
  let distance = view === 'front' ? 6.1 : originalLength

  for (const x of [-1.8, 1.8]) {
    for (const y of [-0.25, 3.15]) {
      for (const z of [-1.53, 1.53]) {
        const relativeY = y - ROBOT_CAMERA_TARGET[1]
        const viewX = x * right[0] + relativeY * right[1] + z * right[2]
        const viewY = x * up[0] + relativeY * up[1] + z * up[2]
        const towardCamera = x * back[0] + relativeY * back[1] + z * back[2]
        distance = Math.max(distance, towardCamera + Math.max(
          Math.abs(viewX) / (TAN_VERTICAL_HALF_FOV * safeAspect * FIT_MARGIN),
          Math.abs(viewY) / (TAN_VERTICAL_HALF_FOV * FIT_MARGIN),
          NEAR_DISTANCE,
        ))
      }
    }
  }

  return [
    ROBOT_CAMERA_TARGET[0] + back[0] * distance,
    ROBOT_CAMERA_TARGET[1] + back[1] * distance,
    ROBOT_CAMERA_TARGET[2] + back[2] * distance,
  ]
}
