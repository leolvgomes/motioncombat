import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Activity, ChevronDown, CircleAlert, Gauge, Keyboard, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Swords, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { Toggle } from '../../components/ui/Toggle'
import { useMatchStore } from '../../stores/match-store'
import { useRobotStore } from '../../stores/robot-store'
import type { RobotQuality } from '../../stores/robot-store'
import { useSettingsStore } from '../../stores/settings-store'
import type { CombatSnapshot, FighterStats, ImpactEvent, PauseReason } from '../../types/combat'
import { combatAudio, cueFighter, cueForEvent } from '../audio/combat-audio'
import { announcementForEvent } from './announcements'
import { matchRuntime } from './match-runtime'
import { CombatHud } from './CombatHud'
import { QualityAdvisor } from './quality-advisor'

const ArenaCanvas = lazy(() => import('../arena/ArenaCanvas'))

const pauseMessages: Record<PauseReason, string> = {
  manual: 'Retome quando estiver pronto.',
  tracking: 'Retome o enquadramento e mantenha braços e tronco visíveis. A partida aguarda um rastreamento válido.',
  view: 'A partida foi suspensa ao interromper a visualização da arena.',
  hidden: 'A partida foi suspensa enquanto a página ficou em segundo plano.',
}

const statisticRows: readonly { key: keyof FighterStats; label: string }[] = [
  { key: 'attacks', label: 'Golpes iniciados' },
  { key: 'hits', label: 'Acertos sem bloqueio' },
  { key: 'blocks', label: 'Bloqueios realizados' },
  { key: 'dodges', label: 'Esquivas bem-sucedidas' },
  { key: 'damage', label: 'Dano causado' },
]

class ArenaBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    matchRuntime.suspend('view')
    matchRuntime.setSceneFps(null)
    console.error('Erro na arena 3D:', error, info.componentStack)
  }
  render() {
    if (this.state.failed) return <div className="arena-renderer-error" role="alert"><CircleAlert size={26} aria-hidden="true" /><strong>A visualização da arena foi interrompida</strong><p>Verifique a aceleração gráfica do navegador e tente abrir a cena novamente. A câmera continua disponível.</p><button type="button" onClick={this.props.onRetry}>Reabrir arena</button></div>
    return this.props.children
  }
}

function winnerLabel(snapshot: CombatSnapshot): string {
  if (snapshot.winner === 'draw') return 'Partida empatada'
  if (snapshot.mode === 'demo') return `${snapshot.winner === 'player' ? 'ATLAS-01' : 'VULCAN-07'} venceu`
  return snapshot.winner === 'player' ? 'Vitória do ATLAS-01' : 'VULCAN-07 venceu'
}

function impactLabel(impact: ImpactEvent): string {
  const attacker = impact.attacker === 'player' ? 'ATLAS-01' : 'VULCAN-07'
  const defender = impact.attacker === 'player' ? 'VULCAN-07' : 'ATLAS-01'
  const damage = Number.isInteger(impact.damage) ? impact.damage : impact.damage.toFixed(1)
  if (impact.result === 'hit') return `${attacker} conectou · ${damage} de dano`
  if (impact.result === 'blocked') return `${defender} bloqueou${impact.damage > 0 ? ` · ${damage} de dano` : ''}`
  if (impact.result === 'dodged') return `${defender} esquivou`
  return `${attacker} golpeou fora de alcance`
}

/** Plays procedural cues for simulation events and follows the sound preferences. Leaving the arena silences it. */
function useCombatAudio() {
  const soundEnabled = useSettingsStore((state) => state.soundEnabled)
  const volume = useSettingsStore((state) => state.volume)
  useEffect(() => { combatAudio.configure(soundEnabled, volume) }, [soundEnabled, volume])
  useEffect(() => {
    const unsubscribe = matchRuntime.subscribe((event) => {
      const cue = cueForEvent(event, matchRuntime.snapshot.mode)
      if (cue) combatAudio.play(cue, cueFighter(event))
    })
    const onVisibility = () => { if (document.hidden) combatAudio.suspend(); else combatAudio.resume() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      combatAudio.suspend()
    }
  }, [])
}

