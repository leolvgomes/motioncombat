import { create } from 'zustand'
import { DEFAULT_ARENA, DEFAULT_LOOK, DEFAULT_NAME, cleanName, sanitizeArena, sanitizeLook, sanitizeName } from '../features/customization/catalog'
import type { ArenaId, RobotLook } from '../types/customization'
import { DEFAULT_OPPONENT, sanitizeDifficulty, sanitizeOpponent } from '../engine/combat/opponents'
import type { Difficulty, OpponentId } from '../engine/combat/opponents'

export interface ProfileSettings {
  name: string
  look: RobotLook
  arena: ArenaId
  /** Recognition of hooks and uppercuts. Straight punches always work. */
  advancedAttacks: boolean
  /** Opponent and difficulty of the next quick fight. */
  opponent: OpponentId
  difficulty: Difficulty
}

interface ProfileStore extends ProfileSettings {
  setName: (name: string) => void
  setLook: (look: Partial<RobotLook>) => void
  setArena: (arena: ArenaId) => void
  setAdvancedAttacks: (enabled: boolean) => void
  setOpponent: (opponent: OpponentId) => void
  setDifficulty: (difficulty: Difficulty) => void
  restoreRobot: () => void
}

export const PROFILE_STORAGE_KEY = 'steel-sync:profile:v1'
export const DEFAULT_PROFILE: Readonly<ProfileSettings> = Object.freeze({
  name: DEFAULT_NAME, look: DEFAULT_LOOK, arena: DEFAULT_ARENA, advancedAttacks: true, opponent: DEFAULT_OPPONENT, difficulty: 'normal',
})

export function parseProfile(raw: string | null): ProfileSettings {
  let value: unknown = null
  try { value = raw ? JSON.parse(raw) : null } catch { value = null }
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    name: sanitizeName(stored.name), look: sanitizeLook(stored.look), arena: sanitizeArena(stored.arena),
    advancedAttacks: typeof stored.advancedAttacks === 'boolean' ? stored.advancedAttacks : DEFAULT_PROFILE.advancedAttacks,
    opponent: sanitizeOpponent(stored.opponent), difficulty: sanitizeDifficulty(stored.difficulty),
  }
}

function load(): ProfileSettings {
  try { return parseProfile(globalThis.localStorage?.getItem(PROFILE_STORAGE_KEY) ?? null) } catch { return { ...DEFAULT_PROFILE } }
}

function save(profile: ProfileSettings): void {
  try { globalThis.localStorage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)) } catch { /* session-only */ }
}

/** The player's identity and preferences. None of them changes match rules. */
export const useProfileStore = create<ProfileStore>((set, get) => {
  const update = (patch: Partial<ProfileSettings>) => {
    set(patch)
    const { name, look, arena, advancedAttacks, opponent, difficulty } = get()
    save({ name: sanitizeName(name), look, arena, advancedAttacks, opponent, difficulty })
  }
  return {
    ...load(),
    // The field may be empty while typing; every reader goes through sanitizeName.
    setName: (name) => update({ name: cleanName(name) }),
    setLook: (look) => update({ look: sanitizeLook({ ...get().look, ...look }) }),
    setArena: (arena) => update({ arena: sanitizeArena(arena) }),
    setAdvancedAttacks: (advancedAttacks) => update({ advancedAttacks }),
    setOpponent: (opponent) => update({ opponent: sanitizeOpponent(opponent) }),
    setDifficulty: (difficulty) => update({ difficulty: sanitizeDifficulty(difficulty) }),
    restoreRobot: () => update({ look: DEFAULT_LOOK, name: DEFAULT_NAME }),
  }
})

export function useRobotName(): string { return useProfileStore((state) => sanitizeName(state.name)) }
