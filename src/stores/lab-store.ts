import { create } from 'zustand'
import type { SessionMetrics, SessionState } from '../features/motion-tracking/tracking-session'
import type { GpuInfo } from '../features/robot/gpu-info'
import type { ProcessedPose } from '../types/motion'

export type Resolution = '720p' | '480p'
/** Where inference runs. Automatic keeps the page on GPUs too small to serve both at once. */
export type TrackingThread = 'auto' | 'worker' | 'page'

/** On shared graphics a worker only moves the contention: the scene gains frames and poses arrive later. */
export function prefersWorker(thread: TrackingThread, gpu: GpuInfo | null): boolean {
  if (thread !== 'auto') return thread === 'worker'
  return !gpu?.integrated && !gpu?.software
}

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
  /** Takes effect when the camera starts. */
  trackingThread: TrackingThread
  gpu: GpuInfo | null
  setGpu: (gpu: GpuInfo) => void
  setSession: (session: SessionState) => void
  setDiagnostics: (metrics: SessionMetrics, pose: PoseDiagnostics | null) => void
  setResolution: (resolution: Resolution) => void
  toggleSkeleton: () => void
  toggleMirror: () => void
  toggleGuide: () => void
  setTrackingThread: (thread: TrackingThread) => void
}

export const useLabStore = create<LabStore>((set) => ({
  session: { status: 'idle', error: null, delegate: null },
  metrics: null,
  pose: null,
  resolution: '720p',
  showSkeleton: true,
  mirrored: true,
  showGuide: true,
  trackingThread: 'auto',
  gpu: null,
  setGpu: (gpu) => set({ gpu }),
  setSession: (session) => set(session.status === 'running' ? { session } : { session, metrics: null, pose: null }),
  setDiagnostics: (metrics, pose) => set({ metrics, pose }),
  setResolution: (resolution) => set({ resolution }),
  toggleSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  toggleMirror: () => set((s) => ({ mirrored: !s.mirrored })),
  toggleGuide: () => set((s) => ({ showGuide: !s.showGuide })),
  setTrackingThread: (trackingThread) => set({ trackingThread }),
}))
