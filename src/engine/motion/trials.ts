import type { GestureEvent, GestureType } from '../gestures/gesture-engine'
import { GestureEngine, attackOfGesture } from '../gestures/gesture-engine'
import type { CalibrationProfile } from '../../types/combat-motion'
import type { Landmark, PoseFrame } from '../../types/motion'
import { MotionCalibrator } from './calibration'
import { MotionFeatureExtractor } from './motion-features'
import { PoseProcessor, TRACKED_LANDMARKS } from './pose-processor'

export type TrialGesture = Exclude<GestureType, 'GUARD'>

export interface TrialStep {
  readonly index: number
  /** Null asks for everyday movement: any attack here is a false positive. */
  readonly expected: TrialGesture | null
  readonly instruction: string
  readonly repetition: number
  readonly repetitions: number
  /** Milliseconds from the start of the session. */
  readonly startsAt: number
  readonly cueAt: number
  readonly endsAt: number
}

const GROUP_INTRO_MS = 3000
const PREPARE_MS = 1100
const RESPONSE_MS = 1800
const IDLE_MS = 6000
/** People anticipate a steady rhythm, so a movement may begin slightly before its cue. */
const EARLY_MS = 250

const ATTACKS: readonly (readonly [TrialGesture, string])[] = [
  ['PUNCH_LEFT', 'Soco reto com a mão esquerda'], ['PUNCH_RIGHT', 'Soco reto com a mão direita'],
  ['HOOK_LEFT', 'Gancho com a mão esquerda'], ['HOOK_RIGHT', 'Gancho com a mão direita'],
  ['UPPERCUT_LEFT', 'Uppercut com a mão esquerda'], ['UPPERCUT_RIGHT', 'Uppercut com a mão direita'],
]
const DODGES: readonly (readonly [TrialGesture, string])[] = [
  ['DODGE_LEFT', 'Incline o tronco para a sua esquerda'], ['DODGE_RIGHT', 'Incline o tronco para a sua direita'],
]
const IDLE = ['Balance o corpo e ajuste a guarda', 'Abaixe as duas mãos e levante de novo, devagar', 'Toque o rosto e ajeite a roupa'] as const

/** A fixed script: the same order and timing make two sessions comparable. */
export function buildProtocol(repetitions: number): TrialStep[] {
  const steps: TrialStep[] = []
  let time = 0
  const group = (expected: TrialGesture, instruction: string, count: number) => {
    for (let repetition = 1; repetition <= count; repetition++) {
      const startsAt = time
      const cueAt = startsAt + (repetition === 1 ? GROUP_INTRO_MS : PREPARE_MS)
      time = cueAt + RESPONSE_MS
      steps.push({ index: steps.length, expected, instruction, repetition, repetitions: count, startsAt, cueAt, endsAt: time })
    }
  }
  for (const [gesture, instruction] of ATTACKS) group(gesture, instruction, repetitions)
  for (const [gesture, instruction] of DODGES) group(gesture, instruction, Math.max(2, Math.ceil(repetitions / 2)))
  for (const instruction of IDLE) {
    const startsAt = time
    const cueAt = startsAt + GROUP_INTRO_MS
    time = cueAt + IDLE_MS
    steps.push({ index: steps.length, expected: null, instruction, repetition: 1, repetitions: 1, startsAt, cueAt, endsAt: time })
  }
  return steps
}

export type TrialOutcome = 'correct' | 'confused' | 'missed' | 'clean' | 'false-positive'

export interface TrialResult {
  readonly step: TrialStep
  readonly outcome: TrialOutcome
  readonly detected: readonly TrialGesture[]
  /** From cue to recognition: includes the person's reaction. */
  readonly delayMs: number | null
}

export interface GestureScore {
  readonly gesture: TrialGesture
  readonly total: number
  readonly correct: number
  readonly missed: number
  readonly confusedWith: Readonly<Partial<Record<TrialGesture, number>>>
  /** Correct repetitions that also fired something else. */
  readonly extra: number
  readonly medianDelayMs: number | null
}

export interface TrialSummary {
  readonly results: readonly TrialResult[]
  readonly gestures: readonly GestureScore[]
  /** Attacks during everyday movement. */
  readonly idleFalsePositives: number
  /** Attacks between repetitions, such as while returning to guard. */
  readonly strayAttacks: number
  readonly accuracy: number
}

export interface TrialEvent { readonly type: GestureType; readonly time: number }

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

function isTrialGesture(type: GestureType): type is TrialGesture { return type !== 'GUARD' }
function isDodge(type: GestureType | null): boolean { return type === 'DODGE_LEFT' || type === 'DODGE_RIGHT' }

