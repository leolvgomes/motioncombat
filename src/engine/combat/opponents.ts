import type { AttackKind } from '../../types/animation'

/** How a planner fights. Every opponent shares hitboxes, reach, health and attack clips; only decisions differ. */
export interface AIStyle {
  /** Wind-up before a first attack: windUp + random × windUpRange seconds, never below MIN_WIND_UP. */
  readonly windUp: number
  readonly windUpRange: number
  /** Wind-up before a follow-up attack, in seconds. */
  readonly followUpWindUp: number
  /** Multiplies the idle pauses between decisions. */
  readonly pause: number
  /** Chances, per decision in range, of covering up and of stepping back. */
  readonly guardChance: number
  readonly retreatChance: number
  /** Relative weights of each attack kind. */
  readonly kinds: Readonly<Record<AttackKind, number>>
  readonly followUpChance: number
  readonly maxFollowUps: number
  /** Chance of covering up after repeated hits instead of trading. */
  readonly coverUpChance: number
  /** Training dummies attack only when asked. */
  readonly passive: boolean
}

/** No wind-up is shorter than this: the player must still see it through the camera latency. */
export const MIN_WIND_UP = 0.42

/** The original VULCAN-07 behaviour; every earlier match used it. */
export const BALANCED_STYLE: AIStyle = Object.freeze({
  windUp: 0.55, windUpRange: 0.25, followUpWindUp: 0.5, pause: 1, guardChance: 0.2, retreatChance: 0.08,
  kinds: Object.freeze({ straight: 0.62, hook: 0.22, uppercut: 0.16 }),
  followUpChance: 0.22, maxFollowUps: 2, coverUpChance: 0.65, passive: false,
})

export type Difficulty = 'easy' | 'normal' | 'hard'
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

interface DifficultyRules {
  readonly label: string
  readonly description: string
  /** Multiplies wind-ups (longer is easier to read). */
  readonly windUp: number
  /** Multiplies idle pauses (longer gives more openings). */
  readonly pause: number
  readonly followUp: number
  /** Multiplies the damage the opponent deals to a webcam player. */
  readonly damage: number
  /** Multiplies the career score of a won or drawn match. */
  readonly score: number
}

export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRules>> = Object.freeze({
  easy: Object.freeze({ label: 'Fácil', description: 'Avisos mais longos, mais pausas e golpes mais fracos.', windUp: 1.35, pause: 1.45, followUp: 0.5, damage: 0.75, score: 0.8 }),
  normal: Object.freeze({ label: 'Normal', description: 'O ritmo de sempre.', windUp: 1, pause: 1, followUp: 1, damage: 1, score: 1 }),
  hard: Object.freeze({ label: 'Difícil', description: 'Avisos curtos, pressão constante e golpes mais fortes.', windUp: 0.82, pause: 0.7, followUp: 1.4, damage: 1.15, score: 1.25 }),
})

export function applyDifficulty(style: AIStyle, difficulty: Difficulty): AIStyle {
  const rules = DIFFICULTY_RULES[difficulty]
  if (difficulty === 'normal') return style
  return Object.freeze({
    ...style,
    windUp: Math.max(MIN_WIND_UP, style.windUp * rules.windUp),
    windUpRange: style.windUpRange * rules.windUp,
    followUpWindUp: Math.max(MIN_WIND_UP, style.followUpWindUp * rules.windUp),
    pause: style.pause * rules.pause,
    followUpChance: Math.min(0.6, style.followUpChance * rules.followUp),
  })
}

export type OpponentId = 'vulcan' | 'kestrel' | 'basalt' | 'magna'
export const OPPONENT_IDS: readonly OpponentId[] = ['kestrel', 'basalt', 'magna', 'vulcan']
export const DEFAULT_OPPONENT: OpponentId = 'vulcan'

export interface OpponentProfile {
  readonly id: OpponentId
  readonly name: string
  /** One word for the fighting style. */
  readonly style: string
  readonly description: string
  /** What to do against it, shown before the fight. */
  readonly tip: string
  readonly ai: AIStyle
}

