import { create } from 'zustand'
import type { SessionMetrics, SessionState } from '../features/motion-tracking/tracking-session'
import type { ProcessedPose } from '../types/motion'

export type Resolution = '720p' | '480p'
export interface PoseDiagnostics {
  confidence: number
  visibleCount: number
  upperBodyVisibleCount: number
  status: ProcessedPose['status']
  framing: ProcessedPose['framing']
  visibility: readonly number[]
}

interface LabStore {
  session: SessionState
  metrics: SessionMetrics | null
  pose: PoseDiagnostics | null
  resolution: Resolution
  showSkeleton: boolean
  mirrored: boolean
  showGuide: boolean
  setSession: (session: SessionState) => void
  setDiagnostics: (metrics: SessionMetrics, pose: PoseDiagnostics | null) => void
  setResolution: (resolution: Resolution) => void
  toggleSkeleton: () => void
  toggleMirror: () => void
  toggleGuide: () => void
}

export const useLabStore = create<LabStore>((set) => ({
  session: { status: 'idle', error: null, delegate: null },
  metrics: null,
  pose: null,
  resolution: '720p',
  showSkeleton: true,
  mirrored: true,
  showGuide: true,
  setSession: (session) => set(session.status === 'running' ? { session } : { session, metrics: null, pose: null }),
  setDiagnostics: (metrics, pose) => set({ metrics, pose }),
  setResolution: (resolution) => set({ resolution }),
  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  toggleMirror: () => set((s) => ({ mirrored: !s.mirrored })),
  toggleGuide: () => set((s) => ({ showGuide: !s.showGuide })),
}))
