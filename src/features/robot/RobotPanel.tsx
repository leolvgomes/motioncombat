import { Component, Suspense, lazy, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Bot, Box, Camera, ChevronDown, CircleAlert, Eye, Gauge, LoaderCircle, Pause, Play, RotateCcw, ScanLine } from 'lucide-react'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { useAnimationStore } from '../../stores/animation-store'
import type { RobotQuality } from '../../stores/robot-store'

const RobotCanvas = lazy(() => import('./RobotCanvas'))

class SceneBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na visualização 3D:', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <div className="robot-scene-message is-error" role="alert">
        <CircleAlert size={27} aria-hidden="true" />
        <h3>A visualização 3D foi interrompida</h3>
        <p>Verifique a aceleração gráfica do navegador e tente abrir a cena novamente.</p>
        <button className="robot-secondary-button" type="button" onClick={this.props.onRetry}><RotateCcw size={14} aria-hidden="true" />Tentar novamente</button>
      </div>
    }
    return this.props.children
  }
}

export function RobotPanel() {
  const mode = useRobotStore((state) => state.mode)
  const quality = useRobotStore((state) => state.quality)
  const paused = useRobotStore((state) => state.paused)
  const view = useRobotStore((state) => state.view)
  const sceneFps = useRobotStore((state) => state.sceneFps)
  const sourceStatus = useRobotStore((state) => state.sourceStatus)
  const setMode = useRobotStore((state) => state.setMode)
  const setQuality = useRobotStore((state) => state.setQuality)
  const setPaused = useRobotStore((state) => state.setPaused)
  const setView = useRobotStore((state) => state.setView)
  const sessionStatus = useLabStore((state) => state.session.status)
  // Subscribe only to semantic changes, rather than each published progress value.
  const animationState = useAnimationStore((state) => state.snapshot?.state ?? null)
  const animationPhase = useAnimationStore((state) => state.snapshot?.phase ?? null)
  const animationSide = useAnimationStore((state) => state.snapshot?.attackSide ?? null)
  const animationSource = useAnimationStore((state) => state.snapshot?.source ?? null)
  const [sceneAttempt, setSceneAttempt] = useState(0)
  const demonstration = mode === 'demo'
  const connecting = ['requesting', 'loading', 'starting'].includes(sessionStatus)
  const matchingAnimationSource = animationSource === (demonstration ? 'demo' : 'gesture')
  const punching = matchingAnimationSource && animationSide !== null
    && (animationState === 'PUNCH_LEFT' || animationState === 'PUNCH_RIGHT')
  const returning = matchingAnimationSource && animationState === 'RETURNING'
  const animating = punching || returning
  const punchSide = animationSide === 'left' ? 'esquerdo' : 'direito'
  const punchPhase = animationPhase === 'windup' ? 'preparação'
    : animationPhase === 'strike' ? 'extensão' : 'recolhimento'
  const status = demonstration ? paused ? 'Demonstração pausada'
    : punching ? `Demonstração · soco ${punchSide}`
      : returning ? 'Demonstração · retorno' : 'Demonstração'
    : punching ? `Soco ${punchSide} do robô`
      : returning ? 'Retornando ao corpo'
        : sourceStatus === 'tracking' ? 'Espelhamento ativo'
      : sourceStatus === 'partial' ? 'Visibilidade parcial'
        : sourceStatus === 'lost' ? 'Sinal interrompido'
          : connecting ? 'Conectando câmera' : 'Aguardando movimento'
  const hint = demonstration ? paused ? 'Demonstração pausada. Continue quando quiser.'
    : punching ? `Movimento programado · soco ${punchSide} do robô (${punchPhase}).`
      : returning ? 'Movimento programado · retorno suave à pose de demonstração.'
        : 'Movimentos programados · nenhum dado de webcam.'
    : punching ? `Soco ${punchSide} do robô · ${punchPhase}.`
      : returning ? 'Retornando suavemente ao espelhamento do seu corpo.'
        : sourceStatus === 'tracking' ? 'Seus braços e tronco, sincronizados em tempo real.'
      : sourceStatus === 'partial' ? 'Mantenha ombros, cotovelos e punhos visíveis.'
        : sourceStatus === 'lost' ? 'Sinal perdido. Retome o enquadramento para sincronizar.'
          : connecting ? 'Aguardando as primeiras posições da câmera.' : 'Inicie a câmera ou explore a demonstração.'

  return <section className="robot-panel" aria-labelledby="robot-title">
    <div className="panel-heading">
      <div>
        <span className="panel-eyebrow"><Bot size={13} aria-hidden="true" />ESPELHAMENTO 3D</span>
        <h2 className="panel-title" id="robot-title">Unidade ATLAS-01</h2>
      </div>
      <span className={`robot-status ${demonstration ? 'is-demo' : animating ? 'is-animating' : sourceStatus === 'tracking' ? 'is-active' : ''}`} role="status"><span className="status-dot" />{status}</span>
    </div>

    <div className="robot-source-control" role="group" aria-label="Fonte dos movimentos do robô">
      <button type="button" aria-pressed={!demonstration} onClick={() => { if (demonstration) setMode('tracking') }}><Camera size={14} aria-hidden="true" />Seus movimentos</button>
      <button type="button" aria-pressed={demonstration} onClick={() => { if (!demonstration) setMode('demo') }}><Play size={13} aria-hidden="true" />Demonstração</button>
    </div>

    <div className="robot-stage" aria-label="Visualização tridimensional do robô articulado">
      <SceneBoundary key={sceneAttempt} onRetry={() => setSceneAttempt((attempt) => attempt + 1)}>
        <Suspense fallback={<div className="robot-scene-message" role="status"><LoaderCircle className="spinning" size={28} aria-hidden="true" /><h3>Preparando o robô</h3><p>Iniciando a visualização 3D neste dispositivo.</p></div>}>
          <RobotCanvas />
        </Suspense>
      </SceneBoundary>
      <span className={`robot-stage-label ${demonstration ? 'is-demo' : ''}`}><span />{demonstration ? 'ENTRADA / DEMONSTRAÇÃO' : 'ENTRADA / WEBCAM'}</span>
      <span className="robot-fps" title="Taxa de quadros da cena 3D"><Gauge size={12} aria-hidden="true" /><strong>{sceneFps === null ? '—' : Math.round(sceneFps)}</strong>FPS 3D</span>
      <div className="robot-stage-corner is-top-left" aria-hidden="true" /><div className="robot-stage-corner is-bottom-right" aria-hidden="true" />
      <p className={`robot-stage-hint ${demonstration ? 'is-demo' : animating ? 'is-animating' : ''}`}><ScanLine size={13} aria-hidden="true" />{hint}</p>
    </div>

    <div className="robot-controls">
      <div className="robot-view-control" role="group" aria-label="Vista do robô">
        <button type="button" aria-pressed={view === 'front'} onClick={() => setView('front')} title="Observar o robô de frente"><Eye size={14} aria-hidden="true" />Frontal</button>
        <button type="button" aria-pressed={view === 'perspective'} onClick={() => setView('perspective')} title="Observar o robô em perspectiva"><Box size={14} aria-hidden="true" />Perspectiva</button>
      </div>
      {demonstration && <button className="robot-demo-control" type="button" onClick={() => setPaused(!paused)}>{paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}{paused ? 'Continuar' : 'Pausar'}</button>}
      <div className="robot-quality-control"><label htmlFor="robot-quality">Qualidade 3D</label><div><select id="robot-quality" value={quality} onChange={(event) => setQuality(event.target.value as RobotQuality)}><option value="balanced">Equilibrada</option><option value="light">Leve</option></select><ChevronDown size={12} aria-hidden="true" /></div></div>
    </div>
    <p className="robot-panel-note"><Bot size={13} aria-hidden="true" />Braços e tronco acompanham o corpo. As pernas mantêm uma base estável.</p>
  </section>
}
