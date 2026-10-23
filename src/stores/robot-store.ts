import { create } from 'zustand'

export type RobotMode = 'tracking' | 'demo'
export type RobotQuality = 'balanced' | 'light'
export type RobotSourceStatus = 'idle' | 'tracking' | 'partial' | 'lost' | 'demo'
export type RobotView = 'front' | 'perspective'

interface RobotStore {
  mode: RobotMode
  quality: RobotQuality
  paused: boolean
  view: RobotView
  sceneFps: number | null
  sourceStatus: RobotSourceStatus
  setMode: (mode: RobotMode) => void
  setQuality: (quality: RobotQuality) => void
  setPaused: (paused: boolean) => void
  setView: (view: RobotView) => void
  setSceneDiagnostics: (fps: number | null, status: RobotSourceStatus) => void
}

export const useRobotStore = create<RobotStore>((set) => ({
  mode: 'tracking',
  quality: 'balanced',
  paused: false,
  view: 'front',
  sceneFps: null,
  sourceStatus: 'idle',
  setMode: (mode) => set({ mode, paused: false, sourceStatus: mode === 'demo' ? 'demo' : 'idle' }),
  setQuality: (quality) => set({ quality }),
  setPaused: (paused) => set({ paused }),
  setView: (view) => set({ view }),
  setSceneDiagnostics: (sceneFps, sourceStatus) => set({ sceneFps, sourceStatus }),
}))
