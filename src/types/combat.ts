import type { Quaternion } from 'three'
import type { RigJointName } from './robot'
import type { AnimationGestureSignal } from '../features/robot/animation-signals'
import type { AttackSide } from './animation'

export type FighterId = 'player' | 'opponent'
export type MatchMode = 'webcam' | 'demo'
export type MatchPhase = 'ready' | 'countdown' | 'fighting' | 'round-over' | 'finished'
export type PauseReason = 'manual' | 'tracking' | 'view' | 'hidden'
export type MatchWinner = FighterId | 'draw'
export type FighterAction = 'idle' | 'approaching' | 'guard' | 'telegraph' | 'attacking' | 'retreating' | 'stunned' | 'victory' | 'defeat'
export type CombatRotations = Record<RigJointName, Quaternion>

/** Reused display transforms, authored on the same joints as the laboratory rig. */
export interface FighterFrame {
  readonly position: readonly [number, number, number]
  readonly yaw: number
  readonly rotations: Readonly<CombatRotations>
  readonly action: FighterAction
  readonly attackSide: AttackSide | null
  readonly attackProgress: number
  readonly hitActive: boolean
  readonly hitFlash: number
  readonly blocking: boolean
}

export interface FighterStats {
  readonly attacks: number
  readonly hits: number
  readonly blocks: number
  readonly dodges: number
  readonly damage: number
}

export interface ImpactEvent {
  readonly id: number
  readonly attacker: FighterId
  readonly result: 'hit' | 'blocked' | 'dodged' | 'miss'
  readonly damage: number
}

export interface CombatSnapshot {
  readonly mode: MatchMode
  readonly phase: MatchPhase
  readonly pauseReason: PauseReason | null
  readonly round: number
  readonly secondsLeft: number
  readonly countdown: number
  readonly betweenRoundsLeft: number
  readonly playerHealth: number
  readonly opponentHealth: number
  readonly playerWins: number
  readonly opponentWins: number
  readonly roundWinner: MatchWinner | null
  readonly winner: MatchWinner | null
  readonly lastImpact: ImpactEvent | null
  readonly playerStats: FighterStats
  readonly opponentStats: FighterStats
}

export interface CombatInput {
  /** Same monotonic performance clock as capture. */
  readonly now: number
  /** Active camera, calibrated, fresh and valid pose. Not used to fake demo tracking. */
  readonly ready: boolean
  readonly generation: number
  readonly pulse: AnimationGestureSignal | null
  readonly mirrored: boolean
  readonly posture: 'neutral' | 'guard' | 'dodge-left' | 'dodge-right'
  readonly playerBase: Readonly<CombatRotations>
}
