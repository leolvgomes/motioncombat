import { Quaternion } from 'three'
import { describe, expect, it } from 'vitest'
import type { AttackSide } from '../../types/animation'
import type { CombatInput, CombatRotations, MatchMode } from '../../types/combat'
import type { AnimationGestureSignal } from '../../features/robot/animation-signals'
import { createCombatGuardPose } from '../animation/combat-clips'
import { RIG_JOINTS } from '../motion/rig-controller'
import { CombatEngine, healthWinner } from './combat-engine'
import { CombatFighter } from './fighter'
import { CombatHitGeometry } from './collision'

function base(): CombatRotations {
  const pose = createCombatGuardPose()
  return Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...pose[name])])) as CombatRotations
}

class MatchHarness {
  readonly engine: CombatEngine
  readonly input: {
    now: number; ready: boolean; generation: number; pulse: AnimationGestureSignal | null;
    mirrored: boolean; posture: CombatInput['posture']; playerBase: CombatRotations
  } = { now: 1000, ready: true, generation: 1, pulse: null, mirrored: false, posture: 'neutral', playerBase: base() }
  private sequence = 0

  constructor(seed = 0x51ee1, mode: MatchMode = 'webcam') {
    this.engine = new CombatEngine(seed)
    expect(this.engine.start(mode, this.input)).toBe(true)
  }

  tick(elapsed = 1 / 60): void {
    this.input.now += elapsed * 1000
    this.engine.step(this.input, elapsed)
  }

  advance(seconds: number, fps = 60): void {
    let left = seconds
    while (left > 1e-8) { const dt = Math.min(left, 1 / fps); this.tick(dt); left -= dt }
  }

  fire(side: AttackSide = 'left', age = 0): void {
    this.input.now += 1
    this.input.pulse = {
      sequence: ++this.sequence, generation: this.input.generation,
      event: { type: side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', timestamp: this.input.now - age, confidence: 0.95 },
    }
    this.engine.step(this.input, 0)
  }

  until(predicate: () => boolean, seconds = 20): void {
    for (let frame = 0; frame < seconds * 60 && !predicate(); frame += 1) this.tick()
    expect(predicate()).toBe(true)
  }
}

function frames(engine: CombatEngine) {
  return Object.fromEntries((['player', 'opponent'] as const).map((side) => [side, {
    position: [...engine.fighters[side].position],
    rotations: Object.fromEntries(RIG_JOINTS.map((joint) => [joint, engine.fighters[side].rotations[joint].toArray()])),
  }]))
}

describe('CombatEngine lifecycle and replay gates', () => {
  it('keeps cached outputs and requires a trustworthy webcam source while demo is independent', () => {
    const engine = new CombatEngine(1)
    const input: CombatInput = { now: 0, ready: false, generation: 0, pulse: null, mirrored: false, posture: 'neutral', playerBase: base() }
    const snapshot = engine.snapshot
    const fighters = engine.fighters
    expect(engine.start('webcam', input)).toBe(false)
    expect(engine.start('demo', input)).toBe(true)
    engine.step(input, 0.1)
    expect(engine.snapshot).toBe(snapshot)
    expect(engine.fighters).toBe(fighters)
    expect(engine.snapshot.phase).toBe('countdown')
    engine.reset()
    expect(engine.snapshot.phase).toBe('ready')
    expect(engine.snapshot.playerStats.attacks).toBe(0)
    expect(engine.fighters).toBe(fighters)
  })

  it('runs a three-second countdown and consumes early pulses without queuing', () => {
    const match = new MatchHarness()
    match.fire()
    match.advance(2.9)
    expect(match.engine.snapshot.phase).toBe('countdown')
    expect(match.engine.snapshot.playerStats.attacks).toBe(0)
    match.advance(0.1)
    expect(match.engine.snapshot.phase).toBe('fighting')
    expect(match.engine.snapshot.secondsLeft).toBe(45)
    match.advance(0.1)
    expect(match.engine.snapshot.playerStats.attacks).toBe(0)
    match.fire()
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
  })

  it('consumes duplicate, busy, old and future events instead of replaying them later', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.fire()
    match.fire('right')
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    match.advance(0.7)
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    match.fire('left', 251)
    match.advance(0.1)
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    match.fire('left', -50)
    match.advance(0.2)
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    match.fire('right')
    expect(match.engine.snapshot.playerStats.attacks).toBe(2)
  })

  it('maps anatomical punch sides through mirroring exactly once', () => {
    const match = new MatchHarness()
    match.input.mirrored = true
    match.engine.pause('manual')
    expect(match.engine.resume(match.input)).toBe(true)
    match.advance(3)
    match.fire('left')
    match.tick()
    expect(match.engine.fighters.player.attackSide).toBe('right')
    expect(match.engine.fighters.player.action).toBe('attacking')
  })

  it.each(['manual', 'view', 'hidden'] as const)('freezes poses and all match clocks during %s pause, and never queues an input', (reason) => {
    const match = new MatchHarness()
    match.advance(3)
    match.fire()
    match.advance(0.15)
    match.engine.pause(reason)
    const frozen = structuredClone(match.engine.snapshot)
    const pose = frames(match.engine)
    match.fire('right')
    match.advance(8)
    expect(match.engine.snapshot).toEqual(frozen)
    expect(frames(match.engine)).toEqual(pose)
    expect(match.engine.fighters.player.hitActive).toBe(false)
    expect(match.engine.resume(match.input)).toBe(true)
    match.advance(0.7)
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    expect(match.engine.snapshot.secondsLeft).toBeLessThan(frozen.secondsLeft)
  })

  it.each(['missing', 'generation', 'mirror'] as const)('persists a tracking pause after %s changes until a valid manual resume', (change) => {
    const match = new MatchHarness()
    match.advance(3)
    match.fire()
    match.advance(0.1)
    if (change === 'missing') match.input.ready = false
    else if (change === 'generation') match.input.generation += 1
    else match.input.mirrored = true
    match.tick()
    expect(match.engine.snapshot.pauseReason).toBe('tracking')
    expect(match.engine.fighters.player.hitActive).toBe(false)
    const remaining = match.engine.snapshot.secondsLeft
    match.input.ready = true
    match.advance(1)
    expect(match.engine.snapshot.pauseReason).toBe('tracking')
    expect(match.engine.snapshot.secondsLeft).toBe(remaining)
    match.input.ready = false
    expect(match.engine.resume(match.input)).toBe(false)
    match.input.ready = true
    match.fire()
    expect(match.engine.resume(match.input)).toBe(true)
    match.advance(0.4)
    expect(match.engine.snapshot.pauseReason).toBeNull()
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
  })

  it('blocks a pulse already present at start or resume even if its sequence later changes', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.engine.pause('manual')
    match.fire()
    const oldTimestamp = match.input.pulse!.event.timestamp
    expect(match.engine.resume(match.input)).toBe(true)
    match.input.pulse = { ...match.input.pulse!, sequence: 100, event: { ...match.input.pulse!.event, timestamp: oldTimestamp } }
    match.advance(0.2)
    expect(match.engine.snapshot.playerStats.attacks).toBe(0)
  })

