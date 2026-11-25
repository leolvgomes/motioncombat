import { PerformanceSampler } from '../../engine/motion/performance-sampler'
import { TrialRunner, buildProtocol } from '../../engine/motion/trials'
import type { GestureEvent } from '../../engine/gestures/gesture-engine'
import { useCombatMotionStore } from '../../stores/combat-motion-store'
import { useLabStore } from '../../stores/lab-store'
import { useMatchStore } from '../../stores/match-store'
import { useProfileStore } from '../../stores/profile-store'
import { useRobotStore } from '../../stores/robot-store'
import { useTrialStore } from '../../stores/trial-store'
import type { CalibrationProfile } from '../../types/combat-motion'
import type { PoseFrame } from '../../types/motion'
import type { SessionMetrics } from '../motion-tracking/tracking-session'
import { readPoseAspectRatio } from '../motion-tracking/pose-stream'

/** About twelve seconds at 30 Hz: enough for both calibration holds. */
const CALIBRATION_FRAMES = 360
export const MEASURE_MS = 15_000

interface ActiveTrial {
  readonly runner: TrialRunner
  readonly profile: CalibrationProfile
  readonly sampler: PerformanceSampler
  readonly advancedAttacks: boolean
}

export interface TrialCues {
  prepare(): void
  go(): void
}

/** Connects real capture to guided trials and timed measurements. Nothing here is stored or sent. */
export class TrialRuntime {
  private calibration: PoseFrame[] = []
  private active: ActiveTrial | null = null
  private measurement: { readonly startedAt: number; readonly sampler: PerformanceSampler } | null = null
  private lastCue = ''

  constructor(private readonly clock: () => number = () => performance.now(), private readonly date: () => Date = () => new Date()) {}

  get running(): boolean { return this.active !== null }

  start(repetitions: number): boolean {
    const profile = useCombatMotionStore.getState().snapshot.calibration.profile
    if (this.active || !profile || !this.live()) return false
    this.lastCue = ''
    this.active = {
      runner: new TrialRunner(buildProtocol(repetitions), this.clock()), profile, sampler: new PerformanceSampler(),
      advancedAttacks: useProfileStore.getState().advancedAttacks,
    }
    useTrialStore.getState().set({ result: null, interruption: null })
    this.tick()
    return true
  }

  cancel(reason: string | null = null): void {
    if (!this.active) return
    this.active = null
    useTrialStore.getState().set({ progress: null, interruption: reason })
  }

  discard(): void { useTrialStore.getState().set({ result: null, interruption: null }) }

  /** Every unfiltered detection, before recognition. */
  onFrame(frame: PoseFrame): void {
    const { stage, profile } = useCombatMotionStore.getState().snapshot.calibration
    if (stage === 'idle') this.calibration = []
    if (stage !== 'complete') this.calibration = [...this.calibration.slice(1 - CALIBRATION_FRAMES), frame]
    if (!this.active) return
    if (profile !== this.active.profile) this.cancel('A calibração mudou durante a aferição.')
    else this.active.runner.pushFrame(frame)
  }

  onGesture(event: GestureEvent): void { this.active?.runner.pushEvent(event) }

  onMetrics(metrics: SessionMetrics): void {
    const sample = {
      sceneFps: useMatchStore.getState().sceneFps ?? useRobotStore.getState().sceneFps,
      trackingHz: metrics.inferenceFps, inferenceMs: metrics.inferenceMs, latencyMs: metrics.latencyMs, worstFrameMs: metrics.worstFrameMs,
    }
    this.active?.sampler.add(sample, metrics.threaded)
    if (!this.measurement) return
    this.measurement.sampler.add(sample, metrics.threaded)
    const elapsedMs = this.clock() - this.measurement.startedAt
    if (elapsedMs < MEASURE_MS) { useTrialStore.getState().set({ measuring: { elapsedMs, totalMs: MEASURE_MS } }); return }
    const performance = this.measurement.sampler.report()
    this.measurement = null
    useTrialStore.getState().set({ measuring: null, performance, performanceError: performance ? null : 'Houve poucas detecções para medir. Verifique o enquadramento e tente de novo.' })
  }

  onSessionEnded(): void {
    this.calibration = []
    this.cancel('A câmera foi desligada durante a aferição.')
    if (!this.measurement) return
    this.measurement = null
    useTrialStore.getState().set({ measuring: null, performanceError: 'A câmera foi desligada durante a medição.' })
  }

  measure(): boolean {
    if (this.measurement || !this.live()) return false
    this.measurement = { startedAt: this.clock(), sampler: new PerformanceSampler() }
    useTrialStore.getState().set({ measuring: { elapsedMs: 0, totalMs: MEASURE_MS }, performance: null, performanceError: null })
    return true
  }

  /** Advances the script. Call while a session is visible. */
  tick(cues?: TrialCues): void {
    const { active } = this
    if (!active) return
    const now = this.clock()
    if (active.runner.finished(now)) { this.finish(active); return }
    const progress = active.runner.progress(now)
    const cue = `${progress.step.index}:${progress.phase}`
    if (cue !== this.lastCue) {
      this.lastCue = cue
      if (progress.phase === 'go') cues?.go()
      else cues?.prepare()
    }
    useTrialStore.getState().set({ progress })
  }

  private finish(active: ActiveTrial): void {
    const performance = active.sampler.report()
    const { recording, summary } = active.runner.finish({
      recordedAt: this.date().toISOString(), aspectRatio: readPoseAspectRatio(), advancedAttacks: active.advancedAttacks,
      profile: active.profile, calibration: this.calibration, performance: performance as Readonly<Record<string, unknown>> | null,
    })
    this.active = null
    useTrialStore.getState().set({ progress: null, result: { recording, summary, performance } })
  }

  private live(): boolean {
    return useLabStore.getState().session.status === 'running' && useRobotStore.getState().mode === 'tracking'
  }
}

export const trialRuntime = new TrialRuntime()
