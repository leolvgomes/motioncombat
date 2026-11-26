import { useState } from 'react'
import { Film, Medal, Play, Swords, Trash2, Trophy } from 'lucide-react'
import { rankRecords, summarize } from '../../engine/career/career'
import type { MatchRecord } from '../../engine/career/career'
import { COMBOS } from '../../engine/combat/combos'
import type { ComboStep } from '../../engine/combat/combos'
import type { Replay } from '../../engine/replay/replay'
import { useCareerStore } from '../../stores/career-store'
import { useMatchStore } from '../../stores/match-store'
import { useReplayStore } from '../../stores/replay-store'
import type { MatchWinner } from '../../types/combat'
import { arenaOption, OPPONENT_NAME } from '../customization/catalog'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const stepNames = { straight: 'Soco', hook: 'Cruzado', uppercut: 'Uppercut' } as const

function percent(value: number): string { return `${Math.round(value * 100)}%` }
function resultLabel(winner: MatchWinner): string { return winner === 'player' ? 'Vitória' : winner === 'opponent' ? 'Derrota' : 'Empate' }
function stepLabel(step: ComboStep): string { return step.side === 'alternate' ? `${stepNames[step.kind]} com a outra mão` : stepNames[step.kind] }

function duration(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function Ranking({ records }: { records: readonly MatchRecord[] }) {
  return <div className="career-table"><table>
    <caption>Ranking local · 10 melhores partidas</caption>
    <thead><tr><th scope="col">Posição</th><th scope="col">Robô</th><th scope="col">Resultado</th><th scope="col">Rounds</th><th scope="col">Combos</th><th scope="col">Data</th><th scope="col">Pontos</th></tr></thead>
    <tbody>{rankRecords(records).map((record, index) => <tr key={record.id} className={index === 0 ? 'is-first' : ''}>
      <th scope="row">{index + 1}º</th><td>{record.name}</td><td>{resultLabel(record.winner)}</td><td>{record.playerWins} × {record.opponentWins}</td>
      <td>{record.player.combos}</td><td>{dateFormat.format(record.playedAt)}</td><td><strong>{record.score}</strong></td>
    </tr>)}</tbody>
  </table></div>
}

export function CareerPanel({ onWatch }: { onWatch: (replay: Replay) => void }) {
  const records = useCareerStore((state) => state.records)
  const persistent = useCareerStore((state) => state.persistent)
  const clear = useCareerStore((state) => state.clear)
  const replays = useReplayStore((state) => state.replays)
  const replayPersistent = useReplayStore((state) => state.persistent)
  const remove = useReplayStore((state) => state.remove)
  const watching = useReplayStore((state) => state.playback !== null)
  const busy = useMatchStore((state) => state.snapshot.phase !== 'ready' && state.snapshot.phase !== 'finished') && !watching
  const [confirming, setConfirming] = useState(false)
  const summary = summarize(records)
  const tiles: readonly { label: string; value: string; note: string }[] = [
    { label: 'Partidas', value: String(summary.matches), note: `${summary.wins} V · ${summary.draws} E · ${summary.losses} D` },
    { label: 'Aproveitamento', value: percent(summary.winRate), note: `Sequência atual: ${summary.currentWinStreak} · melhor: ${summary.bestWinStreak}` },
    { label: 'Precisão', value: percent(summary.accuracy), note: `${summary.hits} acertos em ${summary.attacks} golpes` },
    { label: 'Defesa', value: String(summary.blocks + summary.dodges), note: `${summary.blocks} bloqueios · ${summary.dodges} esquivas` },
    { label: 'Combos', value: String(summary.combos), note: `Maior sequência: ${summary.bestStreak} acertos` },
    { label: 'Dano', value: String(Math.round(summary.damageDealt)), note: `${Math.round(summary.damageTaken)} recebido` },
  ]

  return <section className="expansion-panel career-panel" aria-labelledby="career-title">
    <header className="expansion-heading"><div><span className="panel-eyebrow"><Trophy size={13} aria-hidden="true" />CARREIRA · FASE 07</span><h2 id="career-title">Carreira e replays</h2><p>Só partidas com webcam contam. Tudo fica neste navegador, sem conta e sem envio de dados.</p></div></header>

    <div className="career-section">
      <h3><Medal size={15} aria-hidden="true" />Estatísticas</h3>
      {summary.matches === 0 ? <p className="expansion-empty">Termine uma partida com webcam para começar sua carreira. As demonstrações não são registradas.</p> : <>
        <dl className="career-tiles">{tiles.map(({ label, value, note }) => <div key={label}><dt>{label}</dt><dd><strong>{value}</strong><small>{note}</small></dd></div>)}</dl>
        <Ranking records={records} />
        <div className="career-clear">{confirming
          ? <><p role="alert">Apagar as {summary.matches} partidas deste navegador? Isso não pode ser desfeito.</p><button className="combat-primary-action" type="button" onClick={() => { clear(); setConfirming(false) }}>Apagar histórico</button><button className="combat-secondary-action" type="button" onClick={() => setConfirming(false)}>Cancelar</button></>
          : <button className="combat-secondary-action is-subtle" type="button" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" />Apagar histórico</button>}</div>
      </>}
      {!persistent && <p className="expansion-warning" role="status">O navegador não permitiu salvar o histórico. Ele vale só para esta sessão.</p>}
    </div>

    <div className="career-section">
      <h3><Film size={15} aria-hidden="true" />Replays</h3>
      <p className="expansion-note">As 3 últimas partidas, guardadas como movimentos dos robôs. Não há imagem da câmera nem pontos do seu corpo. Demonstrações saem primeiro quando falta espaço.</p>
      {replays.length === 0 ? <p className="expansion-empty">Nenhum replay ainda. Ele aparece aqui quando uma partida termina.</p>
        : <ul className="replay-list">{replays.map((replay) => <li key={replay.meta.id}>
          <div><strong>{replay.meta.name} × {OPPONENT_NAME}</strong><small>{replay.meta.mode === 'demo' ? 'Demonstração' : resultLabel(replay.winner)} · {arenaOption(replay.meta.arena).label} · {duration(replay.duration)} · {dateFormat.format(replay.meta.recordedAt)}</small></div>
          <button className="combat-secondary-action" type="button" disabled={busy} onClick={() => onWatch(replay)}><Play size={13} aria-hidden="true" />Assistir</button>
          <button className="combat-secondary-action is-subtle" type="button" aria-label={`Excluir replay de ${dateFormat.format(replay.meta.recordedAt)}`} onClick={() => remove(replay.meta.id)}><Trash2 size={14} aria-hidden="true" /></button>
        </li>)}</ul>}
      {busy && <p className="expansion-note" role="status">Termine ou encerre a partida em andamento para assistir a um replay.</p>}
      {!replayPersistent && <p className="expansion-warning" role="status">O último replay não coube no armazenamento do navegador. Ele vale só para esta sessão.</p>}
    </div>

    <div className="career-section">
      <h3><Swords size={15} aria-hidden="true" />Combos</h3>
      <p className="expansion-note">Conecte os golpes na ordem, sem bloqueio, com até 1,5 s entre eles. Ser atingido quebra a sequência.</p>
      <ul className="combo-list">{COMBOS.map(({ id, name, steps, bonus }) => <li key={id}><strong>{name}</strong><span>{steps.map(stepLabel).join(' → ')}</span><small>+{bonus} de dano</small></li>)}</ul>
    </div>
  </section>
}
