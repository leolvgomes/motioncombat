import type { AttackSide } from '../../types/animation'
import type { FighterAction } from '../../types/combat'
import { COMBAT_RULES } from './config'

export interface AIDecision {
  action: FighterAction
  movement: -1 | 0 | 1
  blocking: boolean
  attack: AttackSide | null
  telegraphSide: AttackSide | null
}

/** A seeded planner that sees distance and its own attack state, never human pulses. */
export class CombatAI {
  private randomState: number
  private state: 'idle' | 'approaching' | 'telegraph' | 'attacking' | 'guard' | 'retreating' = 'idle'
  private remaining = 0.25
  private side: AttackSide = 'left'
  private readonly output: AIDecision = { action: 'idle', movement: 0, blocking: false, attack: null, telegraphSide: null }

  constructor(seed: number) { this.randomState = seed | 0 || 0x45d9f3b }

  react(): void { this.state = 'idle'; this.remaining = 0.3 + this.random() * 0.2 }

  step(distance: number, attacking: boolean, elapsed: number): AIDecision {
    const result = this.output
    result.attack = null
    result.movement = 0
    result.blocking = false
    this.remaining -= elapsed
    if (this.state === 'attacking') {
      if (!attacking) { this.state = 'retreating'; this.remaining = 0.28 + this.random() * 0.15 }
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
        else {
          this.state = 'telegraph'
          this.remaining = 0.55 + this.random() * 0.25
          this.side = this.random() < 0.5 ? 'left' : 'right'
        }
      }
    }
    result.action = this.state
    result.telegraphSide = this.state === 'telegraph' ? this.side : null
    result.blocking = this.state === 'guard'
    result.movement = this.state === 'approaching' ? 1 : this.state === 'retreating' ? -1 : 0
    return result
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
