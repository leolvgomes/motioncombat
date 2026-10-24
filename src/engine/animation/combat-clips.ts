import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AttackSide, CombatClipSample, HitWindow, PunchClipOptions, PunchClipSampler } from '../../types/animation'
import type { QuaternionTuple, RigJointName, RigPose } from '../../types/robot'

export type { PunchClipSampler } from '../../types/animation'

export const DEFAULT_PUNCH_OPTIONS: PunchClipOptions = Object.freeze({ durationScale: 1, intensity: 1 })

/** Editable authored timings are seconds before applying durationScale. */
export const PUNCH_CLIP_CONFIG = Object.freeze({
  timing: Object.freeze({ windupEnd: 0.06, impactAt: 0.13, strikeEnd: 0.22, duration: 0.55 }),
  hitWindow: Object.freeze({ start: 0.13, end: 0.21 }),
  durationScale: Object.freeze({ min: 0.75, max: 1.35 }),
  intensity: Object.freeze({ min: 0.6, max: 1.3 }),
  windupWeight: 0.35,
  torsoWeight: 0.25,
})

const DOWN = new Vector3(0, -1, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

interface ArmPose {
  readonly shoulder: QuaternionTuple
  readonly elbow: QuaternionTuple
  readonly wrist: QuaternionTuple
}

type MutableRigPose = { -readonly [Key in keyof RigPose]: [number, number, number, number] }
type MutableSample = { -readonly [Key in keyof CombatClipSample]: CombatClipSample[Key] }

function tuple(rotation: Quaternion): QuaternionTuple {
  return [rotation.x, rotation.y, rotation.z, rotation.w]
}

function copy(rotation: QuaternionTuple): QuaternionTuple {
  return [rotation[0], rotation[1], rotation[2], rotation[3]]
}

function identity(): QuaternionTuple {
  return [0, 0, 0, 1]
}

function finiteClamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? MathUtils.clamp(value, minimum, maximum) : fallback
}

/** Options are sanitized consistently for sampling, duration and hit metadata. */
export function normalizePunchOptions(options: PunchClipOptions = DEFAULT_PUNCH_OPTIONS): PunchClipOptions {
  return {
    durationScale: finiteClamp(options.durationScale, PUNCH_CLIP_CONFIG.durationScale.min, PUNCH_CLIP_CONFIG.durationScale.max, 1),
    intensity: finiteClamp(options.intensity, PUNCH_CLIP_CONFIG.intensity.min, PUNCH_CLIP_CONFIG.intensity.max, 1),
  }
}

export function getPunchDuration(options: PunchClipOptions = DEFAULT_PUNCH_OPTIONS): number {
  return PUNCH_CLIP_CONFIG.timing.duration * normalizePunchOptions(options).durationScale
}

export function getPunchHitWindow(options: PunchClipOptions = DEFAULT_PUNCH_OPTIONS): HitWindow {
  const { durationScale } = normalizePunchOptions(options)
  return {
    start: PUNCH_CLIP_CONFIG.hitWindow.start * durationScale,
    end: PUNCH_CLIP_CONFIG.hitWindow.end * durationScale,
  }
}

/** Only authored directions are accepted here; none approach the -Y/UP pole. */
function authorArm(upper: Vector3, forearm: Vector3, torso: Quaternion, pronation: number): ArmPose {
  const worldShoulder = new Quaternion().setFromUnitVectors(DOWN, upper.normalize())
  const shoulder = torso.clone().invert().multiply(worldShoulder)
  const forearmLocal = forearm.normalize().applyQuaternion(worldShoulder.clone().invert()).normalize()
  return {
    shoulder: tuple(shoulder.normalize()),
    elbow: tuple(new Quaternion().setFromUnitVectors(DOWN, forearmLocal)),
    // Axial pronation keeps the fist's longitudinal -Y axis aligned with the forearm.
    wrist: tuple(new Quaternion().setFromAxisAngle(Y_AXIS, pronation)),
  }
}

function guardArm(side: 1 | -1): ArmPose {
  return authorArm(
    new Vector3(-side * 0.1, -0.55, 0.83),
    new Vector3(-side * 0.5, 0.84, 0.2),
    new Quaternion(),
    side * 0.1,
  )
}

function buildGuardPose(): RigPose {
  const left = guardArm(1)
  const right = guardArm(-1)
  return {
    torso: identity(), head: identity(),
    leftShoulder: left.shoulder, leftElbow: left.elbow, leftWrist: left.wrist,
    rightShoulder: right.shoulder, rightElbow: right.elbow, rightWrist: right.wrist,
  }
}

const GUARD_POSE = buildGuardPose()
for (const rotation of Object.values(GUARD_POSE)) Object.freeze(rotation)
Object.freeze(GUARD_POSE)

/** Stable demonstration base; live guard continues to use the player's tracking. */
export function createCombatGuardPose(): RigPose {
  return {
    torso: copy(GUARD_POSE.torso), head: copy(GUARD_POSE.head),
    leftShoulder: copy(GUARD_POSE.leftShoulder), leftElbow: copy(GUARD_POSE.leftElbow), leftWrist: copy(GUARD_POSE.leftWrist),
    rightShoulder: copy(GUARD_POSE.rightShoulder), rightElbow: copy(GUARD_POSE.rightElbow), rightWrist: copy(GUARD_POSE.rightWrist),
  }
}

