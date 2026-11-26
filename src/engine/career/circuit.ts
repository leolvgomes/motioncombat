import type { MatchWinner } from '../../types/combat'
import { DIFFICULTIES, sanitizeDifficulty } from '../combat/opponents'
import type { Difficulty, OpponentId } from '../combat/opponents'

/** The single-player circuit: four fights in order, the champion last. */
export const CIRCUIT: readonly OpponentId[] = ['kestrel', 'basalt', 'magna', 'vulcan']

export interface CircuitRun {
  readonly difficulty: Difficulty
  /** Index in CIRCUIT of the next fight. */
  readonly stage: number
  /** Epoch milliseconds. */
  readonly startedAt: number
}

export interface CircuitProgress {
  readonly run: CircuitRun | null
  /** Circuits won at each difficulty. */
  readonly titles: Readonly<Record<Difficulty, number>>
  /** Most fights won in a single run, 0–CIRCUIT.length. */
  readonly bestStage: number
}

/** A win advances, a draw repeats the same fight, a loss ends the run. */
export type CircuitOutcome = 'advanced' | 'champion' | 'retry' | 'eliminated'

export const EMPTY_CIRCUIT: CircuitProgress = Object.freeze({
  run: null, titles: Object.freeze({ easy: 0, normal: 0, hard: 0 }), bestStage: 0,
})

export function circuitOpponent(run: CircuitRun): OpponentId { return CIRCUIT[Math.min(run.stage, CIRCUIT.length - 1)]! }

/** Starting again abandons any run in progress. */
export function startCircuit(progress: CircuitProgress, difficulty: Difficulty, now: number): CircuitProgress {
  return { ...progress, run: { difficulty, stage: 0, startedAt: now } }
}

export function abandonCircuit(progress: CircuitProgress): CircuitProgress { return { ...progress, run: null } }

export function recordCircuitMatch(progress: CircuitProgress, winner: MatchWinner): { progress: CircuitProgress; outcome: CircuitOutcome } {
  const { run } = progress
  if (!run) return { progress, outcome: 'eliminated' }
  if (winner === 'draw') return { progress, outcome: 'retry' }
  if (winner === 'opponent') return { progress: { ...progress, run: null }, outcome: 'eliminated' }
  const cleared = run.stage + 1
  const bestStage = Math.max(progress.bestStage, cleared)
  if (cleared >= CIRCUIT.length) {
    const titles = { ...progress.titles, [run.difficulty]: progress.titles[run.difficulty] + 1 }
    return { progress: { run: null, titles, bestStage }, outcome: 'champion' }
  }
  return { progress: { ...progress, bestStage, run: { ...run, stage: cleared } }, outcome: 'advanced' }
}

function whole(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

/** Untrusted storage in, always a consistent progress out. */
export function parseCircuit(value: unknown): CircuitProgress {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const titlesValue = stored.titles && typeof stored.titles === 'object' ? stored.titles as Record<string, unknown> : {}
  const titles = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, whole(titlesValue[difficulty], 1e6) ?? 0])) as Record<Difficulty, number>
  const runValue = stored.run && typeof stored.run === 'object' ? stored.run as Record<string, unknown> : null
  const stage = runValue ? whole(runValue.stage, CIRCUIT.length - 1) : null
  const startedAt = runValue && typeof runValue.startedAt === 'number' && Number.isFinite(runValue.startedAt) ? runValue.startedAt : null
  const run = runValue && stage !== null && startedAt !== null ? { difficulty: sanitizeDifficulty(runValue.difficulty), stage, startedAt } : null
  return { run, titles, bestStage: whole(stored.bestStage, CIRCUIT.length) ?? 0 }
}
