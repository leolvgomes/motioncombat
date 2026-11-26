import { create } from 'zustand'
import type { CombatSnapshot } from '../types/combat'
import type { AttackKind, AttackSide } from '../types/animation'
import type { CircuitOutcome } from '../engine/career/circuit'
import type { Difficulty, RivalId } from '../engine/combat/opponents'
import type { TutorialView } from '../engine/tutorial/tutorial'

const noStats = Object.freeze({ attacks: 0, hits: 0, blocks: 0, dodges: 0, damage: 0, combos: 0, bestStreak: 0 })

export const READY_MATCH: CombatSnapshot = Object.freeze({
  mode: 'webcam', phase: 'ready', pauseReason: null, round: 1,
  secondsLeft: 45, countdown: 0, betweenRoundsLeft: 0,
  playerHealth: 100, opponentHealth: 100, playerWins: 0, opponentWins: 0,
  roundWinner: null, winner: null, lastImpact: null, lastCombo: null, playerStreak: 0, opponentStreak: 0, playerOverdrive: 0, opponentOverdrive: 0, playerStats: noStats, opponentStats: noStats,
})

export interface OpponentCue {
  readonly side: AttackSide
  readonly kind: AttackKind
}

/** A quick fight against a chosen opponent, the next fight of the circuit, or the guided training. */
export type MatchKind = 'quick' | 'circuit' | 'training'
export interface MatchStatus {
  canFight: boolean
  opponentCue: OpponentCue | null
  /** Progress (0–1) of the hands-free resume after the player returned to view. */
  autoResume: number | null
  /** A webcam start waits for the player's guard in position. */
  armed: boolean
  /** Camera running and calibrated, so a start can be armed before the player is framed. */
  canArm: boolean
  /** Kind chosen for the next webcam match. */
  kind: MatchKind
  /** The robot in the opposite corner: the running, finished or replayed match, otherwise the next one. */
  rival: RivalId
  difficulty: Difficulty
  /** Guided-training progress while a training session runs. */
  training: TutorialView | null
  /** What the last finished circuit match meant for the run. */
  circuitOutcome: CircuitOutcome | null
}

interface MatchStore extends MatchStatus {
  snapshot: CombatSnapshot
  sceneFps: number | null
  publish: (snapshot: CombatSnapshot, status: MatchStatus) => void
  setSceneFps: (fps: number | null) => void
}

/** Only copied UI diagnostics live here. Simulation transforms never use React state. */
export const useMatchStore = create<MatchStore>((set) => ({
  snapshot: READY_MATCH,
  sceneFps: null,
  canFight: false,
  opponentCue: null,
  autoResume: null,
  armed: false,
  canArm: false,
  kind: 'quick',
  rival: 'vulcan',
  difficulty: 'normal',
  training: null,
  circuitOutcome: null,
  publish: (snapshot, status) => set({ snapshot, ...status }),
  setSceneFps: (sceneFps) => set({ sceneFps }),
}))
