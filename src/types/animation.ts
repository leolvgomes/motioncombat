import type { RigJointName, RigPose } from './robot'

export type AnimationState = 'IDLE' | 'TRACKING' | 'GUARD' | 'DODGE' | 'PUNCH_LEFT' | 'PUNCH_RIGHT' | 'RETURNING'
export type AttackSide = 'left' | 'right'
export type AttackPhase = 'windup' | 'strike' | 'recovery'

export interface PunchClipOptions {
  readonly durationScale: number
  readonly intensity: number
}

/** Clip-relative seconds. The start is inclusive and the end is exclusive. */
export interface HitWindow {
  readonly start: number
  readonly end: number
}

export interface CombatClipSample {
  readonly pose: RigPose
  /** Missing joints remain wholly controlled by the current tracking pose. */
  readonly weights: Readonly<Partial<Record<RigJointName, number>>>
  readonly phase: AttackPhase
  /** Timing metadata only; no collision or damage is performed by a clip. */
  readonly hitActive: boolean
  readonly progress: number
}

export interface PunchClipSampler {
  readonly options: PunchClipOptions
  readonly duration: number
  readonly hitWindow: HitWindow
  /** Reuses one sample and its tuples. Copy values when retaining a past frame. */
  sample(timeSeconds: number): CombatClipSample
}
