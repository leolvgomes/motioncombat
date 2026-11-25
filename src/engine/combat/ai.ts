import type { AttackKind, AttackSide } from '../../types/animation'
import type { FighterAction } from '../../types/combat'
import { COMBAT_RULES } from './config'

export interface AIDecision {
  action: FighterAction
  movement: -1 | 0 | 1
  blocking: boolean
  attack: AttackSide | null
  telegraphSide: AttackSide | null
  /** Kind of the prepared or released attack; meaningless otherwise. */
  attackKind: AttackKind
}

// Slower attacks are also easier to read.
const EXTRA_TELEGRAPH: Readonly<Record<AttackKind, number>> = { straight: 0, hook: 0.08, uppercut: 0.16 }
const FOLLOW_UP_CHANCE = 0.22
const FOLLOW_UP_TELEGRAPH = 0.5
const MAX_FOLLOW_UPS = 2
const PRESSURE_SECONDS = 1.6
const PRESSURE_HITS = 2

/** A seeded planner that sees distance, its own attack state and the hits it takes, never human pulses. */
export class CombatAI {
  private randomState: number
  private state: 'idle' | 'approaching' | 'telegraph' | 'attacking' | 'guard' | 'retreating' = 'idle'
  private remaining = 0.25
  private side: AttackSide = 'left'
  private kind: AttackKind = 'straight'
  private followUps = 0
  private pressure = 0
  private pressureLeft = 0
  private readonly output: AIDecision = { action: 'idle', movement: 0, blocking: false, attack: null, telegraphSide: null, attackKind: 'straight' }

  constructor(seed: number) { this.randomState = seed | 0 || 0x45d9f3b }

  /** Cancels the current plan. Repeated contacts in a short time make the planner cover up instead of trading. */
  react(contact = false): void {
    this.state = 'idle'
    this.remaining = 0.3 + this.random() * 0.2
    this.followUps = 0
    if (!contact) return
    this.pressure += 1
    this.pressureLeft = PRESSURE_SECONDS
    if (this.pressure < PRESSURE_HITS || this.random() >= 0.65) return
    this.state = 'guard'
    this.remaining = 0.65 + this.random() * 0.35
    this.pressure = 0
  }

  step(distance: number, attacking: boolean, elapsed: number): AIDecision {
    const result = this.output
    result.attack = null
    result.movement = 0
    result.blocking = false
    this.remaining -= elapsed
    this.pressureLeft -= elapsed
    if (this.pressureLeft <= 0) this.pressure = 0
    if (this.state === 'attacking') {
      if (!attacking) this.afterAttack(distance)
    } else if (this.state === 'approaching') {
      if (distance <= COMBAT_RULES.preferredDistance + 0.015) { this.state = 'idle'; this.remaining = 0.2 + this.random() * 0.35 }
    } else if (this.state === 'telegraph') {
      if (this.remaining <= 0) { this.state = 'attacking'; result.attack = this.side }
    } else if (this.state === 'guard' || this.state === 'retreating') {
      if (this.remaining <= 0) { this.state = 'idle'; this.remaining = 0.15 + this.random() * 0.25 }
    } else if (this.remaining <= 0) {
      if (distance > COMBAT_RULES.preferredDistance + 0.035) this.state = 'approaching'
      else {
        const choice = this.random()
        if (choice < 0.2) { this.state = 'guard'; this.remaining = 0.45 + this.random() * 0.4 }
        else if (choice < 0.28) { this.state = 'retreating'; this.remaining = 0.24 + this.random() * 0.15 }
        else this.prepare(0.55 + this.random() * 0.25, this.random() < 0.5 ? 'left' : 'right')
      }
    }
    result.action = this.state
    result.telegraphSide = this.state === 'telegraph' ? this.side : null
    result.attackKind = this.kind
    result.blocking = this.state === 'guard'
    result.movement = this.state === 'approaching' ? 1 : this.state === 'retreating' ? -1 : 0
    return result
  }

  private prepare(seconds: number, side: AttackSide): void {
    const choice = this.random()
    this.kind = choice < 0.62 ? 'straight' : choice < 0.84 ? 'hook' : 'uppercut'
    this.state = 'telegraph'
    this.side = side
    this.remaining = seconds + EXTRA_TELEGRAPH[this.kind]
  }

  private afterAttack(distance: number): void {
    if (this.followUps < MAX_FOLLOW_UPS && distance <= COMBAT_RULES.preferredDistance + 0.035 && this.random() < FOLLOW_UP_CHANCE) {
      this.followUps += 1
      this.prepare(FOLLOW_UP_TELEGRAPH, this.side === 'left' ? 'right' : 'left')
      return
    }
    this.followUps = 0
    this.state = 'retreating'
    this.remaining = 0.28 + this.random() * 0.15
  }

  private random(): number {
    let value = this.randomState
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.randomState = value
    return (value >>> 0) / 0x1_0000_0000
  }
}