export function scoreTrials(steps: readonly TrialStep[], events: readonly TrialEvent[]): TrialSummary {
  const used = new Set<TrialEvent>()
  const results = steps.map((step): TrialResult => {
    const inside = events.filter(({ type, time }) => isTrialGesture(type) && time >= step.cueAt - (step.expected ? EARLY_MS : 0) && time < step.endsAt)
    // Leaning during a punch, or a small sway while idle, is not a wrong attack.
    const relevant = inside.filter(({ type }) => attackOfGesture(type) !== null || isDodge(step.expected) && isDodge(type))
    for (const event of relevant) used.add(event)
    const detected = relevant.map(({ type }) => type as TrialGesture)
    if (!step.expected) return { step, outcome: detected.length > 0 ? 'false-positive' : 'clean', detected, delayMs: null }
    const match = relevant.find(({ type }) => type === step.expected)
    const outcome = detected.length === 0 ? 'missed' : detected[0] === step.expected ? 'correct' : 'confused'
    return { step, outcome, detected, delayMs: outcome === 'correct' && match ? Math.round(match.time - step.cueAt) : null }
  })
  const order: TrialGesture[] = []
  for (const { expected } of steps) if (expected && !order.includes(expected)) order.push(expected)
  const gestures = order.map((gesture): GestureScore => {
    const own = results.filter(({ step }) => step.expected === gesture)
    const confusedWith: Partial<Record<TrialGesture, number>> = {}
    for (const { outcome, detected } of own) if (outcome === 'confused') confusedWith[detected[0]!] = (confusedWith[detected[0]!] ?? 0) + 1
    return {
      gesture, total: own.length, correct: own.filter(({ outcome }) => outcome === 'correct').length,
      missed: own.filter(({ outcome }) => outcome === 'missed').length, confusedWith,
      extra: own.filter(({ outcome, detected }) => outcome === 'correct' && detected.length > 1).length,
      medianDelayMs: median(own.flatMap(({ delayMs }) => delayMs === null ? [] : [delayMs])),
    }
  })
  const asked = results.filter(({ step }) => step.expected !== null)
  return {
    results, gestures,
    idleFalsePositives: results.filter(({ step }) => step.expected === null).reduce((sum, { detected }) => sum + detected.length, 0),
    strayAttacks: events.filter((event) => attackOfGesture(event.type) !== null && !used.has(event)).length,
    accuracy: asked.length ? asked.filter(({ outcome }) => outcome === 'correct').length / asked.length : 0,
  }
}

/** Joint positions only, with no image: nine tracked points, plus six arm points in world space. */
export const WORLD_POINTS = [11, 12, 13, 14, 15, 16] as const
export type EncodedFrame = readonly number[]
const FRAME_LENGTH = 1 + (TRACKED_LANDMARKS.length + WORLD_POINTS.length) * 4
const SCALE = 10_000
const HIDDEN: Landmark = { x: 0, y: 0, z: 0, visibility: 0 }

export function encodeFrame(frame: PoseFrame, origin: number): EncodedFrame {
  const values = [Math.round((frame.timestamp - origin) * 10)]
  const push = (point: Landmark | undefined) => {
    const { x, y, z, visibility } = point ?? HIDDEN
    for (const value of [x, y, z, visibility]) values.push(Number.isFinite(value) ? Math.round(value * SCALE) : 0)
  }
  for (const index of TRACKED_LANDMARKS) push(frame.landmarks[index])
  for (const index of WORLD_POINTS) push(frame.worldLandmarks[index])
  return values
}

export function decodeFrame(values: EncodedFrame): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => HIDDEN)
  const worldLandmarks: Landmark[] = Array.from({ length: 33 }, () => HIDDEN)
  let cursor = 1
  const read = (): Landmark => ({
    x: values[cursor++]! / SCALE, y: values[cursor++]! / SCALE, z: values[cursor++]! / SCALE, visibility: values[cursor++]! / SCALE,
  })
  for (const index of TRACKED_LANDMARKS) landmarks[index] = read()
  for (const index of WORLD_POINTS) worldLandmarks[index] = read()
  const found = landmarks.some(({ visibility }) => visibility > 0)
  return { timestamp: values[0]! / 10, landmarks: found ? landmarks : [], worldLandmarks: found ? worldLandmarks : [] }
}

export const RECORDING_VERSION = 1

export interface TrialRecording {
  readonly version: typeof RECORDING_VERSION
  readonly recordedAt: string
  readonly aspectRatio: number
  readonly advancedAttacks: boolean
  readonly profile: CalibrationProfile
  readonly steps: readonly TrialStep[]
  /** Live recognition during the session, relative to its start. */
  readonly events: readonly TrialEvent[]
  /** Raw detections during calibration and during the session, each on the session clock. */
  readonly calibrationFrames: readonly EncodedFrame[]
  readonly frames: readonly EncodedFrame[]
  readonly performance: Readonly<Record<string, unknown>> | null
}

