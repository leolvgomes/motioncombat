import { create } from 'zustand'
import { decodeReplay, encodeReplay } from '../engine/replay/replay'
import type { Replay, ReplayMeta, ReplaySpeed } from '../engine/replay/replay'
import { sanitizeArena, sanitizeLook, sanitizeName } from '../features/customization/catalog'

export const REPLAY_STORAGE_PREFIX = 'steel-sync:replay:v1:'
export const MAX_REPLAYS = 3

/** Low-frequency playback state for controls. Transforms never pass through React. */
export interface ReplayPlayback {
  readonly meta: ReplayMeta
  readonly time: number
  readonly duration: number
  readonly playing: boolean
  readonly speed: ReplaySpeed
}

interface ReplayStore {
  replays: readonly Replay[]
  /** False when the browser refused to persist the latest replay; it then lasts only this session. */
  persistent: boolean
  playback: ReplayPlayback | null
  add: (replay: Replay) => void
  remove: (id: string) => void
  setPlayback: (playback: ReplayPlayback | null) => void
}

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** Demonstrations give way first, so watching one never costs the player's own fights. */
export function keepReplays(replays: readonly Replay[]): Replay[] {
  const kept = [...replays].sort((a, b) => b.meta.recordedAt - a.meta.recordedAt)
  while (kept.length > MAX_REPLAYS) {
    let drop = kept.length - 1
    for (let index = kept.length - 1; index >= 0; index--) if (kept[index]!.meta.mode === 'demo') { drop = index; break }
    kept.splice(drop, 1)
  }
  return kept
}

export function loadReplays(): Replay[] {
  const local = storage()
  if (!local) return []
  const replays: Replay[] = []
  try {
    const keys: string[] = []
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index)
      if (key?.startsWith(REPLAY_STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) {
      const replay = decodeReplay(local.getItem(key), { name: sanitizeName, look: sanitizeLook, arena: sanitizeArena })
      if (replay && REPLAY_STORAGE_PREFIX + replay.meta.id === key) replays.push(replay)
      else local.removeItem(key)
    }
  } catch { /* unreadable storage behaves as empty */ }
  return keepReplays(replays)
}

function erase(id: string): void {
  try { storage()?.removeItem(REPLAY_STORAGE_PREFIX + id) } catch { /* nothing stored */ }
}

function persist(replay: Replay): boolean {
  const local = storage()
  if (!local) return false
  try {
    local.setItem(REPLAY_STORAGE_PREFIX + replay.meta.id, encodeReplay(replay))
    return true
  } catch { return false }
}

export const useReplayStore = create<ReplayStore>((set, get) => ({
  replays: loadReplays(),
  persistent: true,
  playback: null,
  add: (replay) => {
    const previous = get().replays.filter(({ meta }) => meta.id !== replay.meta.id)
    const replays = keepReplays([replay, ...previous])
    for (const { meta } of previous) if (!replays.some((kept) => kept.meta.id === meta.id)) erase(meta.id)
    if (!replays.includes(replay)) { set({ replays }); return }
    set({ replays, persistent: persist(replay) })
  },
  remove: (id) => {
    erase(id)
    set({ replays: get().replays.filter(({ meta }) => meta.id !== id) })
  },
  setPlayback: (playback) => set({ playback }),
}))
