import { describe, expect, it } from 'vitest'
import { CombatAI } from './ai'
import type { AIDecision } from './ai'
import { COMBAT_RULES } from './config'

const CLOSE = COMBAT_RULES.preferredDistance
const SEED = 0x12345678

function telegraph(ai: CombatAI): AIDecision {
  for (let step = 0; step < 1000; step++) {
    const decision = ai.step(CLOSE, false, 0.01)
    if (decision.action === 'telegraph') return { ...decision }
  }
  throw new Error('The seeded planner did not prepare an attack within ten seconds.')
}

function attack(ai: CombatAI): AIDecision {
  for (let step = 0; step < 1000; step++) {
    const decision = ai.step(CLOSE, false, 0.01)
    if (decision.attack) return { ...decision }
  }
  throw new Error('The seeded planner did not attack within ten seconds.')
}

function trace(seed: number): AIDecision[] {
  const ai = new CombatAI(seed)
  const decisions: AIDecision[] = []
  const dt = 1 / 60
  let attackingFor = 0
  let distance = CLOSE + 0.3
  for (let frame = 0; frame < 1800; frame++) {
    const decision = { ...ai.step(distance, attackingFor > 0, dt) }
    decisions.push(decision)
    attackingFor = Math.max(0, attackingFor - dt)
    if (decision.attack) attackingFor = 0.72
    distance = Math.max(CLOSE - 0.1, distance - decision.movement * dt * 0.65)
  }
  return decisions
}

describe('CombatAI', () => {
  it('replays the same seeded decisions and varies the plan for a different seed', () => {
    const first = trace(SEED)
    expect(trace(SEED)).toEqual(first)
    expect(trace(SEED + 1)).not.toEqual(first)
    const actions = new Set(first.map((decision) => decision.action))
    for (const action of ['approaching', 'telegraph', 'attacking', 'guard', 'retreating']) expect(actions.has(action as AIDecision['action'])).toBe(true)
  })

  it('approaches a distant opponent, then stops translating when in range', () => {
    const ai = new CombatAI(SEED)
    expect(ai.step(CLOSE + 1, false, 0.3)).toMatchObject({ action: 'approaching', movement: 1, blocking: false, attack: null })
    expect(ai.step(CLOSE + 0.2, false, 0.1)).toMatchObject({ action: 'approaching', movement: 1, attack: null })
    expect(ai.step(CLOSE, false, 0.01)).toMatchObject({ action: 'idle', movement: 0, attack: null })
  })

  it('holds a readable telegraph for at least half a second before the matching attack pulse', () => {
    const ai = new CombatAI(SEED)
    const prepared = telegraph(ai)
    expect(prepared.telegraphSide).not.toBeNull()
    let elapsed = 0
    let emitted: AIDecision | null = null
    while (elapsed < 1) {
      elapsed += 0.01
      const decision = { ...ai.step(CLOSE, false, 0.01) }
      if (elapsed < 0.5) expect(decision).toMatchObject({ action: 'telegraph', attack: null, telegraphSide: prepared.telegraphSide })
      if (decision.attack) { emitted = decision; break }
    }
    expect(elapsed).toBeGreaterThanOrEqual(0.55)
    expect(emitted).toMatchObject({ action: 'attacking', attack: prepared.telegraphSide, telegraphSide: null })
  })

  it('emits once per attack and retreats only after its active clip has finished', () => {
    const ai = new CombatAI(SEED)
    const initiated = attack(ai)
    expect(initiated.attack).not.toBeNull()
    for (let frame = 0; frame < 30; frame++) {
      expect(ai.step(CLOSE, true, 1 / 60)).toMatchObject({ action: 'attacking', attack: null, movement: 0, blocking: false })
    }
    expect(ai.step(CLOSE, false, 1 / 60)).toMatchObject({ action: 'retreating', movement: -1, attack: null, blocking: false })
    expect(ai.step(CLOSE, false, 0.1)).toMatchObject({ action: 'retreating', movement: -1, attack: null })
  })

  it('uses a sustained guard with no movement or concealed attack pulse', () => {
    const ai = new CombatAI(1)
    expect(ai.step(CLOSE, false, 0.3)).toMatchObject({ action: 'guard', blocking: true, movement: 0, attack: null, telegraphSide: null })
    for (let frame = 0; frame < 24; frame++) {
      expect(ai.step(CLOSE, false, 1 / 60)).toMatchObject({ action: 'guard', blocking: true, attack: null })
    }
    expect(ai.step(CLOSE, false, 0.5)).toMatchObject({ action: 'idle', blocking: false, movement: 0, attack: null })
  })

  it('reacts to stun by canceling a nearly completed preparation rather than releasing the old attack', () => {
    const ai = new CombatAI(SEED)
    telegraph(ai)
    for (let frame = 0; frame < 49; frame++) expect(ai.step(CLOSE, false, 0.01).attack).toBeNull()
    ai.react()
    for (let frame = 0; frame < 29; frame++) {
      expect(ai.step(CLOSE, false, 0.01)).toMatchObject({ action: 'idle', attack: null, blocking: false, telegraphSide: null })
    }
  })

  it('reacts immediately from either guard or an active attack planner', () => {
    const guarding = new CombatAI(1)
    guarding.step(CLOSE, false, 0.3)
    guarding.react()
    expect(guarding.step(CLOSE, false, 0.01)).toMatchObject({ action: 'idle', blocking: false, attack: null })
    const attacking = new CombatAI(SEED)
    attack(attacking)
    attacking.react()
    expect(attacking.step(CLOSE, true, 0.01)).toMatchObject({ action: 'idle', movement: 0, attack: null })
  })
})
