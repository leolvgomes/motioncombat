import { useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, ClipboardCheck, Download, Play, Trash2, X } from 'lucide-react'
import type { GestureScore, TrialProgress, TrialRecording, TrialResult, TrialSummary } from '../../engine/motion/trials'
import { buildProtocol } from '../../engine/motion/trials'
import { useCombatMotionStore } from '../../stores/combat-motion-store'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTrialStore } from '../../stores/trial-store'
import { combatAudio } from '../audio/combat-audio'
import { gestureLabels } from '../motion-tracking/gesture-labels'
import { PerformanceSummary } from './PerformanceSummary'
import { trialRuntime } from './trial-runtime'

const LENGTHS = [{ repetitions: 3, label: 'Rápida' }, { repetitions: 5, label: 'Completa' }] as const
const cues = {
  prepare: () => { combatAudio.play('telegraph') },
  go: () => { combatAudio.play('countdown') },
}

function minutes(repetitions: number): string {
  const seconds = Math.round(buildProtocol(repetitions).at(-1)!.endsAt / 1000)
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
}

function feedback(result: TrialResult): string {
  if (result.outcome === 'correct') return `Reconhecido: ${gestureLabels[result.detected[0]!]}`
  if (result.outcome === 'confused') return `Reconhecido como: ${gestureLabels[result.detected[0]!]}`
  if (result.outcome === 'missed') return 'Não reconhecido'
  return result.outcome === 'clean' ? 'Nenhum golpe indevido' : `Golpe indevido: ${gestureLabels[result.detected[0]!]}`
}

function TrialOverlay({ progress }: { progress: TrialProgress }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const pendingExit = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pendingExit.current !== null) { clearTimeout(pendingExit.current); pendingExit.current = null }
    cancel.current?.focus()
    let handle = 0
    // Cues must follow the script closely, independently of the diagnostic rate.
    const tick = () => { trialRuntime.tick(cues); handle = requestAnimationFrame(tick) }
    handle = requestAnimationFrame(tick)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') trialRuntime.cancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(handle)
      window.removeEventListener('keydown', onKeyDown)
      // Leaving the laboratory ends the script; nobody would see its cues. StrictMode remounts cancel this.
      pendingExit.current = setTimeout(() => trialRuntime.cancel('A aferição foi interrompida ao sair do laboratório.'), 0)
    }
  }, [])
  const { step, phase, lastResult } = progress
  const go = phase === 'go'
  const good = lastResult?.outcome === 'correct' || lastResult?.outcome === 'clean'
  return <div className={`trial-overlay ${go ? 'is-go' : ''}`} role="dialog" aria-modal="true" aria-labelledby="trial-instruction">
    <span className="trial-step">{step.index + 1} / {progress.stepCount}{step.repetitions > 1 && ` · repetição ${step.repetition} de ${step.repetitions}`}</span>
    <h2 id="trial-instruction">{step.instruction}</h2>
    <strong className="trial-cue" role="status">{go ? step.expected ? 'AGORA!' : 'CONTINUE' : phase === 'intro' ? `PREPARE-SE · ${Math.ceil(progress.remainingMs / 1000)}` : 'VOLTE À GUARDA'}</strong>
    <p className={`trial-feedback ${good ? 'is-good' : ''}`}>{lastResult && !go ? <>{good ? <CircleCheck size={18} aria-hidden="true" /> : <CircleX size={18} aria-hidden="true" />}{feedback(lastResult)}</> : ' '}</p>
    <div className="trial-progress" role="progressbar" aria-label="Progresso da aferição" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)}><span style={{ transform: `scaleX(${progress.progress})` }} /></div>
    <button ref={cancel} className="combat-secondary-action" type="button" aria-keyshortcuts="Escape" onClick={() => trialRuntime.cancel()}><X size={14} aria-hidden="true" />Interromper (Esc)</button>
  </div>
}

