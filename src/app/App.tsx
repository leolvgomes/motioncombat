import { ArrowUpRight, Bot, Camera, Check, ChevronRight, CircleHelp, Clock3, Focus, Layers3, LockKeyhole, Monitor, MoveUpRight, ScanLine, ShieldCheck, Swords } from 'lucide-react'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Brand } from '../components/ui/Brand'
import { CameraPanel } from '../features/camera/CameraPanel'
import { DiagnosticsPanel } from '../features/motion-tracking/DiagnosticsPanel'
import { RobotPanel } from '../features/robot/RobotPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { CombatMotionPanel } from '../features/motion-tracking/CombatMotionPanel'
import { HybridAnimationPanel } from '../features/robot/HybridAnimationPanel'
import { CombatPanel } from '../features/combat/CombatPanel'
import { matchRuntime } from '../features/combat/match-runtime'

const guideSteps = [
  { number: '01', Icon: Camera, title: 'Conecte e calibre', description: 'Para controlar ATLAS-01, ative a webcam e calibre sua postura neutra e a guarda.' },
  { number: '02', Icon: Focus, title: 'Assuma sua guarda', description: 'Mantenha braços e tronco visíveis. Faça um soco de cada vez e retorne à guarda.' },
  { number: '03', Icon: MoveUpRight, title: 'Entre no ringue', description: 'Inicie o combate com seus movimentos. Sem webcam, assista à demonstração entre duas IAs.' },
]

