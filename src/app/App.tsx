import { ArrowUpRight, Bot, Camera, Check, ChevronRight, CircleHelp, Clock3, Focus, Layers3, Monitor, MoveUpRight, ScanLine, ShieldCheck, Swords, Trophy, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { CameraPanel } from '../features/camera/CameraPanel'
import { DiagnosticsPanel } from '../features/motion-tracking/DiagnosticsPanel'
import { RobotPanel } from '../features/robot/RobotPanel'
import { CareerPanel } from '../features/career/CareerPanel'
import { TrialPanel } from '../features/trials/TrialPanel'
import { GaragePanel } from '../features/customization/GaragePanel'
import { combatAudio } from '../features/audio/combat-audio'
import type { Replay } from '../engine/replay/replay'
import { useRobotName } from '../stores/profile-store'
import { ErrorBoundary } from './ErrorBoundary'
import { CombatMotionPanel } from '../features/motion-tracking/CombatMotionPanel'
import { HybridAnimationPanel } from '../features/robot/HybridAnimationPanel'
import { CombatPanel } from '../features/combat/CombatPanel'
import { matchRuntime } from '../features/combat/match-runtime'

type View = 'arena' | 'lab' | 'garage' | 'career'

const views: readonly { id: View; label: string; tag: string; Icon: LucideIcon; section: string; title: string; description: string }[] = [
  { id: 'arena', label: 'Arena', tag: 'COMBATE', Icon: Swords, section: 'COMBAT ARENA', title: 'Seu lugar no ringue', description: 'O combate começa com você. Sincronize, assuma a guarda e enfrente VULCAN-07.' },
  { id: 'lab', label: 'Laboratório', tag: 'MOVIMENTO', Icon: Bot, section: 'MOTION LAB', title: 'Laboratório de movimento', description: 'Explore o espelhamento, a calibração e as animações de cada golpe.' },
  { id: 'garage', label: 'Garagem', tag: 'ROBÔ', Icon: Wrench, section: 'GARAGE', title: 'Monte sua identidade', description: 'Escolha nome, blindagem, luzes e o cenário da próxima luta.' },
  { id: 'career', label: 'Carreira', tag: 'REPLAYS', Icon: Trophy, section: 'CAREER', title: 'Sua história no ringue', description: 'Acompanhe estatísticas, ranking local, combos e replays.' },
]

const guideSteps = [
  { number: '01', Icon: Camera, title: 'Conecte e calibre', description: 'Para controlar seu robô, ative a webcam e calibre sua postura neutra e a guarda.' },
  { number: '02', Icon: Focus, title: 'Assuma sua guarda', description: 'Mantenha braços e tronco visíveis. Faça um soco de cada vez e retorne à guarda.' },
  { number: '03', Icon: MoveUpRight, title: 'Entre no ringue', description: 'Inicie o combate com seus movimentos. Sem webcam, assista à demonstração entre duas IAs.' },
]

function Laboratory() {
  const [view, setView] = useState<View>('arena')
  const robotName = useRobotName()
  const current = views.find(({ id }) => id === view) ?? views[0]!
  const single = view === 'garage' || view === 'career'
  const selectView = (next: View) => {
    if (next === view) return
    if (view === 'arena') matchRuntime.suspend('view')
    setView(next)
  }
  const watchReplay = (replay: Replay) => {
    combatAudio.unlock()
    if (matchRuntime.startReplay(replay)) setView('arena')
  }
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = views.findIndex(({ id }) => id === view)
    const target = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null
    if (target === null) return
    const next = views[(target + views.length) % views.length]!.id
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
          <button className={`rail-item ${view === 'garage' ? 'is-current' : ''}`} type="button" onClick={() => selectView('garage')} aria-current={view === 'garage' ? 'page' : undefined} title="Abrir garagem"><Wrench size={20} /><span className="sr-only">Abrir garagem</span></button>
          <button className={`rail-item ${view === 'career' ? 'is-current' : ''}`} type="button" onClick={() => selectView('career')} aria-current={view === 'career' ? 'page' : undefined} title="Abrir carreira e replays"><Trophy size={20} /><span className="sr-only">Abrir carreira e replays</span></button>
        </nav>
        <a className="rail-item rail-help" href="#guia" title="Guia de início"><CircleHelp size={20} /><span className="sr-only">Guia de início</span></a>
        <span className="rail-version">0.8</span>
      </aside>

      <div className="workspace">
        <header className="global-header">
          <Brand />
          <div className="header-product"><span className="header-divider" /><span>{current.section}</span><span className="version-tag">v0.8.0</span></div>
          <div className="environment-status"><span className="environment-dot" /><span>SESSÃO LOCAL</span><span className="environment-separator" /><Monitor size={13} /><span>NO NAVEGADOR</span></div>
        </header>

        <main className="main-content robot-workspace" id="laboratorio">
          <div className="breadcrumbs" aria-label="Localização"><span>WORKSPACE</span><ChevronRight size={11} /><span>{current.section}</span></div>
          <section className="workspace-intro" aria-labelledby="workspace-title">
            <div><div className="section-eyebrow"><span />SEU CORPO. SEU CONTROLE.</div><h1 id="workspace-title">{current.title}<span className="title-period">.</span></h1><p>{current.description}</p></div>
            <div className="phase-chip"><span className="phase-number">08</span><div><span>FASE ATUAL</span><strong>Precisão</strong></div></div>
          </section>

          <div className="workspace-view-tabs" role="tablist" aria-label="Área de trabalho">
            {views.map(({ id, label, tag, Icon }) => <button key={id} id={`${id}-tab`} role="tab" type="button" aria-controls="workspace-view-panel" aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => selectView(id)} onKeyDown={navigateTabs}><Icon size={16} aria-hidden="true" />{label}<span>{id === 'garage' ? robotName : tag}</span></button>)}
          </div>
          <div className={`laboratory-grid robot-laboratory combat-workspace-grid ${view === 'arena' ? 'is-arena' : single ? 'is-single' : ''}`} id="workspace-view-panel" role="tabpanel" aria-labelledby={`${view}-tab`}>
            {view === 'arena' && <CombatPanel />}
            {view === 'garage' && <GaragePanel />}
            {view === 'career' && <CareerPanel onWatch={watchReplay} />}
            {/* Always mounted: leaving a view must not end the camera session. */}
            <CameraPanel />
            {view === 'lab' && <RobotPanel />}
            {view === 'lab' && <HybridAnimationPanel />}
            {!single && <CombatMotionPanel />}
            {view === 'lab' && <TrialPanel />}
            {!single && <DiagnosticsPanel />}
          </div>

          <section className="getting-started" id="guia" aria-labelledby="guide-title">
            <div className="guide-heading"><div><div className="section-eyebrow">COMECE POR AQUI</div><h2 id="guide-title">Pronto para sincronizar?</h2></div><span className="guide-duration"><Clock3 size={13} />Menos de um minuto para começar</span></div>
            <div className="guide-steps">{guideSteps.map(({ number, Icon, title, description }) => <article className="guide-step" key={number}><div className="guide-icon"><Icon size={21} strokeWidth={1.5} /></div><div><span className="step-number">PASSO {number}</span><h3>{title}</h3><p>{description}</p></div></article>)}</div>
            <div className="guide-lighting"><span className="lighting-symbol" aria-hidden="true">✳</span>Uma boa iluminação e um fundo livre ajudam o rastreamento.<a href="#laboratorio">Tudo pronto <ArrowUpRight size={13} /></a></div>
          </section>

          <footer className="workspace-footer"><p><ShieldCheck size={14} /> Seu movimento fica com você.<span>Processamento local, sem gravação ou envio de vídeo.</span></p><div className="phase-roadmap" aria-label="Progresso das fases"><span className="is-complete"><Check size={10} />06 <span>Polimento</span></span><ChevronRight size={11} /><span className="is-complete"><Check size={10} />07 <span>Expansões</span></span><ChevronRight size={11} /><span className="is-active"><span className="roadmap-dot" />08 <span>Precisão</span></span></div></footer>
        </main>
      </div>
    </div>
  )
}

export function App() {
  return <ErrorBoundary><Laboratory /></ErrorBoundary>
}
