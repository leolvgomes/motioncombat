import { Gauge } from 'lucide-react'
import type { Distribution, PerformanceReport } from '../../engine/motion/performance-sampler'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { useTrialStore } from '../../stores/trial-store'
import { trialRuntime } from './trial-runtime'

function value({ median, low, high }: Distribution, unit: string): string {
  return `${median} ${unit} (${low}–${high})`
}

export function PerformanceSummary({ report, title }: { report: PerformanceReport; title: string }) {
  return <dl className="performance-summary" aria-label={title}>
    <div><dt>Cena 3D</dt><dd>{report.sceneFps ? value(report.sceneFps, 'FPS') : '—'}</dd></div>
    <div><dt>Rastreamento</dt><dd>{value(report.trackingHz, 'Hz')}</dd></div>
    <div><dt>Inferência</dt><dd>{value(report.inferenceMs, 'ms')}</dd></div>
    <div><dt>Atraso da pose</dt><dd>{value(report.latencyMs, 'ms')}</dd></div>
    <div><dt>Pior engasgo</dt><dd>{value(report.worstFrameMs, 'ms')}</dd></div>
    <div><dt>Execução</dt><dd>{report.threaded ? 'Segundo plano' : 'Na página'}</dd></div>
  </dl>
}

/** Lives with the diagnostics, so it can measure both the arena and the laboratory. */
export function PerformanceMeasure() {
  const running = useLabStore((state) => state.session.status === 'running')
  const gpu = useLabStore((state) => state.gpu)
  const demo = useRobotStore((state) => state.mode === 'demo')
  const measuring = useTrialStore((state) => state.measuring)
  const performance = useTrialStore((state) => state.performance)
  const error = useTrialStore((state) => state.performanceError)
  return <section className="configuration-panel performance-panel" aria-labelledby="performance-title">
    <h2 id="performance-title"><Gauge size={15} />Desempenho</h2>
    <p className="resolution-note">GPU em uso: <strong>{gpu?.name ?? 'não informada pelo navegador'}</strong></p>
    {gpu?.software && <p className="expansion-warning" role="status">A aceleração gráfica está desligada. Ative-a nas configurações do navegador.</p>}
    {gpu?.integrated && <p className="expansion-warning" role="status">O navegador usa a GPU integrada. Se o computador tem placa dedicada, no Windows abra Configurações → Sistema → Tela → Elementos gráficos, escolha <strong>Alto desempenho</strong> para o navegador e reinicie-o.</p>}
    <button className="combat-secondary-action" type="button" disabled={!running || demo || measuring !== null} onClick={() => trialRuntime.measure()}>
      {measuring ? `Medindo… ${Math.ceil((measuring.totalMs - measuring.elapsedMs) / 1000)} s` : 'Medir por 15 s'}
    </button>
    <p className="resolution-note">{running ? 'Mede a cena aberta agora, com a câmera ligada. Entre parênteses, a faixa típica.' : 'Ligue a câmera para medir.'}</p>
    {error && <p className="expansion-warning" role="status">{error}</p>}
    {performance && <PerformanceSummary report={performance} title="Resultado da medição" />}
  </section>
}
