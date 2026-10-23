import { Activity, ChevronDown, Cpu, Gauge, ScanLine, Settings2, Waves, Zap } from 'lucide-react'
import { Toggle } from '../../components/ui/Toggle'
import { LANDMARK_VISIBILITY_THRESHOLD } from '../../engine/motion/pose-processor'
import { useLabStore } from '../../stores/lab-store'
import type { Resolution } from '../../stores/lab-store'

const confidenceSegments = Array.from({ length: 24 }, (_, index) => index)
const landmarkGroups = [
  { label: 'Ombros', indices: [11, 12] },
  { label: 'Cotovelos', indices: [13, 14] },
  { label: 'Punhos', indices: [15, 16] },
  { label: 'Quadril', indices: [23, 24] },
] as const

export function DiagnosticsPanel() {
  const session = useLabStore((state) => state.session)
  const pose = useLabStore((state) => state.pose)
  const metrics = useLabStore((state) => state.metrics)
  const resolution = useLabStore((state) => state.resolution)
  const setResolution = useLabStore((state) => state.setResolution)
  const showGuide = useLabStore((state) => state.showGuide)
  const toggleGuide = useLabStore((state) => state.toggleGuide)
  const running = session.status === 'running'
  const hasMetrics = running && metrics !== null && metrics.resolution !== '—'
  const livePose = running ? pose : null
  const confidence = livePose ? Math.round(livePose.confidence * 100) : null
  const active = livePose?.status === 'tracking'
  const busy = session.status !== 'idle' && session.status !== 'error'
  const status = session.status === 'idle' ? 'Aguardando câmera'
    : session.status === 'error' ? 'Sessão interrompida'
      : !running ? 'Preparando sessão'
        : active ? 'Rastreamento ativo'
          : livePose?.status === 'partial' ? 'Visibilidade parcial' : 'Procurando corpo'

  return <aside className="diagnostics-stack" aria-label="Diagnóstico e configurações">
    <section className="diagnostics-panel" aria-labelledby="diagnostics-title">
      <div className="diagnostics-heading"><h2 id="diagnostics-title"><Activity size={16} />Diagnóstico</h2><span className="diagnostics-realtime">TEMPO REAL</span></div>
      <div className="tracking-summary"><div className={`tracking-status ${active ? 'is-active' : ''}`} role="status"><span className="status-dot" />{status}</div><p>{running ? 'Dados capturados nesta sessão' : 'Inicie a câmera para receber dados'}</p></div>
      <div className="confidence-block"><div className="confidence-label"><span>Confiança da pose</span><strong>{confidence ?? '—'}<small>%</small></strong></div><div className="confidence-meter" role="meter" aria-label="Confiança da pose" aria-valuemin={0} aria-valuemax={100} aria-valuenow={confidence ?? undefined} aria-valuetext={confidence === null ? 'Ainda sem dados' : `${confidence}%`}>{confidenceSegments.map((index) => <span key={index} className={confidence !== null && index < Math.round(confidence / 100 * confidenceSegments.length) ? 'is-filled' : ''} />)}</div><div className="confidence-hint"><span>BAIXA</span><span>ALTA</span></div></div>

      <div className="diagnostic-metrics">
        <div className="metric-row"><span className="metric-icon"><Gauge size={15} /></span><div><span>Renderização</span><small>Objetivo: 60 FPS</small></div><strong>{hasMetrics ? Math.round(metrics.renderFps) : '—'}<small>FPS</small></strong></div>
        <div className="metric-row"><span className="metric-icon"><Waves size={15} /></span><div><span>Rastreamento</span><small>Alvo do agendador: 24 Hz</small></div><strong>{hasMetrics ? Math.round(metrics.inferenceFps) : '—'}<small>Hz</small></strong></div>
        <div className="metric-row"><span className="metric-icon"><Zap size={15} /></span><div><span>Inferência</span><small>Tempo médio por detecção</small></div><strong>{hasMetrics ? metrics.inferenceMs.toFixed(1) : '—'}<small>ms</small></strong></div>
      </div>

      <div className="landmarks-block"><div className="diagnostic-section-title"><span><ScanLine size={12} />PONTOS VISÍVEIS</span><strong>{livePose?.upperBodyVisibleCount ?? '—'}<small>/ 9</small></strong></div><div className="landmark-groups">{landmarkGroups.map(({ label, indices }) => <div className="landmark-group" key={label}><span>{label}</span><div aria-label={`${label}: ${livePose ? indices.reduce((count, index) => count + Number((livePose.visibility[index] ?? 0) >= LANDMARK_VISIBILITY_THRESHOLD), 0) : 'sem dados'} de 2 visíveis`}>{indices.map((index) => <span key={index} className={`landmark-dot ${livePose && (livePose.visibility[index] ?? 0) >= LANDMARK_VISIBILITY_THRESHOLD ? 'is-visible' : ''}`} />)}</div></div>)}</div><p className="landmarks-note">Cabeça + 8 pontos do tronco e braços.</p></div>
    </section>

    <section className="configuration-panel" aria-labelledby="configuration-title"><h2 id="configuration-title"><Settings2 size={15} />Configuração da sessão</h2><label className="resolution-label" htmlFor="resolution">Resolução da câmera</label><div className="resolution-select"><select id="resolution" value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)} disabled={busy}><option value="720p">1280 × 720 · HD</option><option value="480p">640 × 480 · Leve</option></select><ChevronDown size={14} aria-hidden="true" /></div><p className="resolution-note">{busy ? 'Interrompa a câmera para alterar.' : 'Reduza a resolução se houver lentidão.'}</p><div className="guide-toggle"><Toggle label="Guia de enquadramento" checked={showGuide} onChange={toggleGuide} /></div><div className="model-details"><Cpu size={15} /><div><span>MediaPipe Pose Landmarker</span><small>MODELO LITE · {session.delegate === 'GPU' ? 'GPU' : session.delegate === 'CPU' ? 'CPU' : 'LOCAL'}</small></div><span className="local-chip">ON-DEVICE</span></div></section>
  </aside>
}
