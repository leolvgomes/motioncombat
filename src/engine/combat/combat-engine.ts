import { Vector3 } from 'three'
import type { CombatEvent, CombatInput, CombatSnapshot, FighterFrame, FighterId, ImpactEvent, MatchMode, MatchWinner, PauseReason } from '../../types/combat'
import { CombatFighter } from './fighter'
import { CombatHitGeometry } from './collision'
import { COMBAT_RULES } from './config'

type MutableSnapshot = { -readonly [Key in keyof CombatSnapshot]: CombatSnapshot[Key] }
interface Resolution { result: ImpactEvent['result']; pending: boolean; readonly position: Vector3 }

const MAX_PENDING_EVENTS = 64

/** KO and timeout ties share the same explicit health comparison. */
export function healthWinner(player: number, opponent: number): MatchWinner {
  return player === opponent ? 'draw' : player > opponent ? 'player' : 'opponent'
}

/** Pure fixed-step match simulation. Rendering and React only read its cached outputs. */
export class CombatEngine {
  private readonly seed: number
  private readonly player: CombatFighter
  private readonly opponent: CombatFighter
  private readonly frameRecord: Record<FighterId, FighterFrame>
  private readonly geometry = new CombatHitGeometry()
  private readonly playerResolution: Resolution = { pending: false, result: 'miss', position: new Vector3() }
  private readonly opponentResolution: Resolution = { pending: false, result: 'miss', position: new Vector3() }
  private readonly events: CombatEvent[] = []
  private readonly state: MutableSnapshot
  private accumulator = 0
  private consumedSequence = -1
  private observedGeneration = 0
  private lockedGeneration = 0
  private lockedMirror = false
  private signalBoundary = Infinity
  private impactSequence = 0

  constructor(seed = 0x51ee1) {
    this.seed = Number.isFinite(seed) ? seed | 0 : 0x51ee1
    this.player = new CombatFighter('player', this.seed ^ 0x29c3)
    this.opponent = new CombatFighter('opponent', this.seed ^ 0x56f1)
    this.frameRecord = { player: this.player.frame, opponent: this.opponent.frame }
    this.state = {
      mode: 'webcam', phase: 'ready', pauseReason: null, round: 1, secondsLeft: COMBAT_RULES.roundSeconds,
      countdown: 0, betweenRoundsLeft: 0, playerHealth: COMBAT_RULES.health, opponentHealth: COMBAT_RULES.health,
      playerWins: 0, opponentWins: 0, roundWinner: null, winner: null, lastImpact: null,
      playerStats: this.player.stats, opponentStats: this.opponent.stats,
    }
  }

  get snapshot(): CombatSnapshot { return this.state }
  get fighters(): Record<FighterId, FighterFrame> { return this.frameRecord }

  /** Hands presentation events to one consumer, oldest first. Rules never read them back. */
  drainEvents(): CombatEvent[] { return this.events.splice(0) }

  start(mode: MatchMode, input: CombatInput): boolean {
    if (this.state.phase !== 'ready' && this.state.phase !== 'finished' || !Number.isFinite(input.now)
      || mode === 'webcam' && !this.validSource(input)) return false
    this.reset()
    this.state.mode = mode
    this.state.phase = 'countdown'
    this.state.countdown = COMBAT_RULES.countdown
    this.blockCurrentSignals(input)
    this.setBases(input)
    this.compose()
    this.emit({ type: 'countdown', round: 1, value: Math.ceil(COMBAT_RULES.countdown) })
    return true
  }

