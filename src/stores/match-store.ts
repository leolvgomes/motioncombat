import { create } from 'zustand'
import type { CombatSnapshot } from '../types/combat'
import type { AttackSide } from '../types/animation'

const noStats = Object.freeze({ attacks: 0, hits: 0, blocks: 0, dodges: 0, damage: 0 })

export const READY_MATCH: CombatSnapshot = Object.freeze({
  mode: 'webcam', phase: 'ready', pauseReason: null, round: 1,
  secondsLeft: 45, countdown: 0, betweenRoundsLeft: 0,
  playerHealth: 100, opponentHealth: 100, playerWins: 0, opponentWins: 0,
  roundWinner: null, winner: null, lastImpact: null, playerStats: noStats, opponentStats: noStats,
})

interface MatchStore {
  snapshot: CombatSnapshot
  sceneFps: number | null
  canFight: boolean
  opponentCue: AttackSide | null
  publish: (snapshot: CombatSnapshot, canFight: boolean, opponentCue: AttackSide | null) => void
  setSceneFps: (fps: number | null) => void
}

/** Only copied UI diagnostics live here. Simulation transforms never use React state. */
export const useMatchStore = create<MatchStore>((set) => ({
  snapshot: READY_MATCH,
  sceneFps: null,
  canFight: false,
  opponentCue: null,
  publish: (snapshot, canFight, opponentCue) => set({ snapshot, canFight, opponentCue }),
  setSceneFps: (sceneFps) => set({ sceneFps }),
}))
