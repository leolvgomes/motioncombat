import { create } from 'zustand'

export interface FeedbackSettings {
  soundEnabled: boolean
  /** Master volume, 0–1. */
  volume: number
  effectsEnabled: boolean
  shakeEnabled: boolean
}

interface SettingsStore extends FeedbackSettings {
  setSoundEnabled: (enabled: boolean) => void
  setVolume: (volume: number) => void
  setEffectsEnabled: (enabled: boolean) => void
  setShakeEnabled: (enabled: boolean) => void
}

export const SETTINGS_STORAGE_KEY = 'steel-sync:feedback:v1'
export const DEFAULT_FEEDBACK: Readonly<FeedbackSettings> = Object.freeze({
  soundEnabled: true, volume: 0.7, effectsEnabled: true, shakeEnabled: true,
})

function clampVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_FEEDBACK.volume
}

/** Only accepts known, well-typed fields; anything else falls back to defaults. */
export function parseFeedbackSettings(raw: string | null): FeedbackSettings {
  let value: unknown = null
  try { value = raw ? JSON.parse(raw) : null } catch { value = null }
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const flag = (key: 'soundEnabled' | 'effectsEnabled' | 'shakeEnabled') =>
    typeof stored[key] === 'boolean' ? stored[key] as boolean : DEFAULT_FEEDBACK[key]
  return {
    soundEnabled: flag('soundEnabled'),
    volume: 'volume' in stored ? clampVolume(stored.volume) : DEFAULT_FEEDBACK.volume,
    effectsEnabled: flag('effectsEnabled'),
    shakeEnabled: flag('shakeEnabled'),
  }
}

// Storage can be missing or throw (private windows, blocked site data); preferences then last only this session.
function load(): FeedbackSettings {
  try { return parseFeedbackSettings(globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY) ?? null) } catch { return { ...DEFAULT_FEEDBACK } }
}

function save(settings: FeedbackSettings): void {
  try { globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)) } catch { /* session-only */ }
}

/** Presentation preferences only. They never change match rules or tracking. */
export const useSettingsStore = create<SettingsStore>((set, get) => {
  const update = (patch: Partial<FeedbackSettings>) => {
    set(patch)
    const { soundEnabled, volume, effectsEnabled, shakeEnabled } = get()
    save({ soundEnabled, volume, effectsEnabled, shakeEnabled })
  }
  return {
    ...load(),
    setSoundEnabled: (soundEnabled) => update({ soundEnabled }),
    setVolume: (volume) => update({ volume: clampVolume(volume) }),
    setEffectsEnabled: (effectsEnabled) => update({ effectsEnabled }),
    setShakeEnabled: (shakeEnabled) => update({ shakeEnabled }),
  }
})
