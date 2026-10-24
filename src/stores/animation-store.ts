import { create } from 'zustand'
import type { HybridAnimationSnapshot } from '../engine/animation/hybrid-controller'

export type DemoRoutine = 'motion' | 'punches'
interface AnimationStore {
  hybridEnabled: boolean
  durationScale: number
  intensity: number
  demoRoutine: DemoRoutine
  snapshot: HybridAnimationSnapshot | null
  setHybridEnabled: (enabled: boolean) => void
  setDurationScale: (value: number) => void
  setIntensity: (value: number) => void
  setDemoRoutine: (routine: DemoRoutine) => void
  publishSnapshot: (snapshot: HybridAnimationSnapshot | null) => void
}

const bounded = (value: number, low: number, high: number, fallback: number) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

export const useAnimationStore = create<AnimationStore>((set) => ({
  hybridEnabled: true,
  durationScale: 1,
  intensity: 1,
  demoRoutine: 'motion',
  snapshot: null,
  setHybridEnabled: (hybridEnabled) => set({ hybridEnabled }),
  setDurationScale: (value) => set({ durationScale: bounded(value, 0.75, 1.35, 1) }),
  setIntensity: (value) => set({ intensity: bounded(value, 0.6, 1.3, 1) }),
  setDemoRoutine: (demoRoutine) => set({ demoRoutine }),
  publishSnapshot: (snapshot) => set({ snapshot }),
}))
