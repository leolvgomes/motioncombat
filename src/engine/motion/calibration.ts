import type { CalibrationProfile, CalibrationSnapshot, MotionVector } from '../../types/combat-motion'
import type { ProcessedPose } from '../../types/motion'
import { measureMotionPose } from './motion-features'

export type { CalibrationSnapshot } from '../../types/combat-motion'

type BodyMeasurement = NonNullable<ReturnType<typeof measureMotionPose>>
interface HoldSample { readonly timestamp: number; readonly body: BodyMeasurement }
interface NeutralReference {
  readonly shoulderWidth: number
  readonly worldShoulderWidth: number | null
  readonly torsoLean: number
}

const NEUTRAL_HOLD_MS = 1500
const GUARD_HOLD_MS = 1200
const MAX_SAMPLE_GAP_MS = 150
const CALIBRATION_LANDMARKS = [0, 11, 12, 13, 14, 15, 16] as const
const NEUTRAL_MESSAGE = 'Relaxe os ombros e mantenha os punhos visíveis à frente da cintura. Fique de frente e mantenha a posição.'
const GUARD_MESSAGE = 'Eleve os dois punhos próximos ao rosto, com os cotovelos flexionados. Mantenha a guarda.'

function newAccumulator() {
  return {
    count: 0, shoulderWidth: 0, worldShoulderWidth: 0, worldCount: 0, torsoLean: 0,
    left: { x: 0, y: 0, z: 0, depthCount: 0 },
    right: { x: 0, y: 0, z: 0, depthCount: 0 },
  }
}

function ready(pose: ProcessedPose, body: BodyMeasurement): boolean {
  return body.leftArm !== null && body.rightArm !== null && body.nose !== null
    && body.shoulderWidth >= 0.12 && body.shoulderWidth <= 0.55
    && body.nose.y >= 0.2 && Math.abs(body.nose.x) <= 0.9
    && CALIBRATION_LANDMARKS.every((index) => (pose.landmarks[index]?.visibility ?? 0) >= 0.65)
}

function neutralPosture(body: BodyMeasurement): boolean {
  return body.leftArm !== null && body.rightArm !== null
    && body.leftArm.wrist.y < 0.1 && body.rightArm.wrist.y < 0.1
    && body.leftArm.wristAboveElbow < 0.2 && body.rightArm.wristAboveElbow < 0.2
    && Math.abs(body.torsoLean) <= 0.45
}

function guardPosture(body: BodyMeasurement, reference: NeutralReference): boolean {
  const head = body.nose
  if (!head || !body.leftArm || !body.rightArm || Math.abs(body.torsoLean - reference.torsoLean) > 0.35) return false
  return [body.leftArm, body.rightArm].every((arm) => arm.wrist.y >= 0.15
    && arm.wrist.y >= head.y - 0.8 && arm.wrist.y <= head.y + 0.6
    && Math.abs(arm.wrist.x - head.x) <= 1.1
    && arm.wristAboveElbow >= 0.1 && arm.extension < 0.95)
}

function stable(previous: HoldSample, current: HoldSample): boolean {
  const elapsed = current.timestamp - previous.timestamp
  if (elapsed <= 0 || elapsed > MAX_SAMPLE_GAP_MS) return false
  const seconds = elapsed / 1000
  const before = previous.body
  const after = current.body
  if (!before.leftArm || !before.rightArm || !after.leftArm || !after.rightArm) return false
  const relativeSpeed = (first: MotionVector, second: MotionVector) => Math.hypot(first.x - second.x, first.y - second.y) / seconds
  return relativeSpeed(before.leftArm.wrist, after.leftArm.wrist) <= 0.9
    && relativeSpeed(before.rightArm.wrist, after.rightArm.wrist) <= 0.9
    && Math.hypot(before.center.x - after.center.x, before.center.y - after.center.y) / after.shoulderWidth / seconds <= 0.8
    && Math.abs(before.shoulderWidth - after.shoulderWidth) / after.shoulderWidth / seconds <= 0.5
    && Math.abs(before.torsoLean - after.torsoLean) / seconds <= 0.7
}

export class MotionCalibrator {
  private current: CalibrationSnapshot = { stage: 'idle', progress: 0, profile: null, message: 'Inicie a calibração com a câmera ativa.' }
  private previous: HoldSample | null = null
  private heldMs = 0
  private accumulated = newAccumulator()
  private neutral: NeutralReference | null = null

  get snapshot(): CalibrationSnapshot { return this.current }

