import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARENAS, ARMORS, HEADS, LIGHTS, SHOULDERS, DEFAULT_LOOK, DEFAULT_NAME, cleanName, sanitizeArena, sanitizeName } from '../../features/customization/catalog'
import { ARENA_THEMES } from '../../features/arena/arena-themes'
import { applyRobotLook, createRobotResources } from '../../features/robot/robot-resources'
import { CAREER_STORAGE_KEY, useCareerStore } from '../../stores/career-store'
import { READY_MATCH } from '../../stores/match-store'
import { DEFAULT_PROFILE, PROFILE_STORAGE_KEY, parseProfile, useProfileStore } from '../../stores/profile-store'
import type { CombatSnapshot, FighterStats, MatchWinner } from '../../types/combat'
import { MAX_RECORDS, addRecord, createRecord, matchScore, parseRecords, rankRecords, summarize } from './career'
import type { MatchRecord } from './career'

const stats = (overrides: Partial<FighterStats> = {}): FighterStats => ({ attacks: 20, hits: 10, blocks: 3, dodges: 2, damage: 120, combos: 2, bestStreak: 3, ...overrides })
const finished = (overrides: Partial<CombatSnapshot> = {}): CombatSnapshot => ({
  ...READY_MATCH, phase: 'finished', winner: 'player', round: 2, playerWins: 2, opponentWins: 0, playerStats: stats(), opponentStats: stats({ damage: 40 }), ...overrides,
})
const record = (id: string, playedAt: number, winner: MatchWinner = 'player', score = 100): MatchRecord => ({
  id, playedAt, name: 'ATLAS-01', arena: 'foundry', winner, rounds: 2, playerWins: 2, opponentWins: 0, player: stats(), opponent: stats({ damage: 40 }), score,
})
const sanitize = { name: sanitizeName, arena: sanitizeArena }

describe('career records', () => {
  it('records only finished webcam matches', () => {
    const context = { id: 'a', playedAt: 5, name: 'ATLAS-01', arena: 'foundry' as const }
    expect(createRecord(finished(), context)).toMatchObject({ id: 'a', winner: 'player', rounds: 2, score: matchScore(finished()) })
    expect(createRecord(finished({ mode: 'demo' }), context)).toBeNull()
    expect(createRecord(finished({ phase: 'fighting' }), context)).toBeNull()
    expect(createRecord(finished({ winner: null }), context)).toBeNull()
  })

  it('scores wins above equal losses, rewards skill and never goes negative', () => {
    const win = matchScore(finished())
    expect(win).toBeGreaterThan(matchScore(finished({ winner: 'draw', playerWins: 1 })))
    expect(matchScore(finished({ winner: 'draw', playerWins: 1 }))).toBeGreaterThan(matchScore(finished({ winner: 'opponent', playerWins: 0 })))
    expect(matchScore(finished({ playerStats: stats({ combos: 3 }) }))).toBeGreaterThan(win)
    expect(matchScore(finished({ opponentStats: stats({ damage: 90 }) }))).toBeLessThan(win)
    expect(matchScore(finished({ winner: 'opponent', playerWins: 0, playerStats: stats({ attacks: 0, hits: 0, blocks: 0, dodges: 0, damage: 0, combos: 0, bestStreak: 0 }), opponentStats: stats({ damage: 200 }) }))).toBe(0)
  })

  it('keeps newest first, replaces duplicates, bounds the history and ranks with stable ties', () => {
    let records: MatchRecord[] = []
    for (let index = 0; index < MAX_RECORDS + 5; index++) records = addRecord(records, record(`m${index}`, index, 'player', index % 7))
    expect(records).toHaveLength(MAX_RECORDS)
    expect(records[0]?.id).toBe(`m${MAX_RECORDS + 4}`)
    expect(addRecord(records, record(records[0]!.id, 9999))).toHaveLength(MAX_RECORDS)
    const ranked = rankRecords([record('late', 9, 'player', 50), record('early', 1, 'player', 50), record('top', 5, 'player', 80)], 2)
    expect(ranked.map(({ id }) => id)).toEqual(['top', 'early'])
  })

  it('summarizes totals, accuracy and win streaks regardless of input order', () => {
    const outcomes: MatchWinner[] = ['player', 'player', 'opponent', 'draw', 'player', 'player', 'player']
    const records = outcomes.map((winner, index) => record(`m${index}`, index, winner, index)).reverse()
    expect(summarize(records)).toMatchObject({
      matches: 7, wins: 5, losses: 1, draws: 1, currentWinStreak: 3, bestWinStreak: 3, hits: 70, attacks: 140, accuracy: 0.5,
      combos: 14, bestStreak: 3, damageDealt: 840, damageTaken: 280, bestScore: 6,
    })
    expect(summarize([])).toMatchObject({ matches: 0, winRate: 0, accuracy: 0, currentWinStreak: 0 })
  })

  it('drops malformed stored entries one by one', () => {
    const good = record('good', 10)
    const raw = JSON.stringify([good, { ...good }, null, 7, { ...good, id: '' }, { ...good, id: 'x', winner: 'me' },
      { ...good, id: 'y', player: { ...good.player, hits: -1 } }, { ...good, id: 'z', playedAt: 1e20 }, { ...good, id: 'w', name: '<i>', arena: 'moon' }])
    expect(parseRecords(raw, sanitize)).toEqual([good, { ...good, id: 'w', name: 'I', arena: 'foundry' }])
    for (const invalid of [null, 'nope', '{}', '3']) expect(parseRecords(invalid, sanitize)).toEqual([])
  })
})

