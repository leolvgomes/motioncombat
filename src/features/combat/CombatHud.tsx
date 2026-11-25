import { Clock3 } from 'lucide-react'
import type { CombatSnapshot } from '../../types/combat'
import { useMatchStore } from '../../stores/match-store'
import { attackLabel } from './announcements'
import type { FighterNames } from './announcements'

function healthValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

function clock(secondsLeft: number): string {
  const seconds = Math.max(0, Math.ceil(secondsLeft))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function FighterHealth({ name, label, health, wins, streak, opponent = false }: {
  name: string
  label: string
  health: number
  wins: number
  streak: number
  opponent?: boolean
}) {
  const value = healthValue(health)
  // Critical state is also spelled out, so it never depends on colour alone.
  const critical = value > 0 && value <= 25
  return <div className={`combat-fighter-hud ${opponent ? 'is-opponent' : ''} ${critical ? 'is-critical' : ''}`}>
    <div className="combat-fighter-heading"><div><span>{label}</span><strong>{name}</strong></div><span className="combat-health-value">{critical && <em>CRÍTICO</em>}{Math.ceil(value)}<small>/ 100</small></span></div>
    <div className="combat-health-track" role="meter" aria-label={`Integridade de ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${Math.ceil(value)} de 100${critical ? ', crítico' : ''}`}><span style={{ transform: `scaleX(${value / 100})` }} /></div>
    <div className="combat-round-markers" aria-label={`${name}: ${wins} ${wins === 1 ? 'round vencido' : 'rounds vencidos'}`}><span className={wins >= 1 ? 'is-won' : ''} /><span className={wins >= 2 ? 'is-won' : ''} /><small>ROUNDS</small>{streak >= 2 && <em className="combat-streak">{streak} ACERTOS SEGUIDOS</em>}</div>
  </div>
}

export function CombatHud({ snapshot, names, replay }: { snapshot: CombatSnapshot; names: FighterNames; replay: boolean }) {
  const opponentCue = useMatchStore((state) => state.opponentCue)
  return <div className="combat-hud">
    <FighterHealth name={names.player} streak={snapshot.playerStreak} label={snapshot.mode === 'demo' ? 'UNIDADE 01 · IA' : 'SEU ROBÔ'} health={snapshot.playerHealth} wins={snapshot.playerWins} />
    <div className="combat-clock"><span>MELHOR DE 3</span><strong><Clock3 size={15} aria-hidden="true" />{clock(snapshot.secondsLeft)}</strong><small>{snapshot.pauseReason && !replay ? 'PAUSADO' : `ROUND ${snapshot.round} / 3`}</small></div>
    <FighterHealth name={names.opponent} streak={snapshot.opponentStreak} label="OPONENTE · IA" health={snapshot.opponentHealth} wins={snapshot.opponentWins} opponent />
    {opponentCue && <div className="combat-opponent-cue" role="status">VULCAN prepara {attackLabel(opponentCue.kind, opponentCue.side)}<span>Prepare a guarda ou esquive</span></div>}
  </div>
}