  step(input: CombatInput, elapsed: number): void {
    const active = this.state.phase !== 'ready' && this.state.phase !== 'finished'
    if (active && this.state.mode === 'webcam'
      && (!this.validSource(input) || input.generation !== this.lockedGeneration || input.mirrored !== this.lockedMirror)) this.pause('tracking')
    this.consumePulse(input)
    if (this.state.phase === 'finished') {
      const visualTime = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, COMBAT_RULES.maxFrameTime))
      this.player.advanceVisual(visualTime)
      this.opponent.advanceVisual(visualTime)
      this.compose()
      return
    }
    if (!active || this.state.pauseReason) return
    this.accumulator += Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, COMBAT_RULES.maxFrameTime))
    this.setBases(input)
    while (this.accumulator + 1e-10 >= COMBAT_RULES.fixedStep) {
      this.accumulator = Math.max(0, this.accumulator - COMBAT_RULES.fixedStep)
      this.fixedStep(input)
      if (this.snapshot.phase === 'finished') { this.accumulator = 0; break }
    }
  }

  pause(reason: PauseReason): void {
    if (this.state.phase === 'ready' || this.state.phase === 'finished') return
    if (this.state.pauseReason) {
      if (reason === 'tracking') this.state.pauseReason = 'tracking'
      return
    }
    this.state.pauseReason = reason
    this.accumulator = 0
    this.player.cancel()
    this.opponent.cancel()
    this.player.brain.react()
    this.opponent.brain.react()
  }

  resume(input: CombatInput): boolean {
    if (!this.state.pauseReason || !Number.isFinite(input.now)
      || this.state.mode === 'webcam' && !this.validSource(input)) return false
    this.state.pauseReason = null
    this.accumulator = 0
    this.blockCurrentSignals(input)
    this.setBases(input)
    return true
  }

  reset(): void {
    this.player.reset(this.seed ^ 0x29c3, true)
    this.opponent.reset(this.seed ^ 0x56f1, true)
    Object.assign(this.state, {
      mode: 'webcam', phase: 'ready', pauseReason: null, round: 1, secondsLeft: COMBAT_RULES.roundSeconds,
      countdown: 0, betweenRoundsLeft: 0, playerHealth: COMBAT_RULES.health, opponentHealth: COMBAT_RULES.health,
      playerWins: 0, opponentWins: 0, roundWinner: null, winner: null, lastImpact: null,
    })
    this.accumulator = 0
    this.consumedSequence = -1
    this.observedGeneration = 0
    this.lockedGeneration = 0
    this.lockedMirror = false
    this.signalBoundary = Infinity
    this.impactSequence = 0
    this.events.length = 0
  }

  private emit(event: CombatEvent): void {
    if (this.events.length >= MAX_PENDING_EVENTS) this.events.shift()
    this.events.push(event)
  }

  private validSource(input: CombatInput): boolean {
    return input.ready && Number.isFinite(input.now) && Number.isSafeInteger(input.generation) && input.generation >= 0
  }

  private blockCurrentSignals(input: CombatInput): void {
    this.lockedGeneration = input.generation
    this.observedGeneration = input.generation
    this.lockedMirror = input.mirrored
    this.signalBoundary = input.now
    this.consumedSequence = input.pulse?.generation === input.generation && Number.isSafeInteger(input.pulse.sequence)
      ? input.pulse.sequence : -1
  }

  private consumePulse(input: CombatInput): void {
    if (this.observedGeneration !== input.generation) {
      this.observedGeneration = input.generation
      this.consumedSequence = -1
    }
    const pulse = input.pulse
    if (!pulse || pulse.generation !== input.generation || !Number.isSafeInteger(pulse.sequence)
      || pulse.sequence < 0 || pulse.sequence <= this.consumedSequence) return
    this.consumedSequence = pulse.sequence
    const event = pulse.event
    const age = input.now - event.timestamp
    if (this.state.mode !== 'webcam' || this.state.phase !== 'fighting' || this.state.pauseReason
      || !this.validSource(input) || !Number.isFinite(age) || age < 0 || age > COMBAT_RULES.maximumGestureAgeMs
      || event.timestamp <= this.signalBoundary || !Number.isFinite(event.confidence) || event.confidence < 0.6 || event.confidence > 1) return
    if (event.type !== 'PUNCH_LEFT' && event.type !== 'PUNCH_RIGHT') return
    const humanLeft = event.type === 'PUNCH_LEFT'
    const side = (input.mirrored ? !humanLeft : humanLeft) ? 'left' : 'right'
    if (this.player.beginAttack(side)) this.emit({ type: 'attack', fighter: 'player', side })
  }

  private setBases(input: CombatInput): void {
    this.player.setBase(input, this.state.mode === 'webcam')
    this.opponent.setBase(input, false)
  }

  private fixedStep(input: CombatInput): void {
    const dt = COMBAT_RULES.fixedStep
    if (this.state.phase === 'countdown') {
      const shown = Math.ceil(this.state.countdown - 1e-8)
      this.state.countdown = Math.max(0, this.state.countdown - dt)
      if (this.state.countdown < 1e-8) {
        this.state.countdown = 0
        this.state.phase = 'fighting'
        this.emit({ type: 'fight', round: this.state.round })
      } else if (Math.ceil(this.state.countdown - 1e-8) !== shown) {
        this.emit({ type: 'countdown', round: this.state.round, value: Math.ceil(this.state.countdown - 1e-8) })
      }
      this.compose()
      return
    }
    if (this.state.phase === 'round-over') {
      this.player.advance(dt)
      this.opponent.advance(dt)
      this.state.betweenRoundsLeft = Math.max(0, this.state.betweenRoundsLeft - dt)
      if (this.state.betweenRoundsLeft < 1e-8) this.nextRound(input)
      this.compose()
      return
    }
    if (this.state.phase !== 'fighting') return

    this.player.advance(dt)
    this.opponent.advance(dt)
    if (this.state.mode === 'demo') this.updateAI(this.player, this.opponent, dt)
    else this.updatePlayerPosture(input, dt)
    this.updateAI(this.opponent, this.player, dt)
    this.compose()
    this.checkAttack(this.player, this.opponent, this.playerResolution)
    this.checkAttack(this.opponent, this.player, this.opponentResolution)
    // Both collision candidates are collected before stun cancels either attack.
    this.applyResolution(this.player, this.opponent, this.playerResolution)
    this.applyResolution(this.opponent, this.player, this.opponentResolution)
    this.state.secondsLeft = Math.max(0, this.state.secondsLeft - dt)
    this.state.playerHealth = this.player.health
    this.state.opponentHealth = this.opponent.health
    if (this.player.health <= 0 || this.opponent.health <= 0 || this.state.secondsLeft < 1e-8) this.endRound()
  }

  private updatePlayerPosture(input: CombatInput, dt: number): void {
    const availableDefense = this.player.stun <= 0
    this.player.blocking = availableDefense && !this.player.attack && input.posture === 'guard'
    this.player.action = this.player.blocking ? 'guard' : 'idle'
    const direction = input.posture === 'dodge-left' ? 1 : input.posture === 'dodge-right' ? -1 : 0
    const target = availableDefense ? direction * (input.mirrored ? -1 : 1) * COMBAT_RULES.dodgeDistance : 0
    this.player.dodge += (target - this.player.dodge) * -Math.expm1(-dt / 0.065)
  }

  private updateAI(fighter: CombatFighter, other: CombatFighter, dt: number): void {
    const previousTelegraph = fighter.telegraphSide
    fighter.blocking = false
    fighter.telegraphSide = null
    if (fighter.stun > 0 || fighter.returning > 0 || fighter.health <= 0) return
    const distance = Math.abs(fighter.anchorZ - other.anchorZ)
    const decision = fighter.brain.step(distance, fighter.attack !== null, dt)
    fighter.action = decision.action
    fighter.blocking = !fighter.attack && decision.blocking
    fighter.telegraphSide = decision.telegraphSide
    if (decision.telegraphSide && decision.telegraphSide !== previousTelegraph) {
      this.emit({ type: 'telegraph', fighter: fighter.id, side: decision.telegraphSide })
    }
    if (decision.movement !== 0 && !fighter.attack) {
      const toward = fighter.id === 'player' ? 1 : -1
      const speed = decision.movement === 1 ? COMBAT_RULES.approachSpeed : COMBAT_RULES.retreatSpeed
      const amount = decision.movement === 1 ? Math.min(speed * dt, Math.max(0, distance - COMBAT_RULES.preferredDistance)) : speed * dt
      fighter.anchorZ += toward * decision.movement * amount
      fighter.anchorZ = fighter.id === 'player' ? Math.max(-0.95, Math.min(0.4, fighter.anchorZ)) : Math.max(0.45, Math.min(1.8, fighter.anchorZ))
    }
    if (decision.attack && fighter.beginAttack(decision.attack)) this.emit({ type: 'attack', fighter: fighter.id, side: decision.attack })
  }

  private checkAttack(attacker: CombatFighter, defender: CombatFighter, resolution: Resolution): void {
    resolution.pending = false
    const attack = attacker.attack
    if (!attack || attack.resolved) return
    const window = attack.sampler.hitWindow
    const start = Math.max(attack.previousElapsed, window.start)
    const end = Math.min(attack.elapsed, window.end)
    if (end >= start && attack.elapsed >= window.start && attack.previousElapsed < window.end) {
      attacker.fistAt(start, this.geometry, attacker.sweepFrom)
      attacker.fistAt(end, this.geometry, attacker.sweepTo)
      resolution.position.copy(attacker.sweepTo)
      if (this.geometry.intersects(attacker.sweepFrom, attacker.sweepTo, defender.frame)) {
        attack.resolved = true
        resolution.pending = true
        resolution.result = defender.frame.blocking ? 'blocked' : 'hit'
      } else if (Math.abs(defender.dodge) > 0.12
        && this.geometry.intersects(attacker.sweepFrom, attacker.sweepTo, defender.frame, 0)) attack.dodged = true
    }
    if (!attack.resolved && attack.elapsed >= window.end) {
      attack.resolved = true
      resolution.pending = true
      resolution.result = attack.dodged ? 'dodged' : 'miss'
    }
  }

  private applyResolution(attacker: CombatFighter, defender: CombatFighter, resolution: Resolution): void {
    if (!resolution.pending) return
    const result = resolution.result
    let damage = 0
    if (result === 'hit' || result === 'blocked') {
      damage = defender.takeDamage(result === 'blocked' ? COMBAT_RULES.blockedDamage : COMBAT_RULES.damage)
      attacker.stats.damage += damage
      if (result === 'hit') attacker.stats.hits += 1
      else defender.stats.blocks += 1
    } else if (result === 'dodged') defender.stats.dodges += 1
    const impact: ImpactEvent = { id: ++this.impactSequence, attacker: attacker.id, result, damage }
    this.state.lastImpact = impact
    const { x, y, z } = resolution.position
    this.emit({ type: 'impact', impact: { ...impact }, position: [x, y, z], defenderHealth: defender.health })
  }

  private endRound(): void {
    const result = healthWinner(this.player.health, this.opponent.health)
    const knockout = this.player.health <= 0 || this.opponent.health <= 0
    this.state.roundWinner = result
    if (result === 'player') this.state.playerWins += 1
    else if (result === 'opponent') this.state.opponentWins += 1
    this.player.cancel()
    this.opponent.cancel()
    if (this.state.playerWins >= COMBAT_RULES.winsRequired || this.state.opponentWins >= COMBAT_RULES.winsRequired
      || this.state.round >= COMBAT_RULES.maxRounds) {
      this.state.phase = 'finished'
      this.state.winner = healthWinner(this.state.playerWins, this.state.opponentWins)
      this.state.betweenRoundsLeft = 0
    } else {
      this.state.phase = 'round-over'
      this.state.betweenRoundsLeft = COMBAT_RULES.betweenRounds
    }
    this.emit({ type: 'round-end', round: this.state.round, winner: result, knockout })
    if (this.state.winner) this.emit({ type: 'match-end', winner: this.state.winner, mode: this.state.mode })
    this.compose()
  }

  private nextRound(input: CombatInput): void {
    this.state.round += 1
    this.player.reset(this.seed ^ 0x29c3 ^ this.state.round * 0x9e37, false)
    this.opponent.reset(this.seed ^ 0x56f1 ^ this.state.round * 0x9e37, false)
    this.state.phase = 'fighting'
    this.state.secondsLeft = COMBAT_RULES.roundSeconds
    this.state.betweenRoundsLeft = 0
    this.state.roundWinner = null
    this.state.playerHealth = this.player.health
    this.state.opponentHealth = this.opponent.health
    this.blockCurrentSignals(input)
    this.setBases(input)
    this.emit({ type: 'fight', round: this.state.round })
  }

  private compose(): void {
    const end = this.state.phase === 'round-over' || this.state.phase === 'finished'
    const result = this.state.phase === 'finished' ? this.state.winner : this.state.roundWinner
    this.player.compose(end && result !== 'draw' && result !== null ? result === 'player' ? 'victory' : 'defeat' : null)
    this.opponent.compose(end && result !== 'draw' && result !== null ? result === 'opponent' ? 'victory' : 'defeat' : null)
  }
}
