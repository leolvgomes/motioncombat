import { Activity, ArrowLeftRight, Crosshair, Hand, RotateCcw, Shield, Target, X } from 'lucide-react'
import { useCombatMotionStore } from '../../stores/combat-motion-store'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { combatMotionRuntime } from './combat-motion-runtime'
import type { GestureEvent } from '../../engine/gestures/gesture-engine'

export const gestureLabels: Record<GestureEvent['type'], string> = {
  PUNCH_LEFT: 'Soco esquerdo', PUNCH_RIGHT: 'Soco direito', GUARD: 'Guarda',
  DODGE_LEFT: 'Esquiva à esquerda', DODGE_RIGHT: 'Esquiva à direita',
}

export function CombatMotionPanel() {
  const { calibration, features, posture, lastEvent, events } = useCombatMotionStore((state) => state.snapshot)
  const running = useLabStore((state) => state.session.status === 'running')
  const demo = useRobotStore((state) => state.mode === 'demo')
  const ready = calibration.stage === 'complete'
  const calibrating = calibration.stage === 'neutral' || calibration.stage === 'guard'
  const live = running && !demo
  const postureLabel = posture === 'guard' ? 'Guarda' : posture === 'dodge-left' ? 'Inclinação à esquerda' : posture === 'dodge-right' ? 'Inclinação à direita' : 'Neutra'
  const status = demo ? 'Desativado na demonstração' : !running ? 'Inicie a câmera' : calibrating ? 'Calibração em andamento' : ready ? 'Reconhecimento habilitado' : 'Calibração necessária'

  return <section className="combat-motion-panel" aria-labelledby="motion-engine-title">
    <div className="motion-panel-header"><div><span className="panel-eyebrow"><Target size={13} aria-hidden="true" />MOTION ENGINE · FASE 03</span><h2 id="motion-engine-title">Do movimento ao gesto</h2><p>Calibre seu corpo. Assuma a guarda. Teste um soco de cada vez.</p></div><span className={`motion-engine-status ${ready && live ? 'is-ready' : ''}`} role="status"><span className="status-dot" />{status}</span></div>

    <div className="motion-engine-grid">
      <div className="motion-calibration">
        <div className="motion-section-label"><Crosshair size={15} aria-hidden="true" />CALIBRAÇÃO DO CORPO</div>
        <div className="calibration-steps" aria-label="Etapas de calibração">
          <div className={calibration.stage === 'neutral' ? 'is-current' : calibration.stage === 'guard' || ready ? 'is-complete' : ''}><span>01</span><strong>Postura neutra</strong><small>Ombros relaxados e punhos visíveis à frente da cintura</small></div>
          <div className={calibration.stage === 'guard' ? 'is-current' : ready ? 'is-complete' : ''}><span>02</span><strong>Posição de guarda</strong><small>Punhos próximos ao rosto</small></div>
        </div>
        <div className="calibration-progress" role="progressbar" aria-label="Progresso da etapa de calibração" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(calibration.progress * 100)}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, calibration.progress))})` }} /></div>
        <p className="calibration-message" role="status">{demo ? 'Demonstração não gera dados de calibração ou gestos.' : !running ? 'Ligue a webcam para começar. Nenhum gesto é reconhecido antes da calibração.' : calibration.message}</p>
        <div className="calibration-actions"><button type="button" className="motion-calibrate-button" disabled={!live || calibrating} onClick={() => combatMotionRuntime.startCalibration()}><RotateCcw size={14} aria-hidden="true" />{ready ? 'Recalibrar movimentos' : 'Calibrar movimentos'}</button>{calibrating && <button type="button" className="motion-cancel-button" onClick={() => combatMotionRuntime.cancelCalibration()}><X size={14} aria-hidden="true" />Cancelar</button>}</div>
      </div>

      <div className="motion-recognition">
        <div className="motion-section-label"><Activity size={15} aria-hidden="true" />LEITURA EM TEMPO REAL</div>
        <div className="recognized-movement"><span>ÚLTIMO MOVIMENTO RECONHECIDO</span><strong>{lastEvent ? gestureLabels[lastEvent.type] : 'Aguardando seu movimento'}</strong><small>{lastEvent ? `Confiança do rastreamento: ${Math.round(lastEvent.confidence * 100)}% · lado anatômico do jogador` : 'Guarda, socos retos e inclinações laterais'}</small></div>
        <div className="motion-signal-grid"><div><Shield size={15} aria-hidden="true" /><span>Postura</span><strong>{ready && features?.valid ? postureLabel : '—'}</strong></div><div><ArrowLeftRight size={15} aria-hidden="true" /><span>Profundidade</span><strong>{!ready || !features?.valid ? '—' : features.depthAvailable ? '3D disponível' : 'Sem confiança'}</strong></div></div>
        <div className="arm-extension-grid">{(['left', 'right'] as const).map((side) => {
          const arm = side === 'left' ? features?.leftArm : features?.rightArm
          const label = side === 'left' ? 'Braço esquerdo' : 'Braço direito'
          return <div className="arm-extension" key={side}><div><span>{label}</span><strong>{arm && ready ? `${Math.round(arm.extension * 100)}%` : '—'}</strong></div><div className="extension-track"><span style={{ transform: `scaleX(${arm && ready ? arm.extension : 0})` }} /></div><small>{arm && ready ? arm.depthAvailable ? 'Extensão estimada · 3D' : 'Extensão 2D · soco indisponível' : 'Extensão estimada'}</small></div>
        })}</div>
        {events.length > 0 && <ol className="gesture-history" aria-label="Últimos gestos detectados">{events.map((event, index) => <li key={`${event.timestamp}-${event.type}-${index}`}><span>{gestureLabels[event.type]}</span><small>{Math.round(event.confidence * 100)}%</small></li>)}</ol>}
      </div>
    </div>
    <p className="motion-engine-note"><Hand size={14} aria-hidden="true" />Volte o punho à guarda entre os socos. Faça movimentos controlados e mantenha espaço à sua frente. A resposta ainda depende da visibilidade e da profundidade estimada pela webcam.</p>
  </section>
}
