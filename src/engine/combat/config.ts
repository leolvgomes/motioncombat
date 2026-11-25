import type { AttackKind } from '../../types/animation'

interface AttackRules {
  readonly damage: number
  readonly blockedDamage: number
  /** Forward root travel at full extension, in metres. */
  readonly lunge: number
}

/** Slower attacks hit harder. Timings live with the animation clips. */
export const ATTACK_RULES: Readonly<Record<AttackKind, AttackRules>> = Object.freeze({
  straight: Object.freeze({ damage: 12, blockedDamage: 3, lunge: 0.13 }),
  hook: Object.freeze({ damage: 15, blockedDamage: 4, lunge: 0.32 }),
  uppercut: Object.freeze({ damage: 18, blockedDamage: 4, lunge: 0.38 }),
})

export const COMBAT_RULES = Object.freeze({
  fixedStep: 1 / 60,
  maxFrameTime: 0.25,
  countdown: 3,
  roundSeconds: 45,
  betweenRounds: 3,
  maxRounds: 3,
  winsRequired: 2,
  health: 100,
  stunSeconds: 0.26,
  returnSeconds: 0.18,
  outcomeSeconds: 0.35,
  maximumGestureAgeMs: 250,
  playerStartZ: -0.72,
  opponentStartZ: 1.6,
  preferredDistance: 1.37,
  approachSpeed: 0.65,
  retreatSpeed: 0.45,
  dodgeDistance: 0.52,
})
