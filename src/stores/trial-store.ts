import { create } from 'zustand'
import type { PerformanceReport } from '../engine/motion/performance-sampler'
import type { TrialProgress, TrialRecording, TrialSummary } from '../engine/motion/trials'

interface TrialStore {
  progress: TrialProgress | null
  /** Kept in memory only. It leaves the page solely through an explicit download. */
  result: { readonly recording: TrialRecording; readonly summary: TrialSummary; readonly performance: PerformanceReport | null } | null
  /** Why the last session stopped before its end. */
  interruption: string | null
  measuring: { readonly elapsedMs: number; readonly totalMs: number } | null
  performance: PerformanceReport | null
  performanceError: string | null
  set: (patch: Partial<Omit<TrialStore, 'set'>>) => void
}

export const useTrialStore = create<TrialStore>((set) => ({
  progress: null, result: null, interruption: null, measuring: null, performance: null, performanceError: null,
  set: (patch) => set(patch),
}))
