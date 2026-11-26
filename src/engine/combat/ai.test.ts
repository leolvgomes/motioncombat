import { describe, expect, it } from 'vitest'
import { CombatAI } from './ai'
import type { AIDecision } from './ai'
import { COMBAT_RULES } from './config'
import { BALANCED_STYLE, DIFFICULTIES, MIN_WIND_UP, OPPONENTS, OPPONENT_IDS, TRAINING_STYLE, applyDifficulty, opponentProfile, sanitizeDifficulty, sanitizeOpponent } from './opponents'
import type { AIStyle } from './opponents'

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

function trace(seed: number, style: AIStyle = BALANCED_STYLE): AIDecision[] {
  const ai = new CombatAI(seed, style)
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

describe('opponent styles and difficulty', () => {
  const attacks = (style: AIStyle) => trace(SEED, style).filter((decision) => decision.attack)

  it('gives each opponent its own rhythm and attack mix', () => {
    const counts = Object.fromEntries(OPPONENT_IDS.map((id) => [id, attacks(OPPONENTS[id].ai).length]))
    expect(counts.magna).toBeGreaterThan(counts.basalt!)
    const kinds = (id: keyof typeof OPPONENTS) => attacks(OPPONENTS[id].ai).map(({ attackKind }) => attackKind)
    const share = (list: string[], kind: string) => list.filter((value) => value === kind).length / list.length
    expect(share(kinds('kestrel'), 'straight')).toBeGreaterThan(share(kinds('basalt'), 'straight'))
    const guarding = (id: keyof typeof OPPONENTS) => trace(SEED, OPPONENTS[id].ai).filter(({ action }) => action === 'guard').length
    expect(guarding('basalt')).toBeGreaterThan(guarding('magna'))
  })

  it('stretches wind-ups on easy, shortens them on hard and never below the readable floor', () => {
    const easy = applyDifficulty(BALANCED_STYLE, 'easy')
    const hard = applyDifficulty(BALANCED_STYLE, 'hard')
    expect(applyDifficulty(BALANCED_STYLE, 'normal')).toBe(BALANCED_STYLE)
    expect(easy.windUp).toBeGreaterThan(BALANCED_STYLE.windUp)
    expect(hard.windUp).toBeLessThan(BALANCED_STYLE.windUp)
    for (const id of OPPONENT_IDS) for (const difficulty of DIFFICULTIES) {
      const style = applyDifficulty(OPPONENTS[id].ai, difficulty)
      expect(style.windUp).toBeGreaterThanOrEqual(MIN_WIND_UP)
      expect(style.followUpWindUp).toBeGreaterThanOrEqual(MIN_WIND_UP)
    }
    expect(attacks(easy).length).toBeLessThan(attacks(hard).length)
  })

  it('keeps a training dummy idle until asked, then winds up the requested attack', () => {
    const ai = new CombatAI(SEED, TRAINING_STYLE)
    for (let frame = 0; frame < 600; frame++) expect(ai.step(CLOSE, false, 1 / 60).attack).toBeNull()
    expect(ai.request('uppercut', 'right', CLOSE + 1)).toBe(false)
    expect(ai.request('uppercut', 'right', CLOSE)).toBe(true)
    expect(ai.request('straight', 'left', CLOSE)).toBe(false)
    let elapsed = 0
    let decision = ai.step(CLOSE, false, 0)
    while (!decision.attack && elapsed < 3) { elapsed += 0.01; decision = ai.step(CLOSE, false, 0.01) }
    expect(decision).toMatchObject({ attack: 'right', attackKind: 'uppercut' })
    expect(elapsed).toBeGreaterThanOrEqual(TRAINING_STYLE.windUp)
    ai.react(true)
    for (let frame = 0; frame < 600; frame++) expect(ai.step(CLOSE, false, 1 / 60)).toMatchObject({ attack: null, blocking: false })
  })

  it('reads unknown stored values as the defaults', () => {
    expect(sanitizeOpponent('magna')).toBe('magna')
    expect(sanitizeOpponent('nope')).toBe('vulcan')
    expect(sanitizeDifficulty('hard')).toBe('hard')
    expect(sanitizeDifficulty(3)).toBe('normal')
    expect(opponentProfile('basalt').name).toBe('BASALTO-9')
  })
})
