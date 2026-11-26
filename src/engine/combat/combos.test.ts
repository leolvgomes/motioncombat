import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { AnimationGestureSignal } from '../../features/robot/animation-signals'
import type { AttackKind, AttackSide } from '../../types/animation'
import type { CombatEvent, CombatInput, CombatRotations } from '../../types/combat'
import { ATTACK_CLIP_CONFIG, createCombatGuardPose, createPunchClipSampler, getPunchDuration, samplePunchClip } from '../animation/combat-clips'
import type { AttackGestureType } from '../gestures/gesture-engine'
import { RIG_JOINTS } from '../motion/rig-controller'
import { CombatAI } from './ai'
import { CombatHitGeometry } from './collision'
import { CombatEngine } from './combat-engine'
import { COMBO_WINDOW_SECONDS, COMBOS, ComboTracker, comboById } from './combos'
import type { ComboHit } from './combos'
import { ATTACK_RULES, COMBAT_RULES } from './config'
import { CombatFighter } from './fighter'

const hit = (kind: AttackKind, side: AttackSide = 'left'): ComboHit => ({ kind, side })
const SWINGS = ['hook', 'uppercut'] as const
const SIDES = ['left', 'right'] as const

describe('ComboTracker', () => {
  it.each(COMBOS.map((combo) => [combo.name, combo] as const))('recognizes %s exactly at its last hit', (_name, combo) => {
    const tracker = new ComboTracker()
    const results = combo.steps.map(({ kind, side }, index) => tracker.land(hit(kind, side === 'alternate' ? index % 2 ? 'right' : 'left' : index % 2 ? 'right' : 'left'))?.id ?? null)
    expect(results.at(-1)).toBe(combo.id)
    expect(tracker.streak).toBe(combo.steps.length)
  })

  it('has unique sequences and grows the bonus with the length', () => {
    expect(new Set(COMBOS.map(({ id }) => id)).size).toBe(COMBOS.length)
    expect(new Set(COMBOS.map(({ steps }) => JSON.stringify(steps))).size).toBe(COMBOS.length)
    const longest = (length: number) => COMBOS.filter(({ steps }) => steps.length === length).map(({ bonus }) => bonus)
    expect(Math.min(...longest(3))).toBeGreaterThan(Math.max(...longest(2)))
    expect(Math.min(...longest(4))).toBeGreaterThan(Math.max(...longest(3)))
    expect(() => comboById('unknown' as never)).toThrow()
  })

  it('requires the opposite fist where the sequence asks for it', () => {
    const tracker = new ComboTracker()
    tracker.land(hit('straight', 'left'))
    expect(tracker.land(hit('straight', 'left'))).toBeNull()
    expect(tracker.streak).toBe(2)
    expect(tracker.land(hit('straight', 'right'))?.id).toBe('one-two')
  })

  it('extends a finished combo but never counts an overlapping repetition', () => {
    const tracker = new ComboTracker()
    const ids = (['left', 'right', 'left', 'right', 'left'] as const).map((side) => tracker.land(hit('straight', side))?.id ?? null)
    expect(ids).toEqual([null, 'one-two', null, 'one-two', null])
    const extended = new ComboTracker()
    expect([hit('straight', 'left'), hit('straight', 'right'), hit('hook', 'left'), hit('uppercut', 'left')].map((value) => extended.land(value)?.id ?? null))
      .toEqual([null, 'one-two', 'triple-hammer', 'full-sync'])
  })

  it('expires on its window, restarts it at each hit and clears on demand', () => {
    const tracker = new ComboTracker()
    tracker.land(hit('straight', 'left'))
    tracker.advance(COMBO_WINDOW_SECONDS - 0.01)
    expect(tracker.streak).toBe(1)
    expect(tracker.land(hit('straight', 'right'))?.id).toBe('one-two')
    tracker.advance(COMBO_WINDOW_SECONDS - 0.01)
    expect(tracker.streak).toBe(2)
    tracker.advance(0.02)
    expect(tracker.streak).toBe(0)
    tracker.land(hit('straight', 'left'))
    tracker.break()
    expect(tracker.land(hit('straight', 'right'))).toBeNull()
    expect(tracker.streak).toBe(1)
  })
})

