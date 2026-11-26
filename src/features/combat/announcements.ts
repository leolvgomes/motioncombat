import { comboById } from '../../engine/combat/combos'
import type { AttackKind, AttackSide } from '../../types/animation'
import type { CombatEvent, FighterId, MatchWinner } from '../../types/combat'
import { DEFAULT_NAME, OPPONENT_NAME } from '../customization/catalog'

export type FighterNames = Readonly<Record<FighterId, string>>
export const DEFAULT_NAMES: FighterNames = { player: DEFAULT_NAME, opponent: OPPONENT_NAME }

const ATTACK_NOUNS: Readonly<Record<AttackKind, string>> = { straight: 'soco', hook: 'cruzado', uppercut: 'uppercut' }

export function attackLabel(kind: AttackKind, side: AttackSide): string {
  return `${ATTACK_NOUNS[kind]} ${side === 'left' ? 'esquerdo' : 'direito'}`
}

/**
 * Short screen-reader text for meaningful match events. Countdown ticks after the first, swings and misses
 * stay silent to avoid flooding the live region; the opponent's wind-up already has its own status in the HUD.
 */
export function announcementForEvent(event: CombatEvent, names: FighterNames = DEFAULT_NAMES): string | null {
  const winnerName = (winner: MatchWinner) => winner === 'draw' ? '' : names[winner]
  switch (event.type) {
    case 'countdown': return event.round === 1 && event.value >= 3 ? `Round ${event.round}. Começa em ${event.value} segundos.` : null
    case 'fight': return `Round ${event.round}. Lutem!`
    case 'attack':
    case 'telegraph': return null
    case 'impact': {
      const { attacker, result } = event.impact
      const defender = names[attacker === 'player' ? 'opponent' : 'player']
      const health = Math.max(0, Math.ceil(event.defenderHealth))
      if (result === 'hit') return `${defender} atingido${event.impact.special ? ' pela sobrecarga' : ''}. Integridade ${health}.`
      if (result === 'blocked') return `${defender} bloqueou. Integridade ${health}.`
      if (result === 'dodged') return `${defender} esquivou.`
      return null
    }
    case 'combo': return `Combo ${comboById(event.combo.combo).name} de ${names[event.combo.fighter]}. Mais ${event.combo.bonus} de dano.`
    case 'special': return `Sobrecarga de ${names[event.fighter]}!`
    case 'round-end':
      if (event.winner === 'draw') return `Round ${event.round} empatado.`
      return `${event.knockout ? 'Nocaute! ' : 'Tempo esgotado. '}${winnerName(event.winner)} vence o round ${event.round}.`
    case 'match-end':
      return event.winner === 'draw' ? 'Partida empatada.' : `Fim de partida. ${winnerName(event.winner)} venceu.`
  }
}
