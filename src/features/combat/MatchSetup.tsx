import { Check, GraduationCap, Lightbulb, Medal, Route, Swords, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CIRCUIT } from '../../engine/career/circuit'
import { DIFFICULTIES, DIFFICULTY_RULES, OPPONENT_IDS, OPPONENTS, opponentProfile } from '../../engine/combat/opponents'
import type { Difficulty } from '../../engine/combat/opponents'
import { TUTORIAL_STEPS } from '../../engine/tutorial/tutorial'
import { useMatchStore } from '../../stores/match-store'
import type { MatchKind } from '../../stores/match-store'
import { useProfileStore } from '../../stores/profile-store'
import { useProgressStore } from '../../stores/progress-store'
import { RIVAL_APPEARANCES } from '../customization/catalog'
import { matchRuntime } from './match-runtime'

const MODES: readonly { id: MatchKind; label: string; note: string; Icon: LucideIcon }[] = [
  { id: 'quick', label: 'Luta rápida', note: 'Escolha adversário e dificuldade', Icon: Swords },
  { id: 'circuit', label: 'Circuito', note: `${CIRCUIT.length} lutas seguidas até o campeão`, Icon: Route },
  { id: 'training', label: 'Treino guiado', note: 'Aprenda cada golpe e defesa', Icon: GraduationCap },
]

function DifficultyPicker({ value, onChange, disabled }: { value: Difficulty; onChange: (value: Difficulty) => void; disabled: boolean }) {
  return <fieldset className="match-difficulty" disabled={disabled}>
    <legend>Dificuldade</legend>
    <div>{DIFFICULTIES.map((id) => <label key={id} className={value === id ? 'is-selected' : ''}>
      <input className="sr-only" type="radio" name="match-difficulty" value={id} checked={value === id} onChange={() => onChange(id)} />
      {DIFFICULTY_RULES[id].label}
    </label>)}</div>
    <small>{DIFFICULTY_RULES[value].description}</small>
  </fieldset>
}

function CircuitLadder({ disabled }: { disabled: boolean }) {
  const circuit = useProgressStore((state) => state.circuit)
  const abandon = useProgressStore((state) => state.abandonCircuit)
  const difficulty = useProfileStore((state) => state.difficulty)
  const setDifficulty = useProfileStore((state) => state.setDifficulty)
  const { run } = circuit
  const titles = DIFFICULTIES.filter((id) => circuit.titles[id] > 0)
  return <div className="match-circuit">
    <ol className="match-circuit-ladder" aria-label="Lutas do circuito">{CIRCUIT.map((id, index) => {
      const state = !run ? 'is-next' : index < run.stage ? 'is-cleared' : index === run.stage ? 'is-current' : 'is-next'
      const profile = opponentProfile(id)
      return <li key={id} className={state} aria-current={run && index === run.stage ? 'step' : undefined}>
        <span className="match-swatch" style={{ background: RIVAL_APPEARANCES[id].plate }} aria-hidden="true">{state === 'is-cleared' && <Check size={11} />}</span>
        <div><small>{index === CIRCUIT.length - 1 ? 'FINAL' : `LUTA ${index + 1}`}</small><strong>{profile.name}</strong><em>{profile.style}</em></div>
      </li>
    })}</ol>
    {run ? <div className="match-circuit-run">
      <p>Circuito em andamento no <strong>{DIFFICULTY_RULES[run.difficulty].label}</strong>: luta {run.stage + 1} de {CIRCUIT.length}. Vitória avança, empate repete a luta e derrota encerra o circuito.</p>
      <button className="combat-secondary-action is-subtle" type="button" disabled={disabled} onClick={() => { abandon(); matchRuntime.select('circuit') }}><X size={13} aria-hidden="true" />Abandonar circuito</button>
    </div> : <>
      <DifficultyPicker value={difficulty} onChange={(value) => { setDifficulty(value); matchRuntime.select('circuit') }} disabled={disabled} />
      <p className="match-setup-note">Vitória avança, empate repete a luta e derrota encerra o circuito.</p>
    </>}
    {(titles.length > 0 || circuit.bestStage > 0) && <p className="match-circuit-record"><Medal size={13} aria-hidden="true" />{titles.length > 0
      ? `Títulos: ${titles.map((id) => `${circuit.titles[id]} no ${DIFFICULTY_RULES[id].label}`).join(' · ')}`
      : `Melhor campanha: ${circuit.bestStage} de ${CIRCUIT.length} lutas vencidas`}</p>}
  </div>
}

