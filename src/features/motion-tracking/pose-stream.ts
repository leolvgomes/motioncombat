import type { ProcessedPose } from '../../types/motion'

/** One current immutable sample, read directly by the 3D loop. No React subscription per frame. */
let currentPose: ProcessedPose | null = null
let aspectRatio = 16 / 9

export function publishPose(pose: ProcessedPose | null): void { currentPose = pose }
export function readPose(): ProcessedPose | null { return currentPose }
export function setPoseAspectRatio(value: number): void {
  if (Number.isFinite(value) && value > 0) aspectRatio = value
}
export function readPoseAspectRatio(): number { return aspectRatio }