export function parseRecording(text: string): TrialRecording | null {
  try {
    const value = JSON.parse(text) as Partial<TrialRecording> | null
    const frames = (list: unknown): boolean => Array.isArray(list)
      && list.every((frame) => Array.isArray(frame) && frame.length === FRAME_LENGTH && frame.every(Number.isFinite))
    if (!value || value.version !== RECORDING_VERSION || !Number.isFinite(value.aspectRatio) || !value.profile
      || !Array.isArray(value.steps) || value.steps.length === 0 || !Array.isArray(value.events)
      || !frames(value.frames) || !frames(value.calibrationFrames)) return null
    return value as TrialRecording
  } catch { return null }
}

export interface EvaluationOptions {
  /** Motion-adaptive smoothing, as used live. */
  readonly adaptive?: boolean
  /** Measure both image axes in the same unit, recalibrating from the recorded calibration. */
  readonly aspectCorrected?: boolean
  readonly advancedAttacks?: boolean
  /** Drops recorded frames to imitate a slower device. */
  readonly keepEvery?: number
}

function correctAspect(frame: PoseFrame, aspectRatio: number): PoseFrame {
  return { ...frame, landmarks: frame.landmarks.map((point) => ({ ...point, y: point.y / aspectRatio })) }
}

/** Runs the whole recognition chain again over a recording, so a change can be compared on the same real movements. */
export function evaluateRecording(recording: TrialRecording, options: EvaluationOptions = {}): TrialSummary | null {
  const { adaptive = true, aspectCorrected = false, advancedAttacks = recording.advancedAttacks, keepEvery = 1 } = options
  const prepare = (frames: readonly EncodedFrame[]) => frames.filter((_, index) => index % keepEvery === 0).map((frame) => {
    const decoded = decodeFrame(frame)
    return aspectCorrected ? correctAspect(decoded, recording.aspectRatio) : decoded
  })
  const processor = new PoseProcessor({ adaptive })
  let profile: CalibrationProfile | null = recording.profile
  if (aspectCorrected) {
    const calibrator = new MotionCalibrator()
    calibrator.start()
    for (const frame of prepare(recording.calibrationFrames)) calibrator.update(processor.process(frame))
    profile = calibrator.snapshot.profile
    if (!profile) return null
    processor.reset()
  }
  const extractor = new MotionFeatureExtractor()
  const engine = new GestureEngine()
  const events: TrialEvent[] = []
  for (const frame of prepare(recording.frames)) {
    const { event } = engine.update(extractor.update(processor.process(frame), profile), { enabled: true, calibrating: false, profile, advancedAttacks })
    if (event) events.push({ type: event.type, time: event.timestamp })
  }
  return scoreTrials(recording.steps, events)
}

export interface TrialProgress {
  readonly step: TrialStep
  readonly phase: 'intro' | 'prepare' | 'go'
  readonly stepCount: number
  readonly remainingMs: number
  readonly progress: number
  /** What the previous repetition produced, for immediate feedback. */
  readonly lastResult: TrialResult | null
}

/** Clock-driven session. It never reads the camera, the interface or storage. */
export class TrialRunner {
  private readonly frames: EncodedFrame[] = []
  private readonly events: TrialEvent[] = []

  constructor(readonly steps: readonly TrialStep[], private readonly origin: number) {}

  finished(now: number): boolean { return now - this.origin >= this.steps.at(-1)!.endsAt }

  pushFrame(frame: PoseFrame): void {
    if (frame.timestamp >= this.origin) this.frames.push(encodeFrame(frame, this.origin))
  }

  pushEvent({ type, timestamp }: GestureEvent): void {
    if (timestamp >= this.origin) this.events.push({ type, time: timestamp - this.origin })
  }

  progress(now: number): TrialProgress {
    const time = Math.max(0, now - this.origin)
    const step = this.steps.find(({ endsAt }) => time < endsAt) ?? this.steps.at(-1)!
    const previous = this.steps[step.index - 1]
    const phase = time >= step.cueAt ? 'go' : step.cueAt - step.startsAt > PREPARE_MS ? 'intro' : 'prepare'
    return {
      step, phase, stepCount: this.steps.length, remainingMs: Math.max(0, (phase === 'go' ? step.endsAt : step.cueAt) - time),
      progress: Math.min(1, time / this.steps.at(-1)!.endsAt),
      lastResult: previous ? scoreTrials([previous], this.events).results[0]! : null,
    }
  }

  finish(context: Pick<TrialRecording, 'recordedAt' | 'aspectRatio' | 'advancedAttacks' | 'profile' | 'performance'> & { readonly calibration: readonly PoseFrame[] }): { recording: TrialRecording; summary: TrialSummary } {
    const { calibration, ...rest } = context
    const recording: TrialRecording = {
      version: RECORDING_VERSION, ...rest, steps: this.steps, events: [...this.events],
      calibrationFrames: calibration.map((frame) => encodeFrame(frame, this.origin)), frames: [...this.frames],
    }
    return { recording, summary: scoreTrials(this.steps, this.events) }
  }
}