describe('hook and uppercut clips', () => {
  const fistAt = (side: AttackSide, kind: AttackKind, time: number) => {
    const sample = samplePunchClip(side, time, undefined, kind)
    const rotations = Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...sample.pose[name])])) as CombatRotations
    return new CombatHitGeometry().fist({
      position: [0, 0, 0], yaw: 0, rotations, action: 'attacking', attackSide: side, attackKind: kind,
      attackProgress: 0, hitActive: true, hitFlash: 0, blocking: false, special: false,
    }, side, new Vector3())
  }

  it.each(SWINGS.flatMap((kind) => SIDES.map((side) => [kind, side] as const)))('keeps the %s %s clip valid, bounded and continuous', (kind, side) => {
    const other = side === 'left' ? 'right' : 'left'
    const duration = getPunchDuration(undefined, kind)
    let previous = samplePunchClip(side, 0, undefined, kind)
    expect(Object.values(previous.weights).every((weight) => weight === 0)).toBe(true)
    for (let step = 1; step <= 400; step++) {
      const sample = samplePunchClip(side, step / 400 * duration, undefined, kind)
      for (const name of RIG_JOINTS) {
        expect(Math.hypot(...sample.pose[name])).toBeCloseTo(1, 8)
        // No joint may jump between two adjacent samples of two milliseconds.
        expect(new Quaternion(...sample.pose[name]).angleTo(new Quaternion(...previous.pose[name]))).toBeLessThan(0.2)
      }
      expect(Math.abs((sample.weights[`${side}Shoulder`] ?? 0) - (previous.weights[`${side}Shoulder`] ?? 0))).toBeLessThan(0.06)
      expect(sample.weights[`${other}Shoulder`]).toBeUndefined()
      expect(new Quaternion(...sample.pose[`${side}Elbow`]).angleTo(new Quaternion())).toBeLessThan(150 * Math.PI / 180)
      previous = sample
    }
    expect(Object.values(previous.weights).every((weight) => weight === 0)).toBe(true)
  })

  it.each(SIDES)('sweeps the %s hook inwards and lifts the uppercut', (side) => {
    const sign = side === 'left' ? 1 : -1
    const hookClip = ATTACK_CLIP_CONFIG.hook
    const start = fistAt(side, 'hook', hookClip.timing.windupEnd)
    const end = fistAt(side, 'hook', hookClip.hitWindow.end)
    expect((start.x - end.x) * sign).toBeGreaterThan(0.4)
    const uppercutClip = ATTACK_CLIP_CONFIG.uppercut
    const low = fistAt(side, 'uppercut', uppercutClip.timing.windupEnd)
    const high = fistAt(side, 'uppercut', uppercutClip.hitWindow.end)
    expect(high.y - low.y).toBeGreaterThan(0.6)
  })

  it('keeps the straight clip identical when no kind is given', () => {
    for (const time of [0, 0.1, 0.17, 0.4]) expect(samplePunchClip('left', time, undefined, 'straight')).toEqual(samplePunchClip('left', time))
    expect(createPunchClipSampler('left').duration).toBe(getPunchDuration())
  })

  it.each((['straight', ...SWINGS] as const).flatMap((kind) => SIDES.map((side) => [kind, side] as const)))('makes the %s %s reach a standing opponent at fighting distance and miss a full dodge away', (kind, side) => {
    const contact = (dodge: number) => {
      const attacker = new CombatFighter('player', 1)
      const defender = new CombatFighter('opponent', 2)
      attacker.anchorZ = 0
      defender.anchorZ = COMBAT_RULES.preferredDistance
      defender.dodge = dodge
      defender.compose()
      attacker.beginAttack(side, kind)
      const geometry = new CombatHitGeometry()
      let touched = false
      const { start, end } = ATTACK_CLIP_CONFIG[kind].hitWindow
      for (let time = start; time + 1 / 60 <= end + 1e-9; time += 1 / 60) {
        attacker.fistAt(time, geometry, attacker.sweepFrom)
        attacker.fistAt(time + 1 / 60, geometry, attacker.sweepTo)
        touched ||= geometry.intersects(attacker.sweepFrom, attacker.sweepTo, defender.frame)
      }
      return touched
    }
    expect(contact(0)).toBe(true)
    const away = (side === 'left' ? -1 : 1) * COMBAT_RULES.dodgeDistance
    expect(contact(away)).toBe(false)
  })
})