/** Polite live-region text. A trailing no-break space lets an identical message be announced again. */
function useMatchAnnouncer(): string {
  const [message, setMessage] = useState('')
  useEffect(() => matchRuntime.subscribe((event) => {
    const text = announcementForEvent(event)
    if (text) setMessage((previous) => previous === text ? `${text} ` : text)
  }), [])
  return message
}

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true)
  useEffect(() => {
    const preference = window.matchMedia?.(query)
    if (!preference) return
    const update = () => setReduced(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  return reduced
}

export function CombatPanel() {
  const snapshot = useMatchStore((state) => state.snapshot)
  const sceneFps = useMatchStore((state) => state.sceneFps)
  const canFight = useMatchStore((state) => state.canFight)
  const quality = useRobotStore((state) => state.quality)
  const setQuality = useRobotStore((state) => state.setQuality)
  const { soundEnabled, volume, effectsEnabled, shakeEnabled, setSoundEnabled, setVolume, setEffectsEnabled, setShakeEnabled } = useSettingsStore()
  const reducedMotion = useReducedMotion()
  const announcement = useMatchAnnouncer()
  useCombatAudio()
  const advisor = useRef(new QualityAdvisor())
  const [suggestLight, setSuggestLight] = useState(false)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  useEffect(() => {
    if (quality === 'light') setSuggestLight(false)
    if (advisor.current.observe(sceneFps, quality)) setSuggestLight(true)
  }, [sceneFps, quality])
  const [arenaAttempt, setArenaAttempt] = useState(0)
  const [visibleImpact, setVisibleImpact] = useState<ImpactEvent | null>(null)
  const impactId = snapshot.lastImpact?.id
  useEffect(() => {
    setVisibleImpact(snapshot.lastImpact)
    if (!snapshot.lastImpact) return
    const timer = window.setTimeout(() => setVisibleImpact(null), 1800)
    return () => window.clearTimeout(timer)
  }, [impactId])

  const demo = snapshot.mode === 'demo'
  const ready = snapshot.phase === 'ready'
  const finished = snapshot.phase === 'finished'
  const paused = snapshot.pauseReason !== null && !ready && !finished
  const sceneAvailable = sceneFps !== null && Number.isFinite(sceneFps) && sceneFps > 0
  const resumeAvailable = sceneAvailable && (demo || canFight)
  const status = paused ? 'Partida pausada' : ready ? 'Preparação' : finished ? 'Partida encerrada'
    : snapshot.phase === 'countdown' ? 'Contagem regressiva' : snapshot.phase === 'round-over' ? 'Intervalo entre rounds' : 'Combate em andamento'
  const preparation = !sceneAvailable ? 'Aguarde a visualização 3D para iniciar.'
    : !canFight ? 'Ligue a câmera, conclua a calibração e mantenha os braços visíveis para lutar.'
      : 'Rastreamento pronto. Assuma a guarda antes de iniciar.'

  // Every match command is a user gesture, the moment browsers allow audio to start.
  const command = (action: () => unknown) => () => { combatAudio.unlock(); action() }
  const toggleSound = () => {
    if (!soundEnabled) combatAudio.unlock()
    setSoundEnabled(!soundEnabled)
  }
  const togglePause = () => {
    if (ready || finished) return
    if (!paused) matchRuntime.pause()
    else if (resumeAvailable) { combatAudio.unlock(); matchRuntime.resume() }
  }
  const shortcuts = useRef({ togglePause, toggleSound })
  shortcuts.current = { togglePause, toggleSound }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'p') { event.preventDefault(); shortcuts.current.togglePause() }
      else if (key === 'm') { event.preventDefault(); shortcuts.current.toggleSound() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const volumePercent = Math.round(volume * 100)

  return <section className="combat-panel" aria-labelledby="combat-arena-title">
    <header className="combat-panel-heading"><div><span className="panel-eyebrow"><Swords size={13} aria-hidden="true" />COMBATE LOCAL · FASE 06</span><h2 id="combat-arena-title">Arena de combate</h2></div><span className={`combat-match-status ${snapshot.phase === 'fighting' && !paused ? 'is-live' : ''}`} role="status"><span className="status-dot" />{status}</span></header>

    <div className="combat-stage">
      <ArenaBoundary key={arenaAttempt} onRetry={() => setArenaAttempt((attempt) => attempt + 1)}>
        <Suspense fallback={<div className="arena-renderer-error" role="status"><LoaderCircle className="spinning" size={28} aria-hidden="true" /><strong>Preparando a arena</strong><p>Iniciando a visualização 3D neste dispositivo.</p></div>}><ArenaCanvas /></Suspense>
      </ArenaBoundary>
      <CombatHud snapshot={snapshot} />
      {ready && <div className="combat-lobby-copy"><span>ATLAS-01 × VULCAN-07</span><h3>Seu movimento.<br />Seu lugar no ringue.</h3><p>Calibre seu corpo e enfrente uma IA em uma melhor de três.</p></div>}
      {paused ? <div className="combat-stage-banner" role="status"><Pause size={23} aria-hidden="true" /><h3>{snapshot.pauseReason === 'manual' ? 'Combate pausado' : 'Pausa de segurança'}</h3><p>{snapshot.pauseReason ? pauseMessages[snapshot.pauseReason] : ''}</p><small>Use Retomar abaixo da arena para continuar.</small></div>
        : snapshot.phase === 'countdown' ? <div className="combat-countdown"><span>{demo ? 'INICIANDO DEMONSTRAÇÃO' : 'PREPARE A GUARDA'}</span><strong>{Math.max(1, Math.ceil(snapshot.countdown))}</strong></div>
          : snapshot.phase === 'round-over' ? <div className="combat-stage-banner"><ShieldCheck size={26} aria-hidden="true" /><h3>{snapshot.roundWinner === 'draw' ? 'Round empatado' : `${snapshot.roundWinner === 'player' ? 'ATLAS-01' : 'VULCAN-07'} venceu o round`}</h3><p>Placar {snapshot.playerWins} × {snapshot.opponentWins}</p><small>{snapshot.betweenRoundsLeft > 0 ? `Próximo round em ${Math.ceil(snapshot.betweenRoundsLeft)} s` : 'Preparando o próximo round'}</small></div>
            : finished && <div className={`combat-stage-banner is-result ${snapshot.winner === 'player' ? 'is-victory' : ''}`}><Trophy size={30} aria-hidden="true" /><span>{demo ? 'DEMONSTRAÇÃO CONCLUÍDA' : 'RESULTADO DA PARTIDA'}</span><h3>{winnerLabel(snapshot)}</h3><p>Placar final <strong>{snapshot.playerWins} × {snapshot.opponentWins}</strong></p></div>}
      {/* Visual toast only; the live region below narrates the same events once. */}
      {visibleImpact && !ready && !finished && !paused && <div className={`combat-impact is-${visibleImpact.result}`} aria-hidden="true">{impactLabel(visibleImpact)}</div>}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <div className={`combat-source-badge ${demo && !ready ? 'is-demo' : ''}`}>{demo && !ready ? 'IA × IA · movimentos programados' : ready ? 'Controle corporal ou demonstração' : 'Webcam · seus movimentos controlam ATLAS-01'}</div>
    </div>

    <div className="combat-controls">
      <div className="combat-match-actions">
        {ready ? <><button className="combat-primary-action" type="button" disabled={!canFight || !sceneAvailable} onClick={command(() => matchRuntime.start('webcam'))}><Swords size={15} aria-hidden="true" />Iniciar combate</button><button className="combat-secondary-action" type="button" disabled={!sceneAvailable} onClick={command(() => matchRuntime.start('demo'))}><Play size={14} aria-hidden="true" />Assistir demonstração</button></>
          : finished ? <><button className="combat-primary-action" type="button" disabled={!sceneAvailable || !demo && !canFight} onClick={command(() => matchRuntime.start(snapshot.mode))}><RotateCcw size={14} aria-hidden="true" />{demo ? 'Ver outra demonstração' : 'Revanche'}</button><button className="combat-secondary-action" type="button" onClick={() => matchRuntime.reset()}>Voltar ao início</button></>
            : <>{paused ? <button className="combat-primary-action" type="button" disabled={!resumeAvailable} aria-keyshortcuts="P" onClick={command(() => matchRuntime.resume())}><Play size={14} aria-hidden="true" />Retomar</button> : <button className="combat-secondary-action" type="button" aria-keyshortcuts="P" onClick={() => matchRuntime.pause()}><Pause size={14} aria-hidden="true" />Pausar</button>}<button className="combat-secondary-action is-subtle" type="button" onClick={() => matchRuntime.reset()}>Voltar ao início</button></>}
      </div>
      <div className="combat-display-settings"><span className="combat-scene-fps"><Activity size={13} aria-hidden="true" /><strong>{sceneFps === null ? '—' : Math.round(sceneFps)}</strong>FPS DA ARENA</span><label className="combat-quality-label" htmlFor="combat-quality">Qualidade 3D</label><div className="combat-quality-select"><select id="combat-quality" value={quality} onChange={(event) => setQuality(event.target.value as RobotQuality)}><option value="balanced">Equilibrada</option><option value="light">Leve</option></select><ChevronDown size={13} aria-hidden="true" /></div></div>
    </div>
    {suggestLight && !suggestionDismissed && quality === 'balanced' && <div className="combat-quality-hint" role="status"><Gauge size={15} aria-hidden="true" /><p>A arena está abaixo de 42 FPS há alguns segundos. A qualidade Leve reduz resolução e sombras.</p><button type="button" className="combat-secondary-action" onClick={() => setQuality('light')}>Usar qualidade Leve</button><button type="button" className="combat-hint-dismiss" aria-label="Dispensar sugestão de qualidade" onClick={() => setSuggestionDismissed(true)}><X size={14} aria-hidden="true" /></button></div>}
    <div className="combat-feedback-settings" role="group" aria-labelledby="combat-feedback-title">
      <span id="combat-feedback-title" className="combat-feedback-title">SOM E EFEITOS</span>
      <button type="button" className={`combat-sound-toggle ${soundEnabled ? 'is-on' : ''}`} aria-pressed={soundEnabled} aria-keyshortcuts="M" onClick={toggleSound}>{soundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}{soundEnabled ? 'Som ligado' : 'Som desligado'}</button>
      <label className="combat-volume"><span>Volume</span><input type="range" min={0} max={100} step={5} value={volumePercent} disabled={!soundEnabled} aria-valuetext={`${volumePercent}%`} onChange={(event) => setVolume(Number(event.target.value) / 100)} /><output aria-hidden="true">{volumePercent}%</output></label>
      <Toggle label="Faíscas de impacto" checked={effectsEnabled} onChange={() => setEffectsEnabled(!effectsEnabled)} />
      <Toggle label="Tremor de câmera" checked={shakeEnabled && !reducedMotion} onChange={() => setShakeEnabled(!shakeEnabled)} />
      {reducedMotion && <small className="combat-feedback-note">Movimento reduzido ativo no sistema: o tremor fica desligado e as faíscas são atenuadas.</small>}
      <p className="combat-shortcuts"><Keyboard size={14} aria-hidden="true" />Atalhos: <kbd>P</kbd> pausar ou retomar · <kbd>M</kbd> ligar ou desligar o som</p>
    </div>
    {(ready || paused && !demo && !canFight || finished && !demo && !canFight) && <p className="combat-readiness" role="status"><ShieldCheck size={14} aria-hidden="true" />{preparation}</p>}
    {finished && <div className="combat-results"><table><caption>Estatísticas da partida</caption><thead><tr><th scope="col">Desempenho</th><th scope="col">ATLAS-01</th><th scope="col">VULCAN-07</th></tr></thead><tbody>{statisticRows.map(({ key, label }) => <tr key={key}><th scope="row">{label}</th><td>{key === 'damage' ? Math.round(snapshot.playerStats[key] * 10) / 10 : snapshot.playerStats[key]}</td><td>{key === 'damage' ? Math.round(snapshot.opponentStats[key] * 10) / 10 : snapshot.opponentStats[key]}</td></tr>)}</tbody></table>{demo && <p>Estatísticas de duas IAs em demonstração programada.</p>}</div>}
  </section>
}
