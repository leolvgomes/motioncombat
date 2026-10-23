import { LANDMARK_VISIBILITY_THRESHOLD, TRACKED_LANDMARKS, UPPER_BODY_CONNECTIONS } from '../../engine/motion/pose-processor'
import type { Landmark, ProcessedPose } from '../../types/motion'

function visible(point: Landmark | undefined): point is Landmark {
  return point !== undefined
    && point.visibility >= LANDMARK_VISIBILITY_THRESHOLD
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

/** Draw in source-video coordinates. CSS applies the same fit and mirror to both layers. */
export function drawPose(
  context: CanvasRenderingContext2D,
  pose: ProcessedPose | null,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height)
  if (!pose) return

  const lineWidth = Math.max(1.5, width / 550)
  const radius = Math.max(3, width / 225)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = lineWidth
  context.strokeStyle = '#68e5e6'
  context.shadowColor = '#3dd6d9'
  context.shadowBlur = 5
  context.globalAlpha = 0.8
  context.beginPath()
  for (const [from, to] of UPPER_BODY_CONNECTIONS) {
    const start = pose.landmarks[from]
    const end = pose.landmarks[to]
    if (!visible(start) || !visible(end)) continue
    context.moveTo(start.x * width, start.y * height)
    context.lineTo(end.x * width, end.y * height)
  }
  context.stroke()
  context.shadowBlur = 0

  for (const index of TRACKED_LANDMARKS) {
    const point = pose.landmarks[index]
    if (!visible(point)) continue
    const wrist = index === 15 || index === 16
    context.globalAlpha = point.visibility
    context.strokeStyle = wrist ? '#ff9765' : '#b5ffff'
    context.fillStyle = wrist ? '#ff8550' : '#a0f3f4'
    context.beginPath()
    context.arc(point.x * width, point.y * height, radius * 1.65, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.arc(point.x * width, point.y * height, radius * 0.58, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}
