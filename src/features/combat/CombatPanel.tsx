import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Activity, ChevronDown, CircleAlert, Film, Gauge, Keyboard, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Swords, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { Toggle } from '../../components/ui/Toggle'
import { rankRecords } from '../../engine/career/career'
import { comboById } from '../../engine/combat/combos'
import { useCareerStore } from '../../stores/career-store'
import { useMatchStore } from '../../stores/match-store'
import { useProfileStore, useRobotName } from '../../stores/profile-store'
import { useReplayStore } from '../../stores/replay-store'
import { useRobotStore } from '../../stores/robot-store'
import type { RobotQuality } from '../../stores/robot-store'
import { useSettingsStore } from '../../stores/settings-store'
import type { ArenaId } from '../../types/customization'
import type { ComboEvent, CombatSnapshot, FighterId, FighterStats, ImpactEvent, PauseReason } from '../../types/combat'
import { combatAudio, cueFighter, cueForEvent } from '../audio/combat-audio'
import { ARENAS, OPPONENT_NAME, sanitizeName } from '../customization/catalog'
import { announcementForEvent } from './announcements'
import type { FighterNames } from './announcements'
import { ReplayControls } from '../replay/ReplayControls'
import { matchRuntime } from './match-runtime'
import { CombatHud } from './CombatHud'
import { QualityAdvisor } from './quality-advisor'

const ArenaCanvas = lazy(() => import('../arena/ArenaCanvas'))

const pauseMessages: Record<PauseReason, string> = {
  manual: 'Retome quando estiver pronto.',
  tracking: 'Volte para a frente da câmera e faça a guarda. A luta continua sozinha, sem precisar do mouse.',
  view: 'A partida foi suspensa ao interromper a visualização da arena.',
  hidden: 'A partida foi suspensa enquanto a página ficou em segundo plano.',
}