function TrainingIntro() {
  const completed = useProgressStore((state) => state.tutorialCompleted)
  const advanced = useProfileStore((state) => state.advancedAttacks)
  const steps = TUTORIAL_STEPS.filter((step) => advanced || !step.advanced)
  return <div className="match-training">
    <p>Um robô de treino espera você no ringue. Cada etapa só avança quando o golpe ou a defesa é reconhecido pela câmera. Sem relógio, sem perda de integridade e sem registro na carreira.</p>
    <ol>{steps.map((step) => <li key={step.id}>{step.title}</li>)}</ol>
    {!advanced && <p className="match-setup-note">Cruzado e uppercut estão desligados no laboratório e ficam fora do treino.</p>}
    <p className="match-setup-note">Uma etapa sem reconhecimento por 35 s é pulada sozinha, para você não precisar voltar ao mouse.</p>
    {completed && <p className="match-circuit-record"><Check size={13} aria-hidden="true" />Você já concluiu o treino. Pode repetir quando quiser.</p>}
  </div>
}

/** Chooses the next webcam match. Demonstrations pick a random opponent on their own. */
export function MatchSetup({ disabled }: { disabled: boolean }) {
  const kind = useMatchStore((state) => state.kind)
  const rival = useMatchStore((state) => state.rival)
  const opponent = useProfileStore((state) => state.opponent)
  const difficulty = useProfileStore((state) => state.difficulty)
  const setOpponent = useProfileStore((state) => state.setOpponent)
  const setDifficulty = useProfileStore((state) => state.setDifficulty)
  const persistent = useProgressStore((state) => state.persistent)
  const tip = rival === 'sparring' ? null : OPPONENTS[rival]

  return <section className="match-setup" aria-labelledby="match-setup-title">
    <h3 id="match-setup-title" className="sr-only">Escolha a próxima luta</h3>
    <fieldset className="match-setup-modes" disabled={disabled}>
      <legend className="sr-only">Tipo de luta</legend>
      {MODES.map(({ id, label, note, Icon }) => <label key={id} className={kind === id ? 'is-selected' : ''}>
        <input className="sr-only" type="radio" name="match-kind" value={id} checked={kind === id} onChange={() => matchRuntime.select(id)} />
        <Icon size={16} aria-hidden="true" /><span><strong>{label}</strong><small>{note}</small></span>
      </label>)}
    </fieldset>

    {kind === 'quick' && <div className="match-quick">
      <fieldset className="match-opponents" disabled={disabled}>
        <legend>Adversário</legend>
        <div>{OPPONENT_IDS.map((id) => {
          const profile = OPPONENTS[id]
          return <label key={id} className={opponent === id ? 'is-selected' : ''}>
            <input className="sr-only" type="radio" name="match-opponent" value={id} checked={opponent === id} onChange={() => { setOpponent(id); matchRuntime.select('quick') }} />
            <span className="match-swatch" style={{ background: RIVAL_APPEARANCES[id].plate, borderColor: RIVAL_APPEARANCES[id].light }} aria-hidden="true" />
            <span><strong>{profile.name}</strong><em>{profile.style}</em><small>{profile.description}</small></span>
          </label>
        })}</div>
      </fieldset>
      <DifficultyPicker value={difficulty} onChange={(value) => { setDifficulty(value); matchRuntime.select('quick') }} disabled={disabled} />
    </div>}
    {kind === 'circuit' && <CircuitLadder disabled={disabled} />}
    {kind === 'training' && <TrainingIntro />}

    {tip && kind !== 'training' && <p className="match-setup-tip"><Lightbulb size={14} aria-hidden="true" /><span><strong>Contra {tip.name}:</strong> {tip.tip}</span></p>}
    {!persistent && <p className="expansion-warning" role="status">O navegador não permitiu salvar o progresso. Ele vale só para esta sessão.</p>}
  </section>
}