function attackKeyframe(side: AttackSide, intensity: number, stage: 'windup' | 'impact'): RigPose {
  const sign = side === 'left' ? 1 : -1
  const impact = stage === 'impact'
  const torso = new Quaternion().setFromAxisAngle(Y_AXIS, sign * intensity * (impact ? -0.11 : 0.025))
    .multiply(new Quaternion().setFromAxisAngle(Z_AXIS, sign * intensity * (impact ? 0.025 : -0.01)))
  const upper = impact
    ? new Vector3(-sign * (0.12 + 0.03 * intensity), -0.05, 0.99).normalize()
    : new Vector3(-sign * 0.1, -0.3 - 0.05 * intensity, 0.94).normalize()
  const forearm = impact ? upper.clone() : new Vector3(-sign * 0.26, 0.38 + 0.1 * intensity, 0.84)
  const arm = authorArm(upper, forearm, torso, sign * intensity * (impact ? 0.18 : 0.08))
  return {
    ...GUARD_POSE, torso: tuple(torso),
    [`${side}Shoulder`]: arm.shoulder,
    [`${side}Elbow`]: arm.elbow,
    [`${side}Wrist`]: arm.wrist,
  }
}

function smooth(amount: number): number {
  return MathUtils.smootherstep(amount, 0, 1)
}

function armWeight(time: number): number {
  const { timing, windupWeight } = PUNCH_CLIP_CONFIG
  if (time <= timing.windupEnd) return windupWeight * smooth(time / timing.windupEnd)
  if (time < timing.impactAt) return windupWeight + (1 - windupWeight) * smooth((time - timing.windupEnd) / (timing.impactAt - timing.windupEnd))
  if (time <= timing.strikeEnd) return 1
  return 1 - smooth((time - timing.strikeEnd) / (timing.duration - timing.strikeEnd))
}

/** Prepare once per attack; sampling reuses all objects, quaternions and tuples. */
export function createPunchClipSampler(
  side: AttackSide,
  options: PunchClipOptions = DEFAULT_PUNCH_OPTIONS,
): PunchClipSampler {
  const normalized = Object.freeze(normalizePunchOptions(options))
  const { durationScale, intensity } = normalized
  const { timing, hitWindow, torsoWeight } = PUNCH_CLIP_CONFIG
  const duration = timing.duration * durationScale
  const window = Object.freeze({ start: hitWindow.start * durationScale, end: hitWindow.end * durationScale })
  const shoulderName = `${side}Shoulder` as const
  const elbowName = `${side}Elbow` as const
  const wristName = `${side}Wrist` as const
  const joints: readonly RigJointName[] = ['torso', shoulderName, elbowName, wristName]
  const windupPose = attackKeyframe(side, intensity, 'windup')
  const impactPose = attackKeyframe(side, intensity, 'impact')
  const guard = joints.map((name) => quaternion(GUARD_POSE[name]))
  const windup = joints.map((name) => quaternion(windupPose[name]))
  const impact = joints.map((name) => quaternion(impactPose[name]))
  const scratch = new Quaternion()
  const pose = createCombatGuardPose() as MutableRigPose
  const weights: Partial<Record<RigJointName, number>> = {
    [shoulderName]: 0, [elbowName]: 0, [wristName]: 0, torso: 0,
  }
  const output: MutableSample = {
    pose,
    weights,
    phase: 'windup',
    hitActive: false,
    progress: 0,
  }

  return Object.freeze({
    options: normalized,
    duration,
    hitWindow: window,
    sample(timeSeconds: number): CombatClipSample {
      const elapsed = finiteClamp(timeSeconds, 0, duration, 0)
      const time = elapsed >= duration ? timing.duration : elapsed / durationScale
      let from: readonly Quaternion[]
      let to: readonly Quaternion[]
      let amount: number
      if (time < timing.windupEnd) {
        output.phase = 'windup'
        from = guard
        to = windup
        amount = smooth(time / timing.windupEnd)
      } else if (time < timing.impactAt) {
        output.phase = 'strike'
        from = windup
        to = impact
        amount = smooth((time - timing.windupEnd) / (timing.impactAt - timing.windupEnd))
      } else if (time < timing.strikeEnd) {
        output.phase = 'strike'
        from = impact
        to = impact
        amount = 0
      } else {
        output.phase = 'recovery'
        from = impact
        to = guard
        amount = smooth((time - timing.strikeEnd) / (timing.duration - timing.strikeEnd))
      }
      for (let index = 0; index < joints.length; index += 1) {
        scratch.slerpQuaternions(from[index]!, to[index]!, amount).normalize()
        const destination = pose[joints[index]!]
        destination[0] = scratch.x
        destination[1] = scratch.y
        destination[2] = scratch.z
        destination[3] = scratch.w
      }
      const weight = armWeight(time)
      weights[shoulderName] = weight
      weights[elbowName] = weight
      weights[wristName] = weight
      weights.torso = weight * torsoWeight
      output.hitActive = elapsed >= window.start && elapsed < window.end
      output.progress = elapsed / duration
      return output
    },
  })
}

function quaternion(rotation: QuaternionTuple): Quaternion {
  return new Quaternion(...rotation)
}

/** Pure independent sample. Runtime playback should prepare one sampler per attack. */
export function samplePunchClip(
  side: AttackSide,
  timeSeconds: number,
  options: PunchClipOptions = DEFAULT_PUNCH_OPTIONS,
): CombatClipSample {
  return createPunchClipSampler(side, options).sample(timeSeconds)
}