const statisticRows: readonly { key: keyof FighterStats; label: string }[] = [
  { key: 'attacks', label: 'Golpes iniciados' },
  { key: 'hits', label: 'Acertos sem bloqueio' },
  { key: 'blocks', label: 'Bloqueios realizados' },
  { key: 'dodges', label: 'Esquivas bem-sucedidas' },
  { key: 'damage', label: 'Dano causado' },
  { key: 'combos', label: 'Combos concluídos' },
  { key: 'bestStreak', label: 'Maior sequência de acertos' },
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

function currentNames(): FighterNames {
  const name = useReplayStore.getState().playback?.meta.name ?? sanitizeName(useProfileStore.getState().name)
  return { player: name, opponent: OPPONENT_NAME }
}

function winnerLabel(snapshot: CombatSnapshot, names: FighterNames): string {
  if (snapshot.winner === 'draw') return 'Partida empatada'
  if (snapshot.winner === null) return ''
  return snapshot.mode === 'webcam' && snapshot.winner === 'player' ? `Vitória de ${names.player}` : `${names[snapshot.winner]} venceu`
}

const impactNouns = { straight: 'soco', hook: 'cruzado', uppercut: 'uppercut' } as const

function impactLabel(impact: ImpactEvent, names: FighterNames): string {
  const attacker = names[impact.attacker]
  const defender = names[impact.attacker === 'player' ? 'opponent' : 'player']
  const damage = Number.isInteger(impact.damage) ? impact.damage : impact.damage.toFixed(1)
  if (impact.result === 'hit') return `${attacker} conectou ${impactNouns[impact.kind]} · ${damage} de dano`
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
    const text = announcementForEvent(event, currentNames())
    if (!text) return
    // A combo always follows its finishing hit; keep both in the same announcement.
    if (event.type === 'combo') setMessage((previous) => `${previous.trim()} ${text}`)
    else setMessage((previous) => previous === text ? `${text}\u00a0` : text)
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
  const autoResume = useMatchStore((state) => state.autoResume)
  const armed = useMatchStore((state) => state.armed)
  const canArm = useMatchStore((state) => state.canArm)
  const playback = useReplayStore((state) => state.playback)
  const replays = useReplayStore((state) => state.replays)
  const records = useCareerStore((state) => state.records)
  const arena = useProfileStore((state) => state.arena)
  const setArena = useProfileStore((state) => state.setArena)
  const robotName = useRobotName()
  const replaying = playback !== null
  const names: FighterNames = { player: playback?.meta.name ?? robotName, opponent: OPPONENT_NAME }
  const quality = useRobotStore((state) => state.quality)
  const setQuality = useRobotStore((state) => state.setQuality)
  const { soundEnabled, volume, effectsEnabled, shakeEnabled, cinematicEnabled, bloomEnabled, setSoundEnabled, setVolume, setEffectsEnabled, setShakeEnabled, setCinematicEnabled, setBloomEnabled } = useSettingsStore()
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

  const [visibleSpecial, setVisibleSpecial] = useState<{ id: number; fighter: FighterId } | null>(null)
  useEffect(() => {
    let timer = 0
    let sequence = 0
    const unsubscribe = matchRuntime.subscribe((event) => {
      if (event.type !== 'special') return
      window.clearTimeout(timer)
      setVisibleSpecial({ id: ++sequence, fighter: event.fighter })
      timer = window.setTimeout(() => setVisibleSpecial(null), 1500)
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [])

  const [visibleCombo, setVisibleCombo] = useState<ComboEvent | null>(null)
  const comboId = snapshot.lastCombo?.id
  useEffect(() => {
    setVisibleCombo(snapshot.lastCombo)
    if (!snapshot.lastCombo) return
    const timer = window.setTimeout(() => setVisibleCombo(null), 2200)
    return () => window.clearTimeout(timer)
  }, [comboId])

  const demo = snapshot.mode === 'demo'
  const ready = snapshot.phase === 'ready'
  const finished = snapshot.phase === 'finished'
  const paused = snapshot.pauseReason !== null && !ready && !finished
  const matchReplay = finished && !replaying ? replays.find(({ meta }) => meta.id === matchRuntime.currentMatchId) : undefined
  const matchRecord = finished && !replaying && !demo ? records.find(({ id }) => id === matchRuntime.currentMatchId) : undefined
  const rankPosition = matchRecord ? rankRecords(records).findIndex(({ id }) => id === matchRecord.id) + 1 : 0
  const sceneAvailable = sceneFps !== null && Number.isFinite(sceneFps) && sceneFps > 0
  const resumeAvailable = sceneAvailable && (demo || canFight)
  const status = replaying ? playback.playing ? 'Reproduzindo replay' : 'Replay pausado' : armed ? 'Aguardando sua guarda' : paused ? 'Partida pausada' : ready ? 'Preparação' : finished ? 'Partida encerrada'
    : snapshot.phase === 'countdown' ? 'Contagem regressiva' : snapshot.phase === 'round-over' ? 'Intervalo entre rounds' : 'Combate em andamento'
  const preparation = !sceneAvailable ? 'Aguarde a visualização 3D para iniciar.'
    : !canArm ? 'Ligue a câmera e conclua a calibração para lutar.'
      : 'Rastreamento pronto. Assuma a guarda antes de iniciar.'

  // Every match command is a user gesture, the moment browsers allow audio to start.
  const command = (action: () => unknown) => () => { combatAudio.unlock(); action() }
  const toggleSound = () => {
    if (!soundEnabled) combatAudio.unlock()
    setSoundEnabled(!soundEnabled)
  }
  const togglePause = () => {
    if (replaying) { combatAudio.unlock(); matchRuntime.toggleReplay(); return }
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
    <header className="combat-panel-heading"><div><span className="panel-eyebrow"><Swords size={13} aria-hidden="true" />COMBATE LOCAL · FASE 07</span><h2 id="combat-arena-title">Arena de combate</h2></div><span className={`combat-match-status ${snapshot.phase === 'fighting' && !paused ? 'is-live' : ''}`} role="status"><span className="status-dot" />{status}</span></header>

    <div className="combat-stage">
      <ArenaBoundary key={arenaAttempt} onRetry={() => setArenaAttempt((attempt) => attempt + 1)}>
        <Suspense fallback={<div className="arena-renderer-error" role="status"><LoaderCircle className="spinning" size={28} aria-hidden="true" /><strong>Preparando a arena</strong><p>Iniciando a visualização 3D neste dispositivo.</p></div>}><ArenaCanvas /></Suspense>
      </ArenaBoundary>
      <CombatHud snapshot={snapshot} names={names} replay={replaying} />
      {armed && !replaying ? <div className="combat-stage-banner" role="status"><ShieldCheck size={26} aria-hidden="true" /><h3>Vá para a sua posição</h3><p>Fique de corpo visível na câmera e faça a guarda. A contagem de 3 s começa quando ela for reconhecida.</p>{autoResume !== null ? <><div className="combat-auto-resume" aria-hidden="true"><span style={{ transform: `scaleX(${autoResume})` }} /></div><small>Guarda reconhecida · mantenha para começar</small></> : <small>{canFight ? 'Corpo visível · levante a guarda' : 'Procurando seu corpo na câmera'}</small>}</div> : null}
      {ready && !armed && <div className="combat-lobby-copy"><span>{names.player} × {names.opponent}</span><h3>Seu movimento.<br />Seu lugar no ringue.</h3><p>Calibre seu corpo e enfrente uma IA em uma melhor de três.</p></div>}
      {replaying ? null : paused ? <div className="combat-stage-banner" role="status"><Pause size={23} aria-hidden="true" /><h3>{snapshot.pauseReason === 'manual' ? 'Combate pausado' : snapshot.pauseReason === 'tracking' ? 'Você saiu do quadro' : 'Pausa de segurança'}</h3><p>{snapshot.pauseReason ? pauseMessages[snapshot.pauseReason] : ''}</p>{snapshot.pauseReason === 'tracking' && autoResume !== null ? <><div className="combat-auto-resume" aria-hidden="true"><span style={{ transform: `scaleX(${autoResume})` }} /></div><small>Guarda reconhecida · mantenha para voltar</small></> : <small>{snapshot.pauseReason === 'tracking' ? 'Ou use Retomar abaixo da arena.' : 'Use Retomar abaixo da arena para continuar.'}</small>}</div>
        : snapshot.phase === 'countdown' ? <div className="combat-countdown"><span>{demo ? 'INICIANDO DEMONSTRAÇÃO' : 'PREPARE A GUARDA'}</span><strong>{Math.max(1, Math.ceil(snapshot.countdown))}</strong></div>
          : snapshot.phase === 'round-over' ? <div className="combat-stage-banner is-outcome"><ShieldCheck size={26} aria-hidden="true" /><h3>{snapshot.roundWinner === 'draw' ? 'Round empatado' : `${snapshot.roundWinner ? names[snapshot.roundWinner] : ''} venceu o round`}</h3><p>Placar {snapshot.playerWins} × {snapshot.opponentWins}</p><small>{snapshot.betweenRoundsLeft > 0 ? `Próximo round em ${Math.ceil(snapshot.betweenRoundsLeft)} s` : 'Preparando o próximo round'}</small></div>
            : finished && !armed && <div className={`combat-stage-banner is-outcome is-result ${snapshot.winner === 'player' ? 'is-victory' : ''}`}><Trophy size={30} aria-hidden="true" /><span>{demo ? 'DEMONSTRAÇÃO CONCLUÍDA' : 'RESULTADO DA PARTIDA'}</span><h3>{winnerLabel(snapshot, names)}</h3><p>Placar final <strong>{snapshot.playerWins} × {snapshot.opponentWins}</strong></p>{matchRecord && <small>{matchRecord.score} pontos{rankPosition > 0 ? ` · ${rankPosition}º no ranking local` : ''}</small>}</div>}
      {/* Visual toast only; the live region below narrates the same events once. */}
      {visibleImpact && !ready && !finished && (!paused || replaying) && <div className={`combat-impact is-${visibleImpact.result}`} aria-hidden="true">{impactLabel(visibleImpact, names)}</div>}
      {visibleCombo && !ready && !finished && (!paused || replaying) && <div className={`combat-combo ${visibleCombo.fighter === 'opponent' ? 'is-opponent' : ''}`} aria-hidden="true"><span>{names[visibleCombo.fighter]}</span><strong>{comboById(visibleCombo.combo).name}</strong><small>COMBO · +{visibleCombo.bonus} DE DANO</small></div>}
      {visibleSpecial && !ready && !finished && (!paused || replaying) && <div key={visibleSpecial.id} className={`combat-special ${visibleSpecial.fighter === 'opponent' ? 'is-opponent' : ''}`} aria-hidden="true"><small>{names[visibleSpecial.fighter]}</small><strong>SOBRECARGA</strong></div>}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <div className={`combat-source-badge ${replaying || demo && !ready ? 'is-demo' : ''}`}>{replaying ? `Replay · ${demo ? 'demonstração IA × IA' : 'partida com webcam'}` : demo && !ready ? 'IA × IA · movimentos programados' : ready ? 'Controle corporal ou demonstração' : `Webcam · seus movimentos controlam ${names.player}`}</div>
    </div>

    <div className="combat-controls">
      {replaying ? <ReplayControls playback={playback} /> : <div className="combat-match-actions">
        {armed ? <button className="combat-secondary-action" type="button" onClick={() => matchRuntime.disarm()}><X size={14} aria-hidden="true" />Cancelar início</button>
          : ready ? <><button className="combat-primary-action" type="button" disabled={!canArm || !sceneAvailable} onClick={command(() => matchRuntime.arm())}><Swords size={15} aria-hidden="true" />Iniciar combate</button><button className="combat-secondary-action" type="button" disabled={!sceneAvailable} onClick={command(() => matchRuntime.start('demo'))}><Play size={14} aria-hidden="true" />Assistir demonstração</button></>
          : finished ? <><button className="combat-primary-action" type="button" disabled={!sceneAvailable || !demo && !canArm} onClick={command(() => demo ? matchRuntime.start('demo') : matchRuntime.arm())}><RotateCcw size={14} aria-hidden="true" />{demo ? 'Ver outra demonstração' : 'Revanche'}</button>{matchReplay && <button className="combat-secondary-action" type="button" disabled={!sceneAvailable} onClick={command(() => matchRuntime.startReplay(matchReplay))}><Film size={14} aria-hidden="true" />Ver replay</button>}<button className="combat-secondary-action" type="button" onClick={() => matchRuntime.reset()}>Voltar ao início</button></>
            : <>{paused ? <button className="combat-primary-action" type="button" disabled={!resumeAvailable} aria-keyshortcuts="P" onClick={command(() => matchRuntime.resume())}><Play size={14} aria-hidden="true" />Retomar</button> : <button className="combat-secondary-action" type="button" aria-keyshortcuts="P" onClick={() => matchRuntime.pause()}><Pause size={14} aria-hidden="true" />Pausar</button>}<button className="combat-secondary-action is-subtle" type="button" onClick={() => matchRuntime.reset()}>Voltar ao início</button></>}
      </div>}
      <div className="combat-display-settings"><span className="combat-scene-fps"><Activity size={13} aria-hidden="true" /><strong>{sceneFps === null ? '—' : Math.round(sceneFps)}</strong>FPS DA ARENA</span><label className="combat-quality-label" htmlFor="combat-arena">Cenário</label><div className="combat-quality-select"><select id="combat-arena" value={playback?.meta.arena ?? arena} disabled={replaying} onChange={(event) => setArena(event.target.value as ArenaId)}>{ARENAS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div><label className="combat-quality-label" htmlFor="combat-quality">Qualidade 3D</label><div className="combat-quality-select"><select id="combat-quality" value={quality} onChange={(event) => setQuality(event.target.value as RobotQuality)}><option value="balanced">Equilibrada</option><option value="light">Leve</option></select><ChevronDown size={13} aria-hidden="true" /></div></div>
    </div>
    {suggestLight && !suggestionDismissed && quality === 'balanced' && <div className="combat-quality-hint" role="status"><Gauge size={15} aria-hidden="true" /><p>A arena está abaixo de 42 FPS há alguns segundos. A qualidade Leve reduz resolução e sombras.</p><button type="button" className="combat-secondary-action" onClick={() => setQuality('light')}>Usar qualidade Leve</button><button type="button" className="combat-hint-dismiss" aria-label="Dispensar sugestão de qualidade" onClick={() => setSuggestionDismissed(true)}><X size={14} aria-hidden="true" /></button></div>}
    <div className="combat-feedback-settings" role="group" aria-labelledby="combat-feedback-title">
      <span id="combat-feedback-title" className="combat-feedback-title">SOM E EFEITOS</span>
      <button type="button" className={`combat-sound-toggle ${soundEnabled ? 'is-on' : ''}`} aria-pressed={soundEnabled} aria-keyshortcuts="M" onClick={toggleSound}>{soundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}{soundEnabled ? 'Som ligado' : 'Som desligado'}</button>
      <label className="combat-volume"><span>Volume</span><input type="range" min={0} max={100} step={5} value={volumePercent} disabled={!soundEnabled} aria-valuetext={`${volumePercent}%`} onChange={(event) => setVolume(Number(event.target.value) / 100)} /><output aria-hidden="true">{volumePercent}%</output></label>
      <Toggle label="Faíscas de impacto" checked={effectsEnabled} onChange={() => setEffectsEnabled(!effectsEnabled)} />
      <Toggle label="Tremor de câmera" checked={shakeEnabled && !reducedMotion} onChange={() => setShakeEnabled(!shakeEnabled)} />
      <Toggle label="Câmera lenta no nocaute" checked={cinematicEnabled && !reducedMotion} onChange={() => setCinematicEnabled(!cinematicEnabled)} />
      <Toggle label="Brilho cinematográfico" checked={bloomEnabled && quality === 'balanced'} onChange={() => setBloomEnabled(!bloomEnabled)} />
      {reducedMotion && <small className="combat-feedback-note">Movimento reduzido ativo no sistema: o tremor e a câmera lenta ficam desligados e as faíscas são atenuadas.</small>}
      {bloomEnabled && quality === 'light' && <small className="combat-feedback-note">O brilho cinematográfico só funciona na qualidade Equilibrada.</small>}
      {bloomEnabled && quality === 'balanced' && <small className="combat-feedback-note">O brilho pesa em placas de vídeo integradas. Desligue se o FPS da arena cair.</small>}
      <p className="combat-shortcuts"><Keyboard size={14} aria-hidden="true" />Atalhos: <kbd>P</kbd> pausar ou retomar · <kbd>M</kbd> ligar ou desligar o som</p>
    </div>
    {!replaying && (ready || paused && !demo && !canFight || finished && !demo && !canFight) && <p className="combat-readiness" role="status"><ShieldCheck size={14} aria-hidden="true" />{preparation}</p>}
    {finished && !replaying && <div className="combat-results"><table><caption>Estatísticas da partida</caption><thead><tr><th scope="col">Desempenho</th><th scope="col">{names.player}</th><th scope="col">{names.opponent}</th></tr></thead><tbody>{statisticRows.map(({ key, label }) => <tr key={key}><th scope="row">{label}</th><td>{key === 'damage' ? Math.round(snapshot.playerStats[key] * 10) / 10 : snapshot.playerStats[key]}</td><td>{key === 'damage' ? Math.round(snapshot.opponentStats[key] * 10) / 10 : snapshot.opponentStats[key]}</td></tr>)}</tbody></table>{demo && <p>Estatísticas de duas IAs em demonstração programada. Não contam para a carreira.</p>}</div>}
  </section>
}
