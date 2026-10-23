import { ArrowUpRight, Bot, Camera, Check, ChevronRight, CircleHelp, Clock3, Focus, LockKeyhole, Monitor, MoveUpRight, ScanLine, ShieldCheck, Swords } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { CameraPanel } from '../features/camera/CameraPanel'
import { DiagnosticsPanel } from '../features/motion-tracking/DiagnosticsPanel'
import { RobotPanel } from '../features/robot/RobotPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { CombatMotionPanel } from '../features/motion-tracking/CombatMotionPanel'

const guideSteps = [
  { number: '01', Icon: Camera, title: 'Escolha como sincronizar', description: 'Inicie a câmera para usar seu corpo ou explore a demonstração sem webcam.' },
  { number: '02', Icon: Focus, title: 'Encontre seu espaço', description: 'Comece a 1,5–2 m da câmera, com o tronco e os braços visíveis.' },
  { number: '03', Icon: MoveUpRight, title: 'Calibre e assuma a guarda', description: 'Siga as duas etapas de calibração. Depois teste guarda, esquiva e um soco de cada vez.' },
]

function Laboratory() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#laboratorio">Ir para o laboratório</a>
      <aside className="icon-rail" aria-label="Navegação do projeto">
        <Brand compact />
        <nav className="rail-navigation" aria-label="Fases de desenvolvimento">
          <a className="rail-item" href="#camera-title" title="Captura de movimento"><ScanLine size={21} /><span className="sr-only">Captura de movimento</span></a>
          <a className="rail-item" href="#robot-title" title="Robô e espelhamento 3D"><Bot size={21} /><span className="sr-only">Robô e espelhamento 3D</span></a>
          <a className="rail-item is-current" href="#motion-engine-title" aria-current="page" title="Calibração e gestos"><Focus size={21} /><span className="sr-only">Calibração e gestos</span></a>
          <button className="rail-item" disabled title="Combate · disponível na fase 5" aria-label="Combate · disponível na fase 5"><Swords size={20} /><LockKeyhole className="rail-lock" size={8} /></button>
        </nav>
        <a className="rail-item rail-help" href="#guia" title="Guia de início"><CircleHelp size={20} /><span className="sr-only">Guia de início</span></a>
        <span className="rail-version">0.3</span>
      </aside>

      <div className="workspace">
        <header className="global-header">
          <Brand />
          <div className="header-product"><span className="header-divider" /><span>MOTION LAB</span><span className="version-tag">v0.3.0</span></div>
          <div className="environment-status"><span className="environment-dot" /><span>SESSÃO LOCAL</span><span className="environment-separator" /><Monitor size={13} /><span>NO NAVEGADOR</span></div>
        </header>

        <main className="main-content robot-workspace" id="laboratorio">
          <div className="breadcrumbs" aria-label="Localização"><span>WORKSPACE</span><ChevronRight size={11} /><span>MOTION LAB</span></div>
          <section className="workspace-intro" aria-labelledby="workspace-title">
            <div><div className="section-eyebrow"><span />SEU CORPO. SEU CONTROLE.</div><h1 id="workspace-title">Laboratório de movimento<span className="title-period">.</span></h1><p>Do seu corpo ao robô. Explore o espelhamento em tempo real.</p></div>
            <div className="phase-chip"><span className="phase-number">03</span><div><span>FASE ATUAL</span><strong>Calibração & gestos</strong></div></div>
          </section>

          <div className="laboratory-grid robot-laboratory">
            <CameraPanel />
            <RobotPanel />
            <CombatMotionPanel />
            <DiagnosticsPanel />
          </div>

          <section className="getting-started" id="guia" aria-labelledby="guide-title">
            <div className="guide-heading"><div><div className="section-eyebrow">COMECE POR AQUI</div><h2 id="guide-title">Pronto para sincronizar?</h2></div><span className="guide-duration"><Clock3 size={13} />Menos de um minuto para começar</span></div>
            <div className="guide-steps">{guideSteps.map(({ number, Icon, title, description }) => <article className="guide-step" key={number}><div className="guide-icon"><Icon size={21} strokeWidth={1.5} /></div><div><span className="step-number">PASSO {number}</span><h3>{title}</h3><p>{description}</p></div></article>)}</div>
            <div className="guide-lighting"><span className="lighting-symbol" aria-hidden="true">✳</span>Uma boa iluminação e um fundo livre ajudam o rastreamento.<a href="#laboratorio">Tudo pronto <ArrowUpRight size={13} /></a></div>
          </section>

          <footer className="workspace-footer"><p><ShieldCheck size={14} /> Seu movimento fica com você.<span>Processamento local, sem gravação ou envio de vídeo.</span></p><div className="phase-roadmap" aria-label="Progresso das fases"><span className="is-complete"><Check size={10} />02 <span>Robô 3D</span></span><ChevronRight size={11} /><span className="is-active"><span className="roadmap-dot" />03 <span>Gestos</span></span><ChevronRight size={11} /><span><LockKeyhole size={10} />04 <span>Animações</span></span></div></footer>
        </main>
      </div>
    </div>
  )
}

export function App() {
  return <ErrorBoundary><Laboratory /></ErrorBoundary>
}
