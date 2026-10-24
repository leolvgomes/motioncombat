import type { CombatEvent, FighterId, MatchWinner } from '../../types/combat'

const NAMES: Record<FighterId, string> = { player: 'ATLAS-01', opponent: 'VULCAN-07' }

function winnerName(winner: MatchWinner): string { return winner === 'draw' ? '' : NAMES[winner] }

/**
 * Short screen-reader text for meaningful match events. Countdown ticks after the first, swings and misses
 * stay silent to avoid flooding the live region; the opponent's wind-up already has its own status in the HUD.
 */
export function announcementForEvent(event: CombatEvent): string | null {
  switch (event.type) {
    case 'countdown': return event.round === 1 && event.value >= 3 ? `Round ${event.round}. Começa em ${event.value} segundos.` : null
    case 'fight': return `Round ${event.round}. Lutem!`
    case 'attack':
    case 'telegraph': return null
    case 'impact': {
      const { attacker, result } = event.impact
      const defender = NAMES[attacker === 'player' ? 'opponent' : 'player']
      const health = Math.max(0, Math.ceil(event.defenderHealth))
      if (result === 'hit') return `${defender} atingido. Integridade ${health}.`
      if (result === 'blocked') return `${defender} bloqueou. Integridade ${health}.`
      if (result === 'dodged') return `${defender} esquivou.`
      return null
    }
    case 'round-end':
      if (event.winner === 'draw') return `Round ${event.round} empatado.`
      return `${event.knockout ? 'Nocaute! ' : 'Tempo esgotado. '}${winnerName(event.winner)} vence o round ${event.round}.`
    case 'match-end':
      return event.winner === 'draw' ? 'Partida empatada.' : `Fim de partida. ${winnerName(event.winner)} venceu.`
  }
}
