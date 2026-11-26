import type { CombatSnapshot, FighterStats, MatchWinner } from '../../types/combat'
import type { ArenaId } from '../../types/customization'
import { DIFFICULTY_RULES, sanitizeDifficulty, sanitizeOpponent } from '../combat/opponents'
import type { Difficulty, OpponentId } from '../combat/opponents'

/** One finished webcam match. Demonstrations are never recorded. */
export interface MatchRecord {
  readonly id: string
  /** Epoch milliseconds. */
  readonly playedAt: number
  readonly name: string
  readonly arena: ArenaId
  /** Records from before phase 10 were all against VULCAN-07 on normal. */
  readonly rival: OpponentId
  readonly difficulty: Difficulty
  readonly winner: MatchWinner
  readonly rounds: number
  readonly playerWins: number
  readonly opponentWins: number
  readonly player: FighterStats
  readonly opponent: FighterStats
  readonly score: number
}

export interface CareerSummary {
  readonly matches: number
  readonly wins: number
  readonly losses: number
  readonly draws: number
  readonly winRate: number
  readonly currentWinStreak: number
  readonly bestWinStreak: number
  readonly attacks: number
  readonly hits: number
  readonly accuracy: number
  readonly blocks: number
  readonly dodges: number
  readonly combos: number
  readonly bestStreak: number
  readonly damageDealt: number
  readonly damageTaken: number
  readonly bestScore: number
}

export const MAX_RECORDS = 200
const STAT_KEYS = ['attacks', 'hits', 'blocks', 'dodges', 'damage', 'combos', 'bestStreak'] as const

/** Rewards winning first, then clean offence and active defence. The result part follows the difficulty. Never negative. */
export function matchScore(snapshot: Pick<CombatSnapshot, 'winner' | 'playerWins' | 'playerStats' | 'opponentStats'>, difficulty: Difficulty = 'normal'): number {
  const { playerStats: own, opponentStats: other } = snapshot
  const result = ((snapshot.winner === 'player' ? 250 : snapshot.winner === 'draw' ? 80 : 0) + snapshot.playerWins * 60) * DIFFICULTY_RULES[difficulty].score
  const performance = own.damage + own.hits * 5 + own.blocks * 8 + own.dodges * 14 + own.combos * 20 + own.bestStreak * 5
  return Math.max(0, Math.round(result + performance - other.damage * 0.5))
}

export function createRecord(snapshot: CombatSnapshot, context: Pick<MatchRecord, 'id' | 'playedAt' | 'name' | 'arena' | 'rival' | 'difficulty'>): MatchRecord | null {
  if (snapshot.mode !== 'webcam' || snapshot.phase !== 'finished' || !snapshot.winner) return null
  return {
    ...context, winner: snapshot.winner, rounds: snapshot.round, playerWins: snapshot.playerWins, opponentWins: snapshot.opponentWins,
    player: { ...snapshot.playerStats }, opponent: { ...snapshot.opponentStats }, score: matchScore(snapshot, context.difficulty),
  }
}

/** Newest first, without duplicates and bounded. */
export function addRecord(records: readonly MatchRecord[], record: MatchRecord): MatchRecord[] {
  return [record, ...records.filter(({ id }) => id !== record.id)].sort((a, b) => b.playedAt - a.playedAt).slice(0, MAX_RECORDS)
}

/** Local ranking: higher score first; the earlier match keeps a tied position. */
export function rankRecords(records: readonly MatchRecord[], limit = 10): MatchRecord[] {
  return [...records].sort((a, b) => b.score - a.score || a.playedAt - b.playedAt).slice(0, limit)
}

export function summarize(records: readonly MatchRecord[]): CareerSummary {
  const ordered = [...records].sort((a, b) => a.playedAt - b.playedAt)
  let streak = 0
  let bestWinStreak = 0
  const total = {
    wins: 0, losses: 0, draws: 0, attacks: 0, hits: 0, blocks: 0, dodges: 0, combos: 0,
    bestStreak: 0, damageDealt: 0, damageTaken: 0, bestScore: 0,
  }
  for (const record of ordered) {
    if (record.winner === 'player') {
      total.wins += 1
      streak += 1
    } else {
      streak = 0
      if (record.winner === 'draw') total.draws += 1
      else total.losses += 1
    }
    bestWinStreak = Math.max(bestWinStreak, streak)
    total.attacks += record.player.attacks
    total.hits += record.player.hits
    total.blocks += record.player.blocks
    total.dodges += record.player.dodges
    total.combos += record.player.combos
    total.damageDealt += record.player.damage
    total.damageTaken += record.opponent.damage
    total.bestStreak = Math.max(total.bestStreak, record.player.bestStreak)
    total.bestScore = Math.max(total.bestScore, record.score)
  }
  return {
    ...total, matches: ordered.length, winRate: ordered.length ? total.wins / ordered.length : 0,
    currentWinStreak: streak, bestWinStreak, accuracy: total.attacks ? Math.min(1, total.hits / total.attacks) : 0,
  }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6 ? value : null
}

/** Also used by saved replays; returns null unless every statistic is a plausible number. */
export function parseStats(value: unknown): FighterStats | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Record<string, unknown>
  const stats = { attacks: 0, hits: 0, blocks: 0, dodges: 0, damage: 0, combos: 0, bestStreak: 0 }
  for (const key of STAT_KEYS) {
    const parsed = count(stored[key])
    if (parsed === null) return null
    stats[key] = parsed
  }
  return stats
}

/** Drops anything malformed instead of failing the whole history. */
export function parseRecords(
  raw: string | null,
  sanitize: { readonly name: (value: unknown) => string; readonly arena: (value: unknown) => ArenaId },
): MatchRecord[] {
  let value: unknown = null
  try { value = raw ? JSON.parse(raw) : null } catch { value = null }
  if (!Array.isArray(value)) return []
  const records: MatchRecord[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const stored = item as Record<string, unknown>
    const player = parseStats(stored.player)
    const opponent = parseStats(stored.opponent)
    const playedAt = typeof stored.playedAt === 'number' && Math.abs(stored.playedAt) <= 8.64e15 ? stored.playedAt : null
    const rounds = count(stored.rounds)
    const playerWins = count(stored.playerWins)
    const opponentWins = count(stored.opponentWins)
    const score = count(stored.score)
    const { winner, id } = stored
    if (!player || !opponent || playedAt === null || rounds === null || playerWins === null || opponentWins === null || score === null
      || typeof id !== 'string' || id === '' || ids.has(id) || winner !== 'player' && winner !== 'opponent' && winner !== 'draw') continue
    ids.add(id)
    records.push({
      id, playedAt, name: sanitize.name(stored.name), arena: sanitize.arena(stored.arena),
      rival: sanitizeOpponent(stored.rival), difficulty: sanitizeDifficulty(stored.difficulty), winner, rounds, playerWins, opponentWins, player, opponent, score,
    })
  }
  return records.sort((a, b) => b.playedAt - a.playedAt).slice(0, MAX_RECORDS)
}