function Laboratory() {
  const [view, setView] = useState<'arena' | 'lab'>('arena')
  const selectView = (next: 'arena' | 'lab') => {
    if (next === view) return
    if (view === 'arena') matchRuntime.suspend('view')
    setView(next)
  }
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: 'arena' | 'lab'
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = view === 'arena' ? 'lab' : 'arena'
    else if (event.key === 'Home') next = 'arena'
    else if (event.key === 'End') next = 'lab'
    else return
    event.preventDefault()
    selectView(next)
    document.getElementById(`${next}-tab`)?.focus()
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#laboratorio">Ir para a área principal</a>
      <aside className="icon-rail" aria-label="Navegação do projeto">
        <Brand compact />
        <nav className="rail-navigation" aria-label="Fases de desenvolvimento">
          <a className="rail-item" href="#camera-title" title="Captura de movimento"><ScanLine size={21} /><span className="sr-only">Captura de movimento</span></a>
          <button className={`rail-item ${view === 'lab' ? 'is-current' : ''}`} type="button" onClick={() => selectView('lab')} aria-current={view === 'lab' ? 'page' : undefined} title="Abrir laboratório 3D"><Bot size={21} /><span className="sr-only">Abrir laboratório 3D</span></button>
          <a className="rail-item" href="#motion-engine-title" title="Calibração e gestos"><Focus size={21} /><span className="sr-only">Calibração e gestos</span></a>
          <button className="rail-item" type="button" onClick={() => selectView('lab')} title="Animações no laboratório"><Layers3 size={21} /><span className="sr-only">Animações no laboratório</span></button>
          <button className={`rail-item ${view === 'arena' ? 'is-current' : ''}`} type="button" onClick={() => selectView('arena')} aria-current={view === 'arena' ? 'page' : undefined} title="Abrir arena de combate"><Swords size={20} /><span className="sr-only">Abrir arena de combate</span></button>
        </nav>
        <a className="rail-item rail-help" href="#guia" title="Guia de início"><CircleHelp size={20} /><span className="sr-only">Guia de início</span></a>
        <span className="rail-version">0.6</span>
      </aside>

      <div className="workspace">
        <header className="global-header">
          <Brand />
          <div className="header-product"><span className="header-divider" /><span>{view === 'arena' ? 'COMBAT ARENA' : 'MOTION LAB'}</span><span className="version-tag">v0.6.0</span></div>
          <div className="environment-status"><span className="environment-dot" /><span>SESSÃO LOCAL</span><span className="environment-separator" /><Monitor size={13} /><span>NO NAVEGADOR</span></div>
        </header>

        <main className="main-content robot-workspace" id="laboratorio">
          <div className="breadcrumbs" aria-label="Localização"><span>WORKSPACE</span><ChevronRight size={11} /><span>{view === 'arena' ? 'COMBAT ARENA' : 'MOTION LAB'}</span></div>
          <section className="workspace-intro" aria-labelledby="workspace-title">
            <div><div className="section-eyebrow"><span />SEU CORPO. SEU CONTROLE.</div><h1 id="workspace-title">{view === 'arena' ? 'Seu lugar no ringue' : 'Laboratório de movimento'}<span className="title-period">.</span></h1><p>{view === 'arena' ? 'O combate começa com você. Sincronize, assuma a guarda e enfrente VULCAN-07.' : 'Explore o espelhamento, a calibração e as animações de cada golpe.'}</p></div>
            <div className="phase-chip"><span className="phase-number">06</span><div><span>FASE ATUAL</span><strong>Polimento</strong></div></div>
          </section>

          <div className="workspace-view-tabs" role="tablist" aria-label="Área de trabalho">
            <button id="arena-tab" role="tab" type="button" aria-controls="workspace-view-panel" aria-selected={view === 'arena'} tabIndex={view === 'arena' ? 0 : -1} onClick={() => selectView('arena')} onKeyDown={navigateTabs}><Swords size={16} aria-hidden="true" />Arena<span>COMBATE</span></button>
            <button id="lab-tab" role="tab" type="button" aria-controls="workspace-view-panel" aria-selected={view === 'lab'} tabIndex={view === 'lab' ? 0 : -1} onClick={() => selectView('lab')} onKeyDown={navigateTabs}><Bot size={16} aria-hidden="true" />Laboratório<span>MOVIMENTO</span></button>
          </div>
          <div className={`laboratory-grid robot-laboratory combat-workspace-grid ${view === 'arena' ? 'is-arena' : ''}`} id="workspace-view-panel" role="tabpanel" aria-labelledby={`${view}-tab`}>
            {view === 'arena' && <CombatPanel />}
            <CameraPanel />
            {view === 'lab' && <RobotPanel />}
            {view === 'lab' && <HybridAnimationPanel />}
            <CombatMotionPanel />
            <DiagnosticsPanel />
          </div>

          <section className="getting-started" id="guia" aria-labelledby="guide-title">
            <div className="guide-heading"><div><div className="section-eyebrow">COMECE POR AQUI</div><h2 id="guide-title">Pronto para sincronizar?</h2></div><span className="guide-duration"><Clock3 size={13} />Menos de um minuto para começar</span></div>
            <div className="guide-steps">{guideSteps.map(({ number, Icon, title, description }) => <article className="guide-step" key={number}><div className="guide-icon"><Icon size={21} strokeWidth={1.5} /></div><div><span className="step-number">PASSO {number}</span><h3>{title}</h3><p>{description}</p></div></article>)}</div>
            <div className="guide-lighting"><span className="lighting-symbol" aria-hidden="true">✳</span>Uma boa iluminação e um fundo livre ajudam o rastreamento.<a href="#laboratorio">Tudo pronto <ArrowUpRight size={13} /></a></div>
          </section>

          <footer className="workspace-footer"><p><ShieldCheck size={14} /> Seu movimento fica com você.<span>Processamento local, sem gravação ou envio de vídeo.</span></p><div className="phase-roadmap" aria-label="Progresso das fases"><span className="is-complete"><Check size={10} />05 <span>Combate</span></span><ChevronRight size={11} /><span className="is-active"><span className="roadmap-dot" />06 <span>Polimento</span></span><ChevronRight size={11} /><span><LockKeyhole size={10} />07 <span>Expansões</span></span></div></footer>
        </main>
      </div>
    </div>
  )
}

export function App() {
  return <ErrorBoundary><Laboratory /></ErrorBoundary>
}
