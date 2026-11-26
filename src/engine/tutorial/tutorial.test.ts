import { describe, expect, it } from 'vitest'
import type { CombatEvent, ImpactEvent } from '../../types/combat'
import { DRILL_INTERVAL_SECONDS, GUARD_HOLD_SECONDS, GuidedTraining, STEP_CELEBRATION_SECONDS, STEP_TIMEOUT_SECONDS } from './tutorial'

const attack = (kind: 'straight' | 'hook' | 'uppercut', side: 'left' | 'right' = 'left'): CombatEvent => ({ type: 'attack', fighter: 'player', side, kind })
const impact = (attacker: 'player' | 'opponent', result: ImpactEvent['result']): CombatEvent => ({
  type: 'impact', impact: { id: 1, attacker, kind: 'straight', result, damage: 0 }, position: [0, 0, 0], defenderHealth: 100,
})

function celebrate(training: GuidedTraining) { training.step(STEP_CELEBRATION_SECONDS + 0.01, false) }

describe('GuidedTraining', () => {
  it('walks through every step with the real events each one needs', () => {
    const training = new GuidedTraining(true)
    expect(training.view).toMatchObject({ index: 0, total: 8, count: 0, finished: false })
    training.step(GUARD_HOLD_SECONDS / 2, true)
    training.step(0.1, false)
    training.step(GUARD_HOLD_SECONDS * 0.9, true)
    expect(training.current?.id).toBe('guard')
    training.step(0.2, true)
    expect(training.view.completed).toBe(true)
    celebrate(training)

    training.observe(attack('straight', 'left'))
    training.observe(attack('straight', 'left'))
    expect(training.view.count).toBe(1)
    training.observe(attack('straight', 'right'))
    celebrate(training)

    training.observe(attack('straight'))
    expect(training.view.note).toContain('soco reto')
    training.observe(attack('hook'))
    celebrate(training)
    training.observe(attack('uppercut'))
    celebrate(training)

    expect(training.current?.id).toBe('block')
    expect(training.wantsAttack).toBeNull()
    training.step(DRILL_INTERVAL_SECONDS, false)
    expect(training.wantsAttack).toEqual({ kind: 'straight', side: 'left' })
    training.drillStarted()
    expect(training.wantsAttack).toBeNull()
    training.observe(impact('opponent', 'hit'))
    expect(training.view.note).toContain('guarda')
    training.step(DRILL_INTERVAL_SECONDS, false)
    expect(training.wantsAttack?.side).toBe('right')
    training.drillStarted()
    training.observe(impact('opponent', 'blocked'))
    training.observe(impact('opponent', 'blocked'))
    celebrate(training)

    training.observe(impact('opponent', 'dodged'))
    celebrate(training)

    training.observe({ type: 'combo', combo: { id: 1, fighter: 'opponent', combo: 'one-two', bonus: 3 } })
    expect(training.current?.id).toBe('combo')
    training.observe({ type: 'combo', combo: { id: 2, fighter: 'player', combo: 'one-two', bonus: 3 } })
    celebrate(training)

    expect(training.wantsOverdrive).toBe(true)
    training.observe({ type: 'special', fighter: 'player', side: 'left' })
    expect(training.wantsOverdrive).toBe(false)
    celebrate(training)
    expect(training.finished).toBe(true)
    expect(training.view).toMatchObject({ finished: true, skipped: [] })
  })

  it('leaves out hook and uppercut when they are switched off', () => {
    const training = new GuidedTraining(false)
    expect(training.steps.map(({ id }) => id)).toEqual(['guard', 'straights', 'block', 'dodge', 'combo', 'special'])
  })

  it('skips a step that is not recognised in time, or on request', () => {
    const training = new GuidedTraining(true)
    training.step(STEP_TIMEOUT_SECONDS - 1, false)
    expect(training.current?.id).toBe('guard')
    training.step(1.01, false)
    expect(training.current?.id).toBe('straights')
    expect(training.view.note).toContain('Guarda pulado')
    training.skip()
    expect(training.view.skipped).toEqual(['guard', 'straights'])
  })

  it('progress restarts the skip timer', () => {
    const training = new GuidedTraining(true)
    training.skip()
    training.step(STEP_TIMEOUT_SECONDS - 5, false)
    training.observe(attack('straight', 'left'))
    training.step(10, false)
    expect(training.current?.id).toBe('straights')
  })

  it('does not stall when a drill attack is cancelled before contact', () => {
    const training = new GuidedTraining(false)
    for (let index = 0; index < 2; index++) training.skip()
    training.step(DRILL_INTERVAL_SECONDS, false)
    training.drillStarted()
    training.step(3.1, false)
    training.step(DRILL_INTERVAL_SECONDS, false)
    expect(training.wantsAttack).not.toBeNull()
  })
})
