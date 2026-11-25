import { create } from 'zustand'
import { addRecord, parseRecords } from '../engine/career/career'
import type { MatchRecord } from '../engine/career/career'
import { sanitizeArena, sanitizeName } from '../features/customization/catalog'

export const CAREER_STORAGE_KEY = 'steel-sync:career:v1'

interface CareerStore {
  records: readonly MatchRecord[]
  /** False when the browser refused to persist; the history then lasts only this session. */
  persistent: boolean
  add: (record: MatchRecord) => void
  clear: () => void
}

function load(): MatchRecord[] {
  try {
    return parseRecords(globalThis.localStorage?.getItem(CAREER_STORAGE_KEY) ?? null, { name: sanitizeName, arena: sanitizeArena })
  } catch { return [] }
}

function save(records: readonly MatchRecord[]): boolean {
  try {
    if (!globalThis.localStorage) return false
    globalThis.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(records))
    return true
  } catch { return false }
}

export const useCareerStore = create<CareerStore>((set, get) => ({
  records: load(),
  persistent: true,
  add: (record) => {
    const records = addRecord(get().records, record)
    set({ records, persistent: save(records) })
  },
  clear: () => set({ records: [], persistent: save([]) }),
}))
