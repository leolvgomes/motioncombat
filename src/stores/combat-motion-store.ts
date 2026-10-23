import { create } from 'zustand'
import type { CalibrationSnapshot, MotionFeatures } from '../types/combat-motion'
import type { GestureEvent, GestureSnapshot } from '../engine/gestures/gesture-engine'

export interface CombatMotionSnapshot {
  calibration: CalibrationSnapshot
  features: MotionFeatures | null
  posture: GestureSnapshot['posture']
  lastEvent: GestureEvent | null
  events: readonly GestureEvent[]
}

export function emptyCombatMotionSnapshot(): CombatMotionSnapshot {
  return {
    calibration: { stage: 'idle', progress: 0, message: 'Calibre a postura neutra e a guarda para reconhecer movimentos.', profile: null },
    features: null, posture: 'neutral', lastEvent: null, events: [],
  }
}

interface CombatMotionStore {
  snapshot: CombatMotionSnapshot
  publish: (snapshot: CombatMotionSnapshot) => void
}

export const useCombatMotionStore = create<CombatMotionStore>((set) => ({
  snapshot: emptyCombatMotionSnapshot(),
  publish: (snapshot) => set({ snapshot }),
}))
