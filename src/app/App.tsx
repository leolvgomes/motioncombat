import { ArrowUpRight, Bot, Camera, ChevronRight, CircleHelp, Clock3, Focus, LockKeyhole, Monitor, MoveUpRight, ScanLine, ShieldCheck, Swords } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { CameraPanel } from '../features/camera/CameraPanel'
import { DiagnosticsPanel } from '../features/motion-tracking/DiagnosticsPanel'
import { ErrorBoundary } from './ErrorBoundary'

const guideSteps = [
  { number: '01', Icon: Camera, title: 'Permita a câmera', description: 'Inicie a sessão e autorize o acesso à webcam no seu navegador.' },
  { number: '02', Icon: Focus, title: 'Encontre seu espaço', description: 'Comece a 1,5–2 m da câmera, com o tronco e os braços visíveis.' },
  { number: '03', Icon: MoveUpRight, title: 'Mova-se naturalmente', description: 'Levante os braços e acompanhe os pontos do seu corpo na tela.' },
]

function Laboratory() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#laboratorio">Ir para o laboratório</a>
      <aside className="icon-rail" aria-label="Navegação do projeto">
        <Brand compact />
        <nav className="rail-navigation" aria-label="Fases de desenvolvimento">
          <a className="rail-item is-current" href="#laboratorio" aria-current="page" title="Laboratório de movimento"><ScanLine size={21} /><span className="sr-only">Laboratório de movimento</span></a>
          <button className="rail-item" disabled title="Robô 3D · disponível na fase 2" aria-label="Robô 3D · disponível na fase 2"><Bot size={21} /><LockKeyhole className="rail-lock" size={8} /></button>
          <button className="rail-item" disabled title="Combate · disponível na fase 5" aria-label="Combate · disponível na fase 5"><Swords size={20} /><LockKeyhole className="rail-lock" size={8} /></button>
        </nav>
        <a className="rail-item rail-help" href="#guia" title="Guia de início"><CircleHelp size={20} /><span className="sr-only">Guia de início</span></a>
        <span className="rail-version">0.1</span>
      </aside>

      <div className="workspace">
        <header className="global-header">
          <Brand />
          <div className="header-product"><span className="header-divider" /><span>MOTION LAB</span><span className="version-tag">v0.1.0</span></div>
          <div className="environment-status"><span className="environment-dot" /><span>SESSÃO LOCAL</span><span className="environment-separator" /><Monitor size={13} /><span>NO NAVEGADOR</span></div>
        </header>

        <main className="main-content" id="laboratorio">
          <div className="breadcrumbs" aria-label="Localização"><span>WORKSPACE</span><ChevronRight size={11} /><span>MOTION LAB</span></div>
          <section className="workspace-intro" aria-labelledby="workspace-title">
            <div><div className="section-eyebrow"><span />SEU CORPO. SEU CONTROLE.</div><h1 id="workspace-title">Laboratório de movimento<span className="title-period">.</span></h1><p>Seu movimento é o início de tudo. Conecte seu corpo ao sistema.</p></div>
            <div className="phase-chip"><span className="phase-number">01</span><div><span>FASE ATUAL</span><strong>Fundação & tracking</strong></div></div>
          </section>

          <div className="laboratory-grid">
            <CameraPanel />
            <DiagnosticsPanel />
          </div>

          <section className="getting-started" id="guia" aria-labelledby="guide-title">
            <div className="guide-heading"><div><div className="section-eyebrow">COMECE POR AQUI</div><h2 id="guide-title">Pronto para sincronizar?</h2></div><span className="guide-duration"><Clock3 size={13} />Menos de um minuto para começar</span></div>
            <div className="guide-steps">{guideSteps.map(({ number, Icon, title, description }) => <article className="guide-step" key={number}><div className="guide-icon"><Icon size={21} strokeWidth={1.5} /></div><div><span className="step-number">PASSO {number}</span><h3>{title}</h3><p>{description}</p></div></article>)}</div>
            <div className="guide-lighting"><span className="lighting-symbol" aria-hidden="true">✳</span>Uma boa iluminação e um fundo livre ajudam o rastreamento.<a href="#laboratorio">Tudo pronto <ArrowUpRight size={13} /></a></div>
          </section>

          <footer className="workspace-footer"><p><ShieldCheck size={14} /> Seu movimento fica com você.<span>Processamento local, sem gravação ou envio de vídeo.</span></p><div className="phase-roadmap" aria-label="Próximas fases"><span className="is-active"><span className="roadmap-dot" />01 <span>Tracking</span></span><ChevronRight size={11} /><span><LockKeyhole size={10} />02 <span>Robô 3D</span></span><ChevronRight size={11} /><span><LockKeyhole size={10} />03 <span>Gestos</span></span></div></footer>
        </main>
      </div>
    </div>
  )
}

export function App() {
  return <ErrorBoundary><Laboratory /></ErrorBoundary>
}
