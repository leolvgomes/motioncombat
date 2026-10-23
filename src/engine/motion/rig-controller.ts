import { Quaternion } from 'three'
import type { ProcessedPose } from '../../types/motion'
import type { RigPose } from '../../types/robot'
import { createRestPose, retargetPose, sampleDemoPose } from './retarget'

export type RigSourceStatus = 'idle' | 'tracking' | 'partial' | 'lost' | 'demo'
type RigJoint = keyof RigPose
export const RIG_JOINTS = [
  'torso', 'head', 'leftShoulder', 'leftElbow', 'leftWrist',
  'rightShoulder', 'rightElbow', 'rightWrist',
] as const satisfies readonly RigJoint[]

export interface RigInput {
  mode: 'tracking' | 'demo'
  paused: boolean
  active: boolean
  pose: ProcessedPose | null
  mirrored: boolean
  aspectRatio: number
  /** Same performance.now() clock as capture, in milliseconds. */
  now: number
}

/** Rendering transforms are mutable and reused. Sources change only at capture/demo sampling rate. */
export class RigController {
  readonly rotations = Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion()])) as Record<RigJoint, Quaternion>
  sourceStatus: RigSourceStatus = 'idle'
  private readonly rest = createRestPose()
  private target: RigPose = this.rest
  private readonly scratch = new Quaternion()
  private previousPose: ProcessedPose | null = null
  private previousMode: RigInput['mode'] | null = null
  private previousMirror = true
  private previousAspect = 16 / 9
  private demoTime = 0
  private demoSampleIn = 0

  constructor() {
    for (const name of RIG_JOINTS) this.rotations[name].fromArray(this.rest[name])
  }

  step(input: RigInput, elapsed: number): void {
    // A resumed/hidden tab must not teleport the rig or advance a long demo interval.
    const dt = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.1))
    const switched = input.mode !== this.previousMode
    if (switched) {
      this.previousMode = input.mode
      this.previousPose = null
      this.demoTime = 0
      this.demoSampleIn = 0
    }

    if (input.mode === 'demo') {
      this.sourceStatus = 'demo'
      if (!input.paused) {
        this.demoTime += dt
        this.demoSampleIn -= dt
      }
      if (switched || (!input.paused && this.demoSampleIn <= 0)) {
        this.target = sampleDemoPose(this.demoTime)
        this.demoSampleIn = 1 / 24
      }
      if (input.paused) return
    } else {
      const pose = input.pose
      const age = pose ? input.now - pose.timestamp : Infinity
      const fresh = input.active && pose !== null && age >= 0 && age <= 400 && pose.status !== 'searching'
      this.sourceStatus = !input.active ? 'idle' : !fresh ? 'lost' : pose.status === 'partial' ? 'partial' : 'tracking'
      if (fresh) {
        if (pose !== this.previousPose || switched || input.mirrored !== this.previousMirror || input.aspectRatio !== this.previousAspect) {
          this.target = retargetPose(pose, { mirrored: input.mirrored, aspectRatio: input.aspectRatio })
          this.previousPose = pose
          this.previousMirror = input.mirrored
          this.previousAspect = input.aspectRatio
        }
      } else {
        this.target = this.rest
        this.previousPose = null
      }
    }

    // Quaternion damping is independent of display FPS. A lost source returns gently to rest.
    const settling = this.sourceStatus === 'lost' || this.sourceStatus === 'idle' || this.sourceStatus === 'partial'
    const alpha = -Math.expm1(-dt / (settling ? 0.2 : 0.055))
    for (const name of RIG_JOINTS) {
      this.scratch.fromArray(this.target[name])
      this.rotations[name].slerp(this.scratch, alpha)
    }
  }
}