function confusion(score: GestureScore): string {
  const parts = Object.entries(score.confusedWith).map(([gesture, count]) => `${count}× ${gestureLabels[gesture as GestureScore['gesture']].toLowerCase()}`)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function download(recording: TrialRecording): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `steel-sync-afericao-${recording.recordedAt.slice(0, 16).replace(/[-:T]/g, '')}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Report({ recording, summary }: { recording: TrialRecording; summary: TrialSummary }) {
  return <div className="trial-report">
    <div className="trial-headline"><strong>{Math.round(summary.accuracy * 100)}%</strong><span>dos movimentos pedidos foram reconhecidos corretamente<small>{summary.idleFalsePositives} golpes indevidos em movimentos comuns · {summary.strayAttacks} entre repetições</small></span></div>
    <div className="career-table"><table><caption>Resultado por movimento</caption>
      <thead><tr><th scope="col">Movimento</th><th scope="col">Acertos</th><th scope="col">Perdidos</th><th scope="col">Confundido com</th><th scope="col">Golpe extra</th><th scope="col">Tempo até reconhecer</th></tr></thead>
      <tbody>{summary.gestures.map((score) => <tr key={score.gesture}><th scope="row">{gestureLabels[score.gesture]}</th><td>{score.correct} de {score.total}</td><td>{score.missed}</td><td>{confusion(score)}</td><td>{score.extra}</td><td>{score.medianDelayMs === null ? '—' : `${score.medianDelayMs} ms`}</td></tr>)}</tbody></table></div>
    <p className="expansion-note">O tempo inclui a sua reação ao aviso. O arquivo contém posições de articulações e o roteiro, sem imagem. Ele só sai desta página se você baixar.</p>
    <div className="trial-actions"><button className="combat-primary-action" type="button" onClick={() => download(recording)}><Download size={14} aria-hidden="true" />Baixar dados da aferição</button><button className="combat-secondary-action is-subtle" type="button" onClick={() => trialRuntime.discard()}><Trash2 size={14} aria-hidden="true" />Descartar</button></div>
  </div>
}

export function TrialPanel() {
  const progress = useTrialStore((state) => state.progress)
  const result = useTrialStore((state) => state.result)
  const interruption = useTrialStore((state) => state.interruption)
  const calibrated = useCombatMotionStore((state) => state.snapshot.calibration.stage === 'complete')
  const live = useLabStore((state) => state.session.status === 'running')
  const demo = useRobotStore((state) => state.mode === 'demo')
  const soundEnabled = useSettingsStore((state) => state.soundEnabled)
  const volume = useSettingsStore((state) => state.volume)
  const [repetitions, setRepetitions] = useState<number>(LENGTHS[0].repetitions)
  const ready = live && calibrated && !demo
  const begin = () => {
    combatAudio.configure(soundEnabled, volume)
    combatAudio.unlock()
    trialRuntime.start(repetitions)
  }
  return <section className="expansion-panel trial-panel" aria-labelledby="trial-title">
    <header className="expansion-heading"><div><span className="panel-eyebrow"><ClipboardCheck size={13} aria-hidden="true" />PRECISÃO · FASE 08</span><h2 id="trial-title">Aferição guiada</h2><p>Siga os avisos na tela. O jogo mede quantos golpes reconhece, quais confunde e se algum sai sem querer.</p></div></header>
    <div className="career-section">
      <div className="trial-setup"><fieldset className="garage-group"><legend>Duração</legend><div className="garage-options">{LENGTHS.map((length) => <label key={length.repetitions} className={`garage-option ${repetitions === length.repetitions ? 'is-selected' : ''}`}><input type="radio" name="trial-length" checked={repetitions === length.repetitions} onChange={() => setRepetitions(length.repetitions)} /><span>{length.label}<small>{length.repetitions} de cada golpe · {minutes(length.repetitions)}</small></span></label>)}</div></fieldset>
        <button className="combat-primary-action" type="button" disabled={!ready} onClick={begin}><Play size={14} aria-hidden="true" />Iniciar aferição</button></div>
      <p className="expansion-note" role="status">{ready ? 'Posicione-se, assuma a guarda e mantenha espaço para os braços. Esquerda e direita são sempre as do seu corpo.' : 'Ligue a câmera e conclua a calibração para aferir.'}</p>
      {interruption && <p className="expansion-warning" role="status">{interruption}</p>}
      {result && <Report recording={result.recording} summary={result.summary} />}
      {result?.performance && <PerformanceSummary report={result.performance} title="Desempenho durante a aferição" />}
    </div>
    {progress && <TrialOverlay progress={progress} />}
  </section>
}
