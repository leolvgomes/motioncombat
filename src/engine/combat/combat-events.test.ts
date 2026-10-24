import { Quaternion } from 'three'
import { describe, expect, it } from 'vitest'
import type { CombatEvent, CombatInput, CombatRotations, FighterId, MatchMode } from '../../types/combat'
import type { AttackSide } from '../../types/animation'
import { createCombatGuardPose } from '../animation/combat-clips'
import { RIG_JOINTS } from '../motion/rig-controller'
import { CombatEngine } from './combat-engine'

function base(): CombatRotations {
  const pose = createCombatGuardPose()
  return Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...pose[name])])) as CombatRotations
}

function harness(mode: MatchMode, seed = 0x51ee1) {
  const engine = new CombatEngine(seed)
  const input: { -readonly [Key in keyof CombatInput]: CombatInput[Key] } = {
    now: 1000, ready: true, generation: 1, pulse: null, mirrored: false, posture: 'neutral', playerBase: base(),
  }
  const events: CombatEvent[] = []
  expect(engine.start(mode, input)).toBe(true)
  events.push(...engine.drainEvents())
  const tick = (dt = 1 / 60) => {
    input.now += dt * 1000
    engine.step(input, dt)
    events.push(...engine.drainEvents())
  }
  return { engine, input, events, tick }
}

const ofType = <Type extends CombatEvent['type']>(events: CombatEvent[], type: Type) =>
  events.filter((event): event is Extract<CombatEvent, { type: Type }> => event.type === type)

describe('combat presentation events', () => {
  it('describes a complete demo match consistently with the final statistics', () => {
    const match = harness('demo')
    for (let frame = 0; frame < 150 * 60 && match.engine.snapshot.phase !== 'finished'; frame++) match.tick()
    const { snapshot } = match.engine
    expect(snapshot.phase).toBe('finished')

    expect(match.events.slice(0, 4)).toEqual([
      { type: 'countdown', round: 1, value: 3 },
      { type: 'countdown', round: 1, value: 2 },
      { type: 'countdown', round: 1, value: 1 },
      { type: 'fight', round: 1 },
    ])
    expect(ofType(match.events, 'fight').map((event) => event.round)).toEqual(Array.from({ length: snapshot.round }, (_, index) => index + 1))

    const impacts = ofType(match.events, 'impact')
    const count = (result: string) => impacts.filter((event) => event.impact.result === result).length
    const { playerStats: player, opponentStats: opponent } = snapshot
    expect(ofType(match.events, 'attack')).toHaveLength(player.attacks + opponent.attacks)
    expect(count('hit')).toBe(player.hits + opponent.hits)
    expect(count('blocked')).toBe(player.blocks + opponent.blocks)
    expect(count('dodged')).toBe(player.dodges + opponent.dodges)
    expect(count('hit')).toBeGreaterThan(0)
    impacts.forEach((event, index) => {
      expect(event.position.every(Number.isFinite)).toBe(true)
      expect(event.defenderHealth).toBeGreaterThanOrEqual(0)
      if (index > 0) expect(event.impact.id).toBeGreaterThan(impacts[index - 1].impact.id)
    })

    const rounds = ofType(match.events, 'round-end')
    expect(rounds.map((event) => event.round)).toEqual(Array.from({ length: snapshot.round }, (_, index) => index + 1))
    expect(rounds.filter((event) => event.winner === 'player')).toHaveLength(snapshot.playerWins)
    expect(rounds.filter((event) => event.winner === 'opponent')).toHaveLength(snapshot.opponentWins)
    for (const round of rounds.filter((event) => event.knockout)) {
      const index = match.events.indexOf(round)
      const lastImpact = ofType(match.events.slice(0, index), 'impact').at(-1)
      expect(lastImpact?.defenderHealth).toBe(0)
    }

    const ends = ofType(match.events, 'match-end')
    expect(ends).toEqual([{ type: 'match-end', winner: snapshot.winner, mode: 'demo' }])
    expect(match.events.at(-1)).toEqual(ends[0])
  })

  it('announces every AI punch with a visible wind-up of the same side first', () => {
    const match = harness('demo', 77)
    for (let frame = 0; frame < 40 * 60; frame++) match.tick()
    const pending: Record<FighterId, AttackSide | null> = { player: null, opponent: null }
    let attacks = 0
    for (const event of match.events) {
      if (event.type === 'telegraph') pending[event.fighter] = event.side
      if (event.type === 'attack') {
        expect(pending[event.fighter]).toBe(event.side)
        pending[event.fighter] = null
        attacks++
      }
    }
    expect(attacks).toBeGreaterThan(2)
  })

  it('reports a body-controlled punch on the robot side after mirroring', () => {
    const match = harness('webcam')
    for (let frame = 0; frame < 3.2 * 60; frame++) match.tick()
    expect(match.engine.snapshot.phase).toBe('fighting')
    match.input.mirrored = true
    match.engine.reset()
    expect(match.engine.drainEvents()).toEqual([])
    expect(match.engine.start('webcam', match.input)).toBe(true)
    for (let frame = 0; frame < 3.2 * 60; frame++) match.tick()
    match.events.length = 0
    match.input.now += 1
    match.input.pulse = { sequence: 1, generation: 1, event: { type: 'PUNCH_LEFT', timestamp: match.input.now, confidence: 0.9 } }
    match.engine.step(match.input, 0)
    expect(match.engine.drainEvents()).toEqual([{ type: 'attack', fighter: 'player', side: 'right' }])
  })

  it('keeps an undrained queue bounded and clears it on reset', () => {
    const match = harness('demo')
    match.engine.drainEvents()
    for (let frame = 0; frame < 90 * 60; frame++) {
      match.input.now += 1000 / 60
      match.engine.step(match.input, 1 / 60)
    }
    const pending = match.engine.drainEvents()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.length).toBeLessThanOrEqual(64)
    match.engine.start('demo', match.input)
    match.engine.reset()
    expect(match.engine.drainEvents()).toEqual([])
  })
})
