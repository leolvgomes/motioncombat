import { Component, Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { LoaderCircle, RotateCcw, Wrench } from 'lucide-react'
import { useProfileStore, useRobotName } from '../../stores/profile-store'
import { ARENAS, ARMORS, HEADS, LIGHTS, NAME_MAX_LENGTH, SHOULDERS } from './catalog'

const GarageCanvas = lazy(() => import('./GarageCanvas'))

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="garage-message" role="alert"><p>A prévia 3D não está disponível. As escolhas continuam valendo na arena.</p>
      <button className="combat-secondary-action" type="button" onClick={() => this.setState({ failed: false })}>Tentar novamente</button></div>
  }
}

interface Choice<Id extends string> { readonly id: Id; readonly label: string; readonly swatch?: string; readonly description?: string }

function ChoiceGroup<Id extends string>({ legend, name, value, options, onChange }: {
  legend: string
  name: string
  value: Id
  options: readonly Choice<Id>[]
  onChange: (value: Id) => void
}) {
  return <fieldset className="garage-group"><legend>{legend}</legend><div className="garage-options">
    {options.map(({ id, label, swatch, description }) => <label key={id} className={`garage-option ${value === id ? 'is-selected' : ''}`}>
      <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} />
      {swatch && <span className="garage-swatch" style={{ background: swatch }} aria-hidden="true" />}
      <span>{label}{description && <small>{description}</small>}</span>
    </label>)}
  </div></fieldset>
}

export function GaragePanel() {
  const { name, look, arena, setName, setLook, setArena, restoreRobot } = useProfileStore()
  const shownName = useRobotName()
  return <section className="expansion-panel garage-panel" aria-labelledby="garage-title">
    <header className="expansion-heading"><div><span className="panel-eyebrow"><Wrench size={13} aria-hidden="true" />PERSONALIZAÇÃO · FASE 07</span><h2 id="garage-title">Garagem</h2><p>Aparência e nome são só visuais. Alcance, dano e área de contato não mudam.</p></div>
      <button className="combat-secondary-action" type="button" onClick={restoreRobot}><RotateCcw size={14} aria-hidden="true" />Restaurar robô</button></header>
    <div className="garage-grid">
      <div className="garage-preview">
        <PreviewBoundary><Suspense fallback={<div className="garage-message" role="status"><LoaderCircle className="spinning" size={24} aria-hidden="true" /><p>Preparando a prévia</p></div>}><GarageCanvas /></Suspense></PreviewBoundary>
        <strong className="garage-nameplate">{shownName}</strong>
      </div>
      <div className="garage-form">
        <label className="garage-name" htmlFor="robot-name"><span>Nome do robô</span>
          <input id="robot-name" type="text" value={name} maxLength={NAME_MAX_LENGTH} autoComplete="off" spellCheck={false} placeholder={shownName} onChange={(event) => setName(event.target.value)} />
          <small>Até {NAME_MAX_LENGTH} caracteres: letras, números, espaço e hífen.</small></label>
        <ChoiceGroup legend="Blindagem" name="armor" value={look.armor} onChange={(armor) => setLook({ armor })} options={ARMORS.map(({ id, label, plate }) => ({ id, label, swatch: plate }))} />
        <ChoiceGroup legend="Luzes" name="light" value={look.light} onChange={(light) => setLook({ light })} options={LIGHTS.map(({ id, label, color }) => ({ id, label, swatch: color }))} />
        <ChoiceGroup legend="Cabeça" name="head" value={look.head} onChange={(head) => setLook({ head })} options={HEADS} />
        <ChoiceGroup legend="Ombreiras" name="shoulders" value={look.shoulders} onChange={(shoulders) => setLook({ shoulders })} options={SHOULDERS} />
        <ChoiceGroup legend="Cenário da arena" name="arena" value={arena} onChange={setArena} options={ARENAS} />
      </div>
    </div>
  </section>
}
