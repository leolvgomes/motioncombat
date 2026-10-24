import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEEDBACK, SETTINGS_STORAGE_KEY, parseFeedbackSettings, useSettingsStore } from '../../stores/settings-store'
import { announcementForEvent } from './announcements'
import { QualityAdvisor } from './quality-advisor'

describe('match announcements', () => {
  it('narrates the start once, each round and every contact with remaining integrity', () => {
    expect(announcementForEvent({ type: 'countdown', round: 1, value: 3 })).toBe('Round 1. Começa em 3 segundos.')
    expect(announcementForEvent({ type: 'countdown', round: 1, value: 2 })).toBeNull()
    expect(announcementForEvent({ type: 'fight', round: 2 })).toBe('Round 2. Lutem!')
    const impact = (result: 'hit' | 'blocked' | 'dodged' | 'miss') => announcementForEvent({
      type: 'impact', impact: { id: 1, attacker: 'opponent', result, damage: 12 }, position: [0, 0, 0], defenderHealth: 63.2,
    })
    expect(impact('hit')).toBe('ATLAS-01 atingido. Integridade 64.')
    expect(impact('blocked')).toBe('ATLAS-01 bloqueou. Integridade 64.')
    expect(impact('dodged')).toBe('ATLAS-01 esquivou.')
    expect(impact('miss')).toBeNull()
    expect(announcementForEvent({ type: 'attack', fighter: 'player', side: 'left' })).toBeNull()
    expect(announcementForEvent({ type: 'telegraph', fighter: 'opponent', side: 'left' })).toBeNull()
  })

  it('explains how each round and the match ended', () => {
    expect(announcementForEvent({ type: 'round-end', round: 1, winner: 'player', knockout: true })).toBe('Nocaute! ATLAS-01 vence o round 1.')
    expect(announcementForEvent({ type: 'round-end', round: 2, winner: 'opponent', knockout: false })).toBe('Tempo esgotado. VULCAN-07 vence o round 2.')
    expect(announcementForEvent({ type: 'round-end', round: 3, winner: 'draw', knockout: false })).toBe('Round 3 empatado.')
    expect(announcementForEvent({ type: 'match-end', winner: 'opponent', mode: 'webcam' })).toBe('Fim de partida. VULCAN-07 venceu.')
    expect(announcementForEvent({ type: 'match-end', winner: 'draw', mode: 'demo' })).toBe('Partida empatada.')
  })
})

describe('QualityAdvisor', () => {
  it('recommends the light preset only after a sustained low median on balanced quality', () => {
    const advisor = new QualityAdvisor(42, 6)
    const feed = (values: number[]) => values.map((fps) => advisor.observe(fps, 'balanced')).at(-1)
    expect(feed([30, 30, 30, 30, 30])).toBe(false)
    expect(feed([30])).toBe(true)
    advisor.reset()
    expect(feed([30, 60, 30, 60, 60, 60])).toBe(false)
    expect(feed([30, 30, 30, 30])).toBe(true)
  })

  it('never recommends on light quality and restarts after missing measurements', () => {
    const advisor = new QualityAdvisor(42, 3)
    expect([20, 20, 20].map((fps) => advisor.observe(fps, 'light'))).toEqual([false, false, false])
    advisor.observe(20, 'balanced')
    advisor.observe(20, 'balanced')
    expect(advisor.observe(null, 'balanced')).toBe(false)
    expect(advisor.observe(20, 'balanced')).toBe(false)
    expect(advisor.observe(Number.NaN, 'balanced')).toBe(false)
  })
})

describe('feedback settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useSettingsStore.setState({ ...DEFAULT_FEEDBACK })
  })

  it('accepts only well-typed stored values', () => {
    expect(parseFeedbackSettings(null)).toEqual(DEFAULT_FEEDBACK)
    expect(parseFeedbackSettings('not json')).toEqual(DEFAULT_FEEDBACK)
    expect(parseFeedbackSettings('[1,2]')).toEqual(DEFAULT_FEEDBACK)
    expect(parseFeedbackSettings(JSON.stringify({ soundEnabled: false, volume: 3, effectsEnabled: 'no', shakeEnabled: false })))
      .toEqual({ soundEnabled: false, volume: 1, effectsEnabled: true, shakeEnabled: false })
    expect(parseFeedbackSettings(JSON.stringify({ volume: 'loud' })).volume).toBe(DEFAULT_FEEDBACK.volume)
  })

  it('persists changes and keeps working when storage throws', () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
    useSettingsStore.getState().setVolume(0.35)
    useSettingsStore.getState().setShakeEnabled(false)
    expect(parseFeedbackSettings(stored.get(SETTINGS_STORAGE_KEY) ?? null)).toMatchObject({ volume: 0.35, shakeEnabled: false })

    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => useSettingsStore.getState().setSoundEnabled(false)).not.toThrow()
    expect(useSettingsStore.getState().soundEnabled).toBe(false)
    useSettingsStore.getState().setVolume(Number.NaN)
    expect(useSettingsStore.getState().volume).toBe(DEFAULT_FEEDBACK.volume)
  })
})