describe('career and profile stores', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useCareerStore.setState({ records: [], persistent: true })
    useProfileStore.setState({ ...DEFAULT_PROFILE })
  })

  it('persists the history and reports when the browser refuses', () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
    useCareerStore.getState().add(record('a', 1))
    expect(parseRecords(stored.get(CAREER_STORAGE_KEY) ?? null, sanitize)).toHaveLength(1)
    expect(useCareerStore.getState().persistent).toBe(true)
    useCareerStore.getState().clear()
    expect(parseRecords(stored.get(CAREER_STORAGE_KEY) ?? null, sanitize)).toEqual([])
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('blocked') } })
    useCareerStore.getState().add(record('b', 2))
    expect(useCareerStore.getState()).toMatchObject({ persistent: false })
    expect(useCareerStore.getState().records).toHaveLength(1)
  })

  it('cleans names, falls back when empty and never stores an empty one', () => {
    expect(cleanName('  aço-09!!<x> ')).toBe('AÇO-09X ')
    expect(cleanName('abcdefghijklmnop')).toHaveLength(12)
    expect(cleanName(42)).toBe('')
    expect(sanitizeName('   ')).toBe(DEFAULT_NAME)
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (key: string, value: string) => stored.set(key, value) })
    useProfileStore.getState().setName('')
    expect(useProfileStore.getState().name).toBe('')
    expect(parseProfile(stored.get(PROFILE_STORAGE_KEY) ?? null).name).toBe(DEFAULT_NAME)
    useProfileStore.getState().setName('trovão')
    useProfileStore.getState().setLook({ armor: 'crimson' })
    useProfileStore.getState().setArena('canyon')
    useProfileStore.getState().setAdvancedAttacks(false)
    expect(parseProfile(stored.get(PROFILE_STORAGE_KEY) ?? null)).toEqual({
      name: 'TROVÃO', look: { ...DEFAULT_LOOK, armor: 'crimson' }, arena: 'canyon', advancedAttacks: false,
    })
    useProfileStore.getState().restoreRobot()
    expect(useProfileStore.getState()).toMatchObject({ name: DEFAULT_NAME, look: DEFAULT_LOOK, arena: 'canyon' })
  })

  it('accepts only known stored options', () => {
    expect(parseProfile('broken')).toEqual(DEFAULT_PROFILE)
    expect(parseProfile(JSON.stringify({ name: 5, look: { armor: 'gold', light: 'lime' }, arena: [], advancedAttacks: 'yes' })))
      .toEqual({ ...DEFAULT_PROFILE, look: { ...DEFAULT_LOOK, light: 'lime' } })
  })
})

describe('visual catalog', () => {
  it('has unique options and a theme for every arena', () => {
    for (const options of [ARMORS, LIGHTS, HEADS, SHOULDERS, ARENAS]) expect(new Set(options.map(({ id }) => id)).size).toBe(options.length)
    expect(Object.keys(ARENA_THEMES).sort()).toEqual(ARENAS.map(({ id }) => id).sort())
  })

  it('recolours existing materials without touching geometry', () => {
    const resources = createRobotResources()
    const geometries = { ...resources.geometries }
    const { silver, cyan } = resources.materials
    applyRobotLook(resources, { armor: 'crimson', light: 'lime', head: 'visor', shoulders: 'standard' })
    expect(`#${silver.color.getHexString()}`).toBe(ARMORS.find(({ id }) => id === 'crimson')!.plate)
    expect(`#${cyan.emissive.getHexString()}`).toBe(LIGHTS.find(({ id }) => id === 'lime')!.emissive)
    expect(resources.materials.silver).toBe(silver)
    expect(resources.geometries).toEqual(geometries)
    resources.dispose()
  })

  it('renders the default look exactly as the original player robot', () => {
    const original = createRobotResources()
    const recoloured = createRobotResources()
    applyRobotLook(recoloured, DEFAULT_LOOK)
    for (const name of ['silver', 'slate', 'cyan'] as const) expect(recoloured.materials[name].color.getHex()).toBe(original.materials[name].color.getHex())
    expect(recoloured.materials.cyan.emissive.getHex()).toBe(original.materials.cyan.emissive.getHex())
    original.dispose()
    recoloured.dispose()
  })
})
