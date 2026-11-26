import { create } from 'zustand'
import { EMPTY_CIRCUIT, abandonCircuit, parseCircuit, recordCircuitMatch, startCircuit } from '../engine/career/circuit'
import type { CircuitOutcome, CircuitProgress } from '../engine/career/circuit'
import type { Difficulty } from '../engine/combat/opponents'
import type { MatchWinner } from '../types/combat'

export const PROGRESS_STORAGE_KEY = 'steel-sync:progress:v1'

export interface StoredProgress {
  readonly circuit: CircuitProgress
  readonly tutorialCompleted: boolean
}

interface ProgressStore extends StoredProgress {
  /** False when the browser refused to persist; progress then lasts only this session. */
  persistent: boolean
  startCircuit: (difficulty: Difficulty, now: number) => void
  abandonCircuit: () => void
  recordCircuit: (winner: MatchWinner) => CircuitOutcome
  completeTutorial: () => void
}

export function parseProgress(raw: string | null): StoredProgress {
  let value: unknown = null
  try { value = raw ? JSON.parse(raw) : null } catch { value = null }
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { circuit: stored.circuit ? parseCircuit(stored.circuit) : EMPTY_CIRCUIT, tutorialCompleted: stored.tutorialCompleted === true }
}

function load(): StoredProgress {
  try { return parseProgress(globalThis.localStorage?.getItem(PROGRESS_STORAGE_KEY) ?? null) } catch { return parseProgress(null) }
}

function save(progress: StoredProgress): boolean {
  try {
    if (!globalThis.localStorage) return false
    globalThis.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    return true
  } catch { return false }
}

/** Single-player progress: the circuit run and whether the guided training was finished. Only this browser. */
export const useProgressStore = create<ProgressStore>((set, get) => {
  const update = (patch: Partial<StoredProgress>) => {
    const next = { circuit: patch.circuit ?? get().circuit, tutorialCompleted: patch.tutorialCompleted ?? get().tutorialCompleted }
    set({ ...next, persistent: save(next) })
  }
  return {
    ...load(),
    persistent: true,
    startCircuit: (difficulty, now) => update({ circuit: startCircuit(get().circuit, difficulty, now) }),
    abandonCircuit: () => update({ circuit: abandonCircuit(get().circuit) }),
    recordCircuit: (winner) => {
      const result = recordCircuitMatch(get().circuit, winner)
      update({ circuit: result.progress })
      return result.outcome
    },
    completeTutorial: () => update({ tutorialCompleted: true }),
  }
})