  it('clamps long frames and safely ignores non-finite elapsed values', () => {
    const match = new MatchHarness()
    match.engine.step(match.input, 10)
    expect(match.engine.snapshot.countdown).toBeCloseTo(2.75)
    match.engine.step(match.input, Number.NaN)
    match.engine.step(match.input, Number.POSITIVE_INFINITY)
    match.engine.step(match.input, -1)
    expect(match.engine.snapshot.countdown).toBeCloseTo(2.75)
  })
})

describe('geometric combat and defense', () => {
  it('records an out-of-range miss rather than damaging the opponent from a gesture', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.fire()
    match.advance(0.3)
    expect(match.engine.snapshot.playerStats.attacks).toBe(1)
    expect(match.engine.snapshot.playerStats.hits).toBe(0)
    expect(match.engine.snapshot.opponentHealth).toBe(100)
    expect(match.engine.snapshot.lastImpact?.result).toBe('miss')
    expect(match.engine.snapshot.lastImpact?.damage).toBe(0)
  })

  it('applies exactly one real contact per attack and stuns/cancels the defender', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.until(() => match.engine.fighters.opponent.action === 'telegraph')
    match.fire()
    match.advance(0.16)
    expect(match.engine.snapshot.opponentHealth).toBe(88)
    expect(match.engine.snapshot.playerStats.hits).toBe(1)
    expect(match.engine.snapshot.playerStats.damage).toBe(12)
    expect(match.engine.fighters.opponent.action).toBe('stunned')
    expect(match.engine.snapshot.lastImpact?.result).toBe('hit')
    expect(match.engine.fighters.player.position[2]).toBeGreaterThan(-0.62)
    match.advance(0.3)
    expect(match.engine.snapshot.opponentHealth).toBe(88)
    expect(match.engine.snapshot.playerStats.hits).toBe(1)
  })

  it('preserves real contact detection at a four-FPS display rate', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.until(() => match.engine.fighters.opponent.action === 'telegraph')
    match.fire()
    match.advance(0.25, 4)
    expect(match.engine.snapshot.opponentHealth).toBe(88)
    expect(match.engine.snapshot.playerStats.hits).toBe(1)
  })

  it('does not damage an opponent merely by moving the base pose or holding an old pulse', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.until(() => match.engine.fighters.opponent.action === 'telegraph')
    match.input.playerBase.leftShoulder.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2)
    match.input.playerBase.leftElbow.identity()
    match.advance(0.3)
    expect(match.engine.snapshot.opponentHealth).toBe(100)
    expect(match.engine.snapshot.playerStats.attacks).toBe(0)
  })

  it('reduces a geometric hit to three chip damage while counting the defender block', () => {
    const match = new MatchHarness()
    match.input.posture = 'guard'
    match.advance(3)
    match.until(() => match.engine.snapshot.playerStats.blocks > 0)
    expect(match.engine.snapshot.playerHealth).toBe(97)
    expect(match.engine.snapshot.opponentStats.damage).toBe(3)
    expect(match.engine.snapshot.opponentStats.hits).toBe(0)
    expect(match.engine.snapshot.playerStats.blocks).toBe(1)
    expect(match.engine.snapshot.lastImpact?.result).toBe('blocked')
  })

  it('moves the visible fighter and hurtboxes together and only counts a dodge of an otherwise real hit', () => {
    const match = new MatchHarness()
    match.advance(3)
    match.until(() => match.engine.fighters.opponent.action === 'telegraph')
    const side = match.engine.fighters.opponent.attackSide
    match.input.posture = side === 'left' ? 'dodge-left' : 'dodge-right'
    match.until(() => match.engine.snapshot.playerStats.dodges > 0)
    expect(Math.abs(match.engine.fighters.player.position[0])).toBeGreaterThan(0.5)
    expect(match.engine.snapshot.playerHealth).toBe(100)
    expect(match.engine.snapshot.opponentStats.damage).toBe(0)
    expect(match.engine.snapshot.lastImpact?.result).toBe('dodged')
    const count = match.engine.snapshot.playerStats.dodges
    match.advance(0.1)
    expect(match.engine.snapshot.playerStats.dodges).toBe(count)
  })

  it('supports simultaneous knockout contacts and caps the effective damage at remaining health', () => {
    const player = new CombatFighter('player', 1)
    const opponent = new CombatFighter('opponent', 2)
    opponent.anchorZ = 0.65
    player.health = 4
    opponent.health = 4
    player.beginAttack('left')
    opponent.beginAttack('right')
    player.advance(0.15)
    opponent.advance(0.15)
    player.compose()
    opponent.compose()
    const geometry = new CombatHitGeometry()
    geometry.fist(player.frame, 'left', player.sweepFrom)
    geometry.fist(opponent.frame, 'right', opponent.sweepFrom)
    const playerHit = geometry.intersects(player.sweepFrom, player.sweepFrom, opponent.frame)
    const opponentHit = geometry.intersects(opponent.sweepFrom, opponent.sweepFrom, player.frame)
    expect(playerHit && opponentHit).toBe(true)
    expect(player.takeDamage(12)).toBe(4)
    expect(opponent.takeDamage(12)).toBe(4)
    expect(healthWinner(player.health, opponent.health)).toBe('draw')
    expect(player.attack).toBeNull()
    expect(opponent.attack).toBeNull()
  })
})