  start(): void {
    this.clearHold()
    this.neutral = null
    this.current = { stage: 'neutral', progress: 0, profile: null, message: NEUTRAL_MESSAGE }
  }

  cancel(): void {
    this.reset()
    this.current = { ...this.current, message: 'Calibração cancelada. Inicie novamente quando estiver pronto.' }
  }

  reset(): void {
    this.clearHold()
    this.neutral = null
    this.current = { stage: 'idle', progress: 0, profile: null, message: 'Inicie a calibração com a câmera ativa.' }
  }

  update(pose: ProcessedPose | null): CalibrationSnapshot {
    const stage = this.current.stage
    if (stage === 'idle' || stage === 'complete') return this.current
    const body = pose ? measureMotionPose(pose) : null
    if (!pose || !body || !ready(pose, body)) {
      return this.interrupt('Mantenha rosto, ombros, cotovelos e punhos visíveis. O tempo desta posição foi reiniciado.')
    }
    if (stage === 'neutral' && !neutralPosture(body)) return this.interrupt(NEUTRAL_MESSAGE)
    if (stage === 'guard' && (!this.neutral || !guardPosture(body, this.neutral))) return this.interrupt(GUARD_MESSAGE)

    const sample: HoldSample = { timestamp: pose.timestamp, body }
    if (this.previous && !stable(this.previous, sample)) {
      this.clearHold()
      this.previous = sample
      this.accumulate(body)
      this.current = { ...this.current, progress: 0, message: 'Mantenha o corpo e os braços parados por um instante.' }
      return this.current
    }
    if (this.previous) this.heldMs += sample.timestamp - this.previous.timestamp
    this.previous = sample
    this.accumulate(body)
    const duration = stage === 'neutral' ? NEUTRAL_HOLD_MS : GUARD_HOLD_MS
    this.current = { ...this.current, progress: Math.min(1, this.heldMs / duration), message: stage === 'neutral' ? NEUTRAL_MESSAGE : GUARD_MESSAGE }
    if (this.heldMs < duration) return this.current

    if (stage === 'neutral') {
      const sum = this.accumulated
      this.neutral = {
        shoulderWidth: sum.shoulderWidth / sum.count,
        worldShoulderWidth: sum.worldCount >= sum.count * 0.8 ? sum.worldShoulderWidth / sum.worldCount : null,
        torsoLean: sum.torsoLean / sum.count,
      }
      this.clearHold()
      this.current = { stage: 'guard', progress: 0, profile: null, message: GUARD_MESSAGE }
      return this.current
    }
    if (!this.neutral) return this.interrupt('A referência neutra foi perdida. Reinicie a calibração.')
    const neutral = this.neutral
    const sum = this.accumulated
    const guardPosition = (arm: typeof sum.left): MotionVector => ({
      x: arm.x / sum.count, y: arm.y / sum.count,
      z: neutral.worldShoulderWidth !== null && arm.depthCount >= sum.count * 0.8 ? arm.z / arm.depthCount : 0,
    })
    const profile: CalibrationProfile = {
      capturedAt: pose.timestamp,
      shoulderWidth: neutral.shoulderWidth,
      worldShoulderWidth: neutral.worldShoulderWidth,
      neutralTorsoLean: neutral.torsoLean,
      guardLeft: guardPosition(sum.left),
      guardRight: guardPosition(sum.right),
    }
    this.current = { stage: 'complete', progress: 1, profile, message: 'Calibração concluída. Seus movimentos estão prontos para análise.' }
    this.clearHold()
    return this.current
  }

  private interrupt(message: string): CalibrationSnapshot {
    this.clearHold()
    this.current = { ...this.current, progress: 0, message }
    return this.current
  }

  private clearHold(): void {
    this.previous = null
    this.heldMs = 0
    this.accumulated = newAccumulator()
  }

  private accumulate(body: BodyMeasurement): void {
    if (!body.leftArm || !body.rightArm) return
    const sum = this.accumulated
    sum.count += 1
    sum.shoulderWidth += body.shoulderWidth
    sum.torsoLean += body.torsoLean
    if (body.worldShoulderWidth !== null && body.leftArm.depth && body.rightArm.depth) {
      sum.worldShoulderWidth += body.worldShoulderWidth
      sum.worldCount += 1
    }
    for (const [target, arm] of [[sum.left, body.leftArm], [sum.right, body.rightArm]] as const) {
      target.x += arm.wrist.x
      target.y += arm.wrist.y
      if (arm.depth) { target.z += arm.wrist.z; target.depthCount += 1 }
    }
  }
}
