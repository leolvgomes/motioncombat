import { Activity, ArrowRightLeft, ChevronDown, Layers3, SlidersHorizontal } from 'lucide-react'
import { Toggle } from '../../components/ui/Toggle'
import { useAnimationStore } from '../../stores/animation-store'
import { useRobotStore } from '../../stores/robot-store'

const stateLabels = {
  IDLE: 'Repouso',
  TRACKING: 'Espelhamento',
  GUARD: 'Guarda',
  DODGE: 'Esquiva',
  PUNCH_LEFT: 'Soco esquerdo do robô',
  PUNCH_RIGHT: 'Soco direito do robô',
  RETURNING: 'Retornando ao corpo',
}

const phaseLabels = {
  windup: 'Preparação',
  strike: 'Extensão do golpe',
  recovery: 'Recolhimento',
}

function multiplier(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}×`
}

export function HybridAnimationPanel() {
  const snapshot = useAnimationStore((state) => state.snapshot)
  const hybridEnabled = useAnimationStore((state) => state.hybridEnabled)
  const durationScale = useAnimationStore((state) => state.durationScale)
  const intensity = useAnimationStore((state) => state.intensity)
  const demoRoutine = useAnimationStore((state) => state.demoRoutine)
  const setHybridEnabled = useAnimationStore((state) => state.setHybridEnabled)
  const setDurationScale = useAnimationStore((state) => state.setDurationScale)
  const setIntensity = useAnimationStore((state) => state.setIntensity)
  const setDemoRoutine = useAnimationStore((state) => state.setDemoRoutine)
  const demo = useRobotStore((state) => state.mode === 'demo')
  const sourceStatus = useRobotStore((state) => state.sourceStatus)
  const hasAttack = snapshot !== null && snapshot.attackSide !== null
  const progress = hasAttack ? Math.max(0, Math.min(1, snapshot.progress)) : 0
  const activeArm = snapshot?.attackSide === 'left' ? 'Braço esquerdo' : snapshot?.attackSide === 'right' ? 'Braço direito' : null
  const phase = snapshot?.state === 'RETURNING' ? 'Retorno gradual'
    : snapshot?.phase ? phaseLabels[snapshot.phase] : 'Nenhum golpe em curso'
  const oppositeArm = demo ? 'O braço oposto segue a pose de demonstração.'
    : sourceStatus === 'tracking' || sourceStatus === 'partial' ? 'O braço oposto continua acompanhando seu corpo.'
      : 'O braço oposto mantém a postura de repouso.'

  return <section className="hybrid-animation-panel" aria-labelledby="hybrid-animation-title">
    <div className="hybrid-panel-heading">
      <div>
        <span className="panel-eyebrow"><Layers3 size={13} aria-hidden="true" />ANIMAÇÃO HÍBRIDA · FASE 04</span>
        <h2 id="hybrid-animation-title">Controle de animação</h2>
        <p>Seu corpo conduz o robô. Cada soco ganha um movimento próprio.</p>
      </div>
      <span className={`hybrid-mode-badge ${hybridEnabled ? 'is-enabled' : ''}`}><span className="status-dot" />{hybridEnabled ? 'Animações habilitadas' : 'Espelhamento direto'}</span>
    </div>

    <div className="hybrid-panel-grid">
      <div className="hybrid-state-panel">
        <div className="hybrid-section-label"><Activity size={14} aria-hidden="true" />ESTADO VISUAL DO ROBÔ</div>
        <div className="hybrid-current-state" role="status">
          <strong>{snapshot ? stateLabels[snapshot.state] : 'Aguardando visualização 3D'}</strong>
          <span className={hasAttack ? 'is-attacking' : ''}>{phase}</span>
        </div>
        <div className="hybrid-progress-label"><span>Progresso do golpe</span><strong>{hasAttack ? `${Math.round(progress * 100)}%` : '—'}</strong></div>
        <div className={`hybrid-progress ${hasAttack ? 'is-active' : ''}`} role={hasAttack ? 'progressbar' : undefined} aria-label="Progresso da animação de soco" aria-valuemin={hasAttack ? 0 : undefined} aria-valuemax={hasAttack ? 100 : undefined} aria-valuenow={hasAttack ? Math.round(progress * 100) : undefined}><span style={{ transform: `scaleX(${progress})` }} /></div>
        <p className="hybrid-mask-note"><ArrowRightLeft size={15} aria-hidden="true" /><span>{activeArm ? `${activeArm} sob controle da animação. ${oppositeArm}` : 'Braços e tronco disponíveis para o espelhamento contínuo.'}</span></p>
        {demo && <div className="hybrid-demo-routine">
          <label htmlFor="hybrid-demo-routine">Rotina de demonstração</label>
          <div><select id="hybrid-demo-routine" value={demoRoutine} onChange={(event) => setDemoRoutine(event.target.value === 'punches' ? 'punches' : 'motion')}><option value="motion">Explorar articulações</option><option value="punches">Sequência de socos</option></select><ChevronDown size={13} aria-hidden="true" /></div>
          <small>Movimentos programados. Use Pausar no painel do robô para interromper.</small>
        </div>}
      </div>

      <div className="hybrid-settings-panel">
        <div className="hybrid-section-label"><SlidersHorizontal size={14} aria-hidden="true" />AJUSTES DO MOVIMENTO</div>
        <div className="hybrid-enable-control"><Toggle label="Animações de soco" checked={hybridEnabled} onChange={() => setHybridEnabled(!hybridEnabled)} /><p>Desative para comparar com o espelhamento contínuo.</p></div>
        <div className="hybrid-slider-setting">
          <div><label htmlFor="hybrid-duration">Duração do golpe</label><output htmlFor="hybrid-duration">{multiplier(durationScale)}</output></div>
          <input id="hybrid-duration" type="range" min={0.75} max={1.35} step={0.05} value={durationScale} onChange={(event) => setDurationScale(event.target.valueAsNumber)} />
          <div className="hybrid-slider-scale"><span>Mais rápido</span><span>Mais lento</span></div>
        </div>
        <div className="hybrid-slider-setting">
          <div><label htmlFor="hybrid-intensity">Amplitude</label><output htmlFor="hybrid-intensity">{multiplier(intensity)}</output></div>
          <input id="hybrid-intensity" type="range" min={0.6} max={1.3} step={0.05} value={intensity} onChange={(event) => setIntensity(event.target.valueAsNumber)} />
          <div className="hybrid-slider-scale"><span>Contida</span><span>Ampla</span></div>
        </div>
        <p className="hybrid-settings-note">Duração e amplitude são aplicadas ao próximo soco. Aguarde o golpe terminar antes de atacar novamente.</p>
      </div>
    </div>

    <details className="hybrid-technical-details">
      <summary><span><Activity size={13} aria-hidden="true" />Diagnóstico da transição</span><ChevronDown size={13} aria-hidden="true" /></summary>
      <div className="hybrid-technical-content">
        <dl><div><dt>Janela técnica do golpe</dt><dd className={snapshot?.hitActive ? 'is-active' : ''}>{snapshot ? snapshot.hitActive ? 'Ativa' : 'Inativa' : '—'}</dd></div><div><dt>Peso da animação</dt><dd>{snapshot ? `${Math.round(snapshot.blendWeight * 100)}%` : '—'}</dd></div><div><dt>Origem do golpe</dt><dd>{snapshot?.source === 'gesture' ? 'Movimento corporal' : snapshot?.source === 'demo' ? 'Demonstração' : '—'}</dd></div></dl>
        <p>A janela é um marcador temporal da animação. Esta fase não possui adversário ou cálculo de dano.</p>
      </div>
    </details>
  </section>
}
