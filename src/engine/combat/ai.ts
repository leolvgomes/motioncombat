import type { AttackKind, AttackSide } from '../../types/animation'
import type { FighterAction } from '../../types/combat'
import { COMBAT_RULES } from './config'
import { BALANCED_STYLE } from './opponents'
import type { AIStyle } from './opponents'

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

  constructor(seed: number, readonly style: AIStyle = BALANCED_STYLE) { this.randomState = seed | 0 || 0x45d9f3b }

  /** Cancels the current plan. Repeated contacts in a short time make the planner cover up instead of trading. */
  react(contact = false): void {
    this.state = 'idle'
    this.remaining = 0.3 + this.random() * 0.2
    this.followUps = 0
    if (!contact || this.style.passive) return
    this.pressure += 1
    this.pressureLeft = PRESSURE_SECONDS
    if (this.pressure < PRESSURE_HITS || this.random() >= this.style.coverUpChance) return
    this.state = 'guard'
    this.remaining = 0.65 + this.random() * 0.35
    this.pressure = 0
  }

  /** Asks a passive planner to wind up a specific attack. False while it is busy or out of range. */
  request(kind: AttackKind, side: AttackSide, distance: number): boolean {
    if (this.state !== 'idle' || distance > COMBAT_RULES.preferredDistance + 0.035) return false
    this.kind = kind
    this.side = side
    this.state = 'telegraph'
    this.remaining = this.style.windUp + EXTRA_TELEGRAPH[kind]
    return true
  }

  step(distance: number, attacking: boolean, elapsed: number): AIDecision {
    const result = this.output
    const style = this.style
    result.attack = null
    result.movement = 0
    result.blocking = false
    this.remaining -= elapsed
    this.pressureLeft -= elapsed
    if (this.pressureLeft <= 0) this.pressure = 0
    if (this.state === 'attacking') {
      if (!attacking) this.afterAttack(distance)
    } else if (this.state === 'approaching') {
      if (distance <= COMBAT_RULES.preferredDistance + 0.015) { this.state = 'idle'; this.remaining = (0.2 + this.random() * 0.35) * style.pause }
    } else if (this.state === 'telegraph') {
      if (this.remaining <= 0) { this.state = 'attacking'; result.attack = this.side }
    } else if (this.state === 'guard' || this.state === 'retreating') {
      if (this.remaining <= 0) { this.state = 'idle'; this.remaining = (0.15 + this.random() * 0.25) * style.pause }
    } else if (this.remaining <= 0) {
      if (distance > COMBAT_RULES.preferredDistance + 0.035) this.state = 'approaching'
      else if (!style.passive) {
        const choice = this.random()
        if (choice < style.guardChance) { this.state = 'guard'; this.remaining = 0.45 + this.random() * 0.4 }
        else if (choice < style.guardChance + style.retreatChance) { this.state = 'retreating'; this.remaining = 0.24 + this.random() * 0.15 }
        else this.prepare(style.windUp + this.random() * style.windUpRange, this.random() < 0.5 ? 'left' : 'right')
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
    const { straight, hook, uppercut } = this.style.kinds
    const choice = this.random() * (straight + hook + uppercut)
    this.kind = choice < straight ? 'straight' : choice < straight + hook ? 'hook' : 'uppercut'
    this.state = 'telegraph'
    this.side = side
    this.remaining = seconds + EXTRA_TELEGRAPH[this.kind]
  }

  private afterAttack(distance: number): void {
    if (this.followUps < this.style.maxFollowUps && distance <= COMBAT_RULES.preferredDistance + 0.035 && this.random() < this.style.followUpChance) {
      this.followUps += 1
      this.prepare(this.style.followUpWindUp, this.side === 'left' ? 'right' : 'left')
      return
    }
    this.followUps = 0
    if (this.style.passive) { this.state = 'idle'; this.remaining = 0.4; return }
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