describe('rounds, AI matches and terminal poses', () => {
  it('runs real AI contacts and finishes a deterministic demo with coherent scores and statistics', () => {
    const match = new MatchHarness(0x51ee1, 'demo')
    match.input.ready = false
    const snapshot = match.engine.snapshot
    for (let frame = 0; frame < 1500 && snapshot.phase !== 'finished'; frame += 1) {
      const health = [snapshot.playerHealth, snapshot.opponentHealth]
      const damage = [snapshot.playerStats.damage, snapshot.opponentStats.damage]
      const round = snapshot.round
      match.tick(0.1)
      if (snapshot.round === round) {
        expect(snapshot.playerStats.damage - damage[0]).toBe(health[1]! - snapshot.opponentHealth)
        expect(snapshot.opponentStats.damage - damage[1]).toBe(health[0]! - snapshot.playerHealth)
      }
    }
    expect(snapshot.phase).toBe('finished')
    expect(snapshot.round).toBeLessThanOrEqual(3)
    expect(snapshot.playerStats.attacks).toBeGreaterThan(0)
    expect(snapshot.opponentStats.attacks).toBeGreaterThan(0)
    expect(snapshot.playerStats.damage).toBeGreaterThan(0)
    expect(snapshot.opponentStats.damage).toBeGreaterThan(0)
    expect(snapshot.playerStats.hits + snapshot.opponentStats.hits).toBeGreaterThan(0)
    expect(snapshot.playerHealth).toBeGreaterThanOrEqual(0)
    expect(snapshot.opponentHealth).toBeGreaterThanOrEqual(0)
    expect(snapshot.winner).toBe(healthWinner(snapshot.playerWins, snapshot.opponentWins))
    if (snapshot.playerWins === 2 || snapshot.opponentWins === 2) expect(snapshot.round).toBeLessThanOrEqual(3)
  })

  it.each([15, 30, 144])('produces the same fixed-step AI outcome at %s FPS as at 60 FPS', (fps) => {
    const baseline = new MatchHarness(77, 'demo')
    const compared = new MatchHarness(77, 'demo')
    baseline.advance(30, 60)
    compared.advance(30, fps)
    expect(compared.engine.snapshot).toEqual(baseline.engine.snapshot)
    expect(frames(compared.engine)).toEqual(frames(baseline.engine))
  })

  it('uses 45-second rounds, a three-second break and finishes early at two wins', () => {
    const match = new MatchHarness(77)
    match.input.posture = 'guard'
    match.advance(3)
    match.advance(45)
    expect(match.engine.snapshot.phase).toBe('round-over')
    expect(match.engine.snapshot.secondsLeft).toBeCloseTo(0)
    expect(match.engine.snapshot.opponentWins).toBe(1)
    expect(match.engine.snapshot.betweenRoundsLeft).toBe(3)
    match.advance(3)
    expect(match.engine.snapshot.phase).toBe('fighting')
    expect(match.engine.snapshot.round).toBe(2)
    expect(match.engine.snapshot.secondsLeft).toBe(45)
    expect(match.engine.snapshot.playerHealth).toBe(100)
    expect(match.engine.snapshot.opponentHealth).toBe(100)
    match.advance(45)
    expect(match.engine.snapshot.phase).toBe('finished')
    expect(match.engine.snapshot.round).toBe(2)
    expect(match.engine.snapshot.opponentWins).toBe(2)
    expect(match.engine.snapshot.winner).toBe('opponent')
  })

  it('permits three drawn rounds and a drawn match without inventing damage', () => {
    const match = new MatchHarness(77)
    for (let frame = 0; frame < 9000 && match.engine.snapshot.phase !== 'finished'; frame += 1) {
      if (match.engine.fighters.opponent.action === 'telegraph') {
        match.input.posture = match.engine.fighters.opponent.attackSide === 'left' ? 'dodge-left' : 'dodge-right'
      }
      match.tick()
    }
    expect(match.engine.snapshot.phase).toBe('finished')
    expect(match.engine.snapshot.round).toBe(3)
    expect(match.engine.snapshot.winner).toBe('draw')
    expect(match.engine.snapshot.playerWins).toBe(0)
    expect(match.engine.snapshot.opponentWins).toBe(0)
    expect(match.engine.snapshot.playerHealth).toBe(100)
    expect(match.engine.snapshot.opponentHealth).toBe(100)
    expect(match.engine.snapshot.playerStats.dodges).toBeGreaterThan(0)
    expect(match.engine.snapshot.opponentStats.damage).toBe(0)
  })

  it('blends outcome entry from the current pose and reaches its terminal pose without a jump', () => {
    const actor = new CombatFighter('player', 1)
    actor.beginAttack('left')
    actor.advance(0.15)
    actor.compose()
    const before = actor.frame.rotations.leftShoulder.clone()
    actor.cancel()
    actor.compose('victory')
    expect(actor.frame.rotations.leftShoulder.angleTo(before)).toBeLessThan(1e-7)
    actor.advanceVisual(0.01)
    actor.compose('victory')
    expect(actor.frame.rotations.leftShoulder.angleTo(before)).toBeLessThan(0.02)
    actor.advanceVisual(0.34)
    actor.compose('victory')
    expect(actor.frame.rotations.leftShoulder.angleTo(actor.victory.leftShoulder)).toBeLessThan(1e-7)
  })

  it('keeps gameplay frozen after finishing while allowing the outcome pose to settle', () => {
    const match = new MatchHarness(77, 'demo')
    match.until(() => match.engine.snapshot.phase === 'finished', 150)
    const frozen = structuredClone(match.engine.snapshot)
    const before = match.engine.fighters.player.rotations.leftShoulder.clone()
    match.fire()
    match.advance(0.5)
    expect(match.engine.snapshot).toEqual(frozen)
    if (frozen.winner !== 'draw') expect(match.engine.fighters.player.rotations.leftShoulder.angleTo(before)).toBeGreaterThan(0.1)
    const settled = frames(match.engine)
    match.advance(2)
    expect(match.engine.snapshot).toEqual(frozen)
    expect(frames(match.engine)).toEqual(settled)
  })
})