describe('advanced attacks in a match', () => {
  function match(seed = 0x51ee1) {
    const pose = createCombatGuardPose()
    const input: { -readonly [Key in keyof CombatInput]: CombatInput[Key] } = {
      now: 1000, ready: true, generation: 1, pulse: null, mirrored: false, posture: 'neutral',
      playerBase: Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...pose[name])])) as CombatRotations,
    }
    const engine = new CombatEngine(seed)
    const events: CombatEvent[] = []
    let sequence = 0
    expect(engine.start('webcam', input)).toBe(true)
    const tick = (seconds = 1 / 60) => {
      for (let left = seconds; left > 1e-8; left -= 1 / 60) {
        input.now += 1000 / 60
        engine.step(input, Math.min(left, 1 / 60))
        events.push(...engine.drainEvents())
      }
    }
    const fire = (type: AttackGestureType) => {
      input.now += 1
      input.pulse = { sequence: ++sequence, generation: 1, event: { type, timestamp: input.now, confidence: 0.9 } } satisfies AnimationGestureSignal
      engine.step(input, 0)
      events.push(...engine.drainEvents())
    }
    tick(3)
    for (let frame = 0; frame < 600 && engine.fighters.opponent.action !== 'telegraph'; frame++) tick()
    return { engine, input, events, tick, fire }
  }

  it.each([['HOOK_LEFT', 'hook'], ['UPPERCUT_RIGHT', 'uppercut']] as const)('turns %s into a %s with its own damage', (gesture, kind) => {
    const fight = match()
    fight.fire(gesture)
    expect(fight.engine.fighters.player.action === 'attacking' || fight.events.some((event) => event.type === 'attack' && event.kind === kind)).toBe(true)
    fight.tick(0.4)
    expect(fight.engine.snapshot.lastImpact).toMatchObject({ attacker: 'player', kind, result: 'hit', damage: ATTACK_RULES[kind].damage })
    expect(fight.engine.snapshot.opponentHealth).toBe(100 - ATTACK_RULES[kind].damage)
  })

  it('applies a combo bonus once, reports it and exposes the streak', () => {
    const fight = match()
    fight.fire('PUNCH_LEFT')
    fight.tick(0.57)
    expect(fight.engine.snapshot.playerStreak).toBe(1)
    fight.fire('UPPERCUT_RIGHT')
    fight.tick(0.4)
    const { snapshot } = fight.engine
    expect(snapshot.lastImpact?.result).toBe('hit')
    expect(snapshot.lastImpact?.damage).toBe(ATTACK_RULES.uppercut.damage + comboById('ascension').bonus)
    expect(snapshot.playerStats).toMatchObject({ hits: 2, combos: 1, bestStreak: 2 })
    expect(snapshot.opponentHealth).toBe(100 - snapshot.playerStats.damage)
    const combos = fight.events.filter((event) => event.type === 'combo')
    expect(combos).toEqual([{ type: 'combo', combo: { id: 1, fighter: 'player', combo: 'ascension', bonus: comboById('ascension').bonus } }])
    const finisher = fight.events.findIndex((event) => event.type === 'impact' && event.impact.kind === 'uppercut')
    expect(fight.events.indexOf(combos[0]!)).toBeGreaterThan(finisher)
    fight.tick(COMBO_WINDOW_SECONDS + 0.1)
    expect(fight.engine.snapshot.playerStreak).toBe(0)
  })

  it('breaks the streak on pause', () => {
    const fight = match()
    fight.fire('PUNCH_LEFT')
    fight.tick(0.3)
    expect(fight.engine.snapshot.playerStreak).toBe(1)
    fight.engine.pause('manual')
    expect(fight.engine.snapshot.playerStreak).toBe(0)
  })

  it('lets the AI use every attack, always announcing the same kind first', () => {
    const engine = new CombatEngine(4242)
    const fight = match(4242)
    const kinds = new Set<AttackKind>()
    engine.start('demo', fight.input)
    const prepared: Record<string, AttackKind | null> = { player: null, opponent: null }
    for (let frame = 0; frame < 120 * 60; frame++) {
      fight.input.now += 1000 / 60
      engine.step(fight.input, 1 / 60)
      for (const event of engine.drainEvents()) {
        if (event.type === 'telegraph') prepared[event.fighter] = event.kind
        if (event.type === 'attack') {
          expect(prepared[event.fighter]).toBe(event.kind)
          kinds.add(event.kind)
        }
      }
    }
    expect([...kinds].sort()).toEqual(['hook', 'straight', 'uppercut'])
  })

  it('makes the AI cover up after repeated contacts, not after a single one', () => {
    let guards = 0
    for (let seed = 1; seed <= 40; seed++) {
      const ai = new CombatAI(seed * 7919)
      ai.react(true)
      expect(ai.step(1.37, false, 0.01).action).toBe('idle')
      ai.react(true)
      if (ai.step(1.37, false, 0.01).blocking) guards++
    }
    expect(guards).toBeGreaterThan(15)
    expect(guards).toBeLessThan(40)
  })
})