export const OPPONENTS: Readonly<Record<OpponentId, OpponentProfile>> = Object.freeze({
  kestrel: Object.freeze({
    id: 'kestrel', name: 'KESTREL-3', style: 'Veloz',
    description: 'Socos retos rápidos e sai do alcance logo depois.',
    tip: 'Segure a guarda nas sequências e contra-ataque quando ele voltar.',
    ai: Object.freeze({
      ...BALANCED_STYLE, windUp: 0.5, windUpRange: 0.18, followUpWindUp: 0.46, pause: 0.7, guardChance: 0.1, retreatChance: 0.22,
      kinds: Object.freeze({ straight: 0.82, hook: 0.13, uppercut: 0.05 }), followUpChance: 0.3, maxFollowUps: 1, coverUpChance: 0.4,
    }),
  }),
  basalt: Object.freeze({
    id: 'basalt', name: 'BASALTO-9', style: 'Muralha',
    description: 'Fica na guarda, se fecha quando apanha e responde com uppercuts pesados.',
    tip: 'Golpes bloqueados quase não causam dano: ataque logo depois de ele baixar a guarda.',
    ai: Object.freeze({
      ...BALANCED_STYLE, windUp: 0.66, windUpRange: 0.3, followUpWindUp: 0.55, pause: 1.2, guardChance: 0.4, retreatChance: 0.05,
      kinds: Object.freeze({ straight: 0.4, hook: 0.25, uppercut: 0.35 }), followUpChance: 0.14, maxFollowUps: 1, coverUpChance: 0.9,
    }),
  }),
  magna: Object.freeze({
    id: 'magna', name: 'MAGNA-X', style: 'Pressão',
    description: 'Avança sem parar e encadeia até quatro golpes, quase sem se defender.',
    tip: 'Esquive a sequência e puna: ela raramente bloqueia.',
    ai: Object.freeze({
      ...BALANCED_STYLE, windUp: 0.55, windUpRange: 0.2, followUpWindUp: 0.46, pause: 0.75, guardChance: 0.07, retreatChance: 0.04,
      kinds: Object.freeze({ straight: 0.45, hook: 0.35, uppercut: 0.2 }), followUpChance: 0.4, maxFollowUps: 3, coverUpChance: 0.3,
    }),
  }),
  vulcan: Object.freeze({
    id: 'vulcan', name: 'VULCAN-07', style: 'Equilibrado',
    description: 'Mistura ataque, guarda e recuo. O campeão do circuito.',
    tip: 'Observe o aviso de cada golpe: o cruzado e o uppercut demoram mais para sair.',
    ai: BALANCED_STYLE,
  }),
})

/** The training dummy approaches and waits; the guided training decides when it swings. */
export const TRAINING_STYLE: AIStyle = Object.freeze({
  ...BALANCED_STYLE, windUp: 0.95, windUpRange: 0, guardChance: 0, retreatChance: 0, followUpChance: 0, maxFollowUps: 0,
  coverUpChance: 0, passive: true,
})
export const TRAINING_NAME = 'SPARRING'
/** Whoever stands in the opposite corner: a selectable opponent or the training robot. */
export type RivalId = OpponentId | 'sparring'

export function rivalName(id: RivalId): string { return id === 'sparring' ? TRAINING_NAME : opponentProfile(id).name }

export function opponentProfile(id: OpponentId): OpponentProfile { return OPPONENTS[id] ?? OPPONENTS[DEFAULT_OPPONENT] }
export function sanitizeOpponent(value: unknown): OpponentId {
  return OPPONENT_IDS.includes(value as OpponentId) ? value as OpponentId : DEFAULT_OPPONENT
}
export function sanitizeDifficulty(value: unknown): Difficulty {
  return DIFFICULTIES.includes(value as Difficulty) ? value as Difficulty : 'normal'
}
