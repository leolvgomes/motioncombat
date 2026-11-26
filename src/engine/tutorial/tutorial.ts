import type { AttackKind, AttackSide } from '../../types/animation'
import type { CombatEvent } from '../../types/combat'

export type TutorialStepId = 'guard' | 'straights' | 'hook' | 'uppercut' | 'block' | 'dodge' | 'combo' | 'special'

export interface TutorialStep {
  readonly id: TutorialStepId
  readonly title: string
  readonly instruction: string
  readonly goal: number
  /** Needs hook and uppercut recognition, which the player can switch off. */
  readonly advanced?: boolean
  /** The training robot swings so the player can defend. */
  readonly drill?: boolean
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'guard', title: 'Guarda', instruction: 'Punhos na altura do rosto, cotovelos fechados. Segure por 1 segundo.', goal: 1 },
  { id: 'straights', title: 'Soco reto', instruction: 'Um soco reto com cada mão, voltando para a guarda depois de cada um.', goal: 2 },
  { id: 'hook', title: 'Cruzado', instruction: 'Punho de fora para o centro, na altura do rosto do adversário.', goal: 1, advanced: true },
  { id: 'uppercut', title: 'Uppercut', instruction: 'Punho de baixo para cima, subindo na frente do corpo.', goal: 1, advanced: true },
  { id: 'block', title: 'Bloqueio', instruction: 'O robô de treino vai atacar. Faça a guarda assim que o aviso aparecer.', goal: 2, drill: true },
  { id: 'dodge', title: 'Esquiva', instruction: 'Quando o aviso aparecer, incline o tronco para um dos lados.', goal: 1, drill: true },
  { id: 'combo', title: 'Combo Um-dois', instruction: 'Acerte um soco reto e, logo depois, outro com a outra mão.', goal: 1 },
  { id: 'special', title: 'Sobrecarga', instruction: 'Seu medidor está cheio. Soque com as duas mãos ao mesmo tempo.', goal: 1 },
]

export const GUARD_HOLD_SECONDS = 1
/** A step without progress for this long is skipped, so a gesture that is not recognised never traps the player. */
export const STEP_TIMEOUT_SECONDS = 35
/** Pause after a step is completed, so the success is visible before the next instruction. */
export const STEP_CELEBRATION_SECONDS = 1.4
/** Rest between two drill attacks. */
export const DRILL_INTERVAL_SECONDS = 1.6

export interface TutorialView {
  readonly index: number
  readonly total: number
  readonly step: TutorialStep
  readonly count: number
  /** The current step was just completed and the next one is about to start. */
  readonly completed: boolean
  readonly finished: boolean
  /** Seconds left before the current step is skipped. */
  readonly timeLeft: number
  /** Short feedback on the last attempt, or why a step was skipped. */
  readonly note: string | null
  readonly skipped: readonly TutorialStepId[]
}

/** Follows real match events of a training session; it never invents a detection. */
export class GuidedTraining {
  readonly steps: readonly TutorialStep[]
  private index = 0
  private count = 0
  private guardHeld = 0
  private sides = new Set<AttackSide>()
  private elapsed = 0
  private celebration = 0
  private drillCooldown = DRILL_INTERVAL_SECONDS
  private drillPending = false
  /** A drill attack cancelled before contact (the player hit first) must not block the drill. */
  private drillWait = 0
  private drillSide: AttackSide = 'left'
  private note: string | null = null
  private readonly skippedSteps: TutorialStepId[] = []

  constructor(advanced: boolean) {
    this.steps = TUTORIAL_STEPS.filter((step) => advanced || !step.advanced)
  }

  get finished(): boolean { return this.index >= this.steps.length }
  get current(): TutorialStep | null { return this.steps[this.index] ?? null }

  get view(): TutorialView {
    const step = this.steps[Math.min(this.index, this.steps.length - 1)]!
    return {
      index: Math.min(this.index, this.steps.length - 1), total: this.steps.length, step,
      count: this.celebration > 0 ? step.goal : this.count, completed: this.celebration > 0, finished: this.finished,
      timeLeft: Math.max(0, STEP_TIMEOUT_SECONDS - this.elapsed), note: this.note, skipped: [...this.skippedSteps],
    }
  }

  /** The attack the training robot should wind up now, or null. Call drillStarted() once it accepted. */
  get wantsAttack(): { kind: AttackKind; side: AttackSide } | null {
    const step = this.current
    if (!step?.drill || this.celebration > 0 || this.drillPending || this.drillCooldown > 0) return null
    return { kind: 'straight', side: this.drillSide }
  }

  drillStarted(): void {
    this.drillPending = true
    this.drillWait = 3
    this.drillSide = this.drillSide === 'left' ? 'right' : 'left'
  }

  /** The special step needs a full meter; the runtime keeps it full until the special is thrown. */
  get wantsOverdrive(): boolean { return this.current?.id === 'special' && this.celebration <= 0 }

  step(elapsed: number, guard: boolean): void {
    if (this.finished || !Number.isFinite(elapsed) || elapsed <= 0) return
    if (this.celebration > 0) {
      this.celebration -= elapsed
      if (this.celebration <= 0) this.advance()
      return
    }
    this.elapsed += elapsed
    this.drillCooldown = Math.max(0, this.drillCooldown - elapsed)
    if (this.drillPending) {
      this.drillWait -= elapsed
      if (this.drillWait <= 0) { this.drillPending = false; this.drillCooldown = DRILL_INTERVAL_SECONDS }
    }
    if (this.current?.id === 'guard') {
      this.guardHeld = guard ? this.guardHeld + elapsed : 0
      if (this.guardHeld >= GUARD_HOLD_SECONDS) this.progress(1)
    }
    if (this.celebration <= 0 && this.elapsed >= STEP_TIMEOUT_SECONDS) {
      this.skippedSteps.push(this.current!.id)
      this.note = `${this.current!.title} pulado após ${STEP_TIMEOUT_SECONDS} s sem reconhecimento.`
      this.advance()
    }
  }

  /** Moves on without completing the current step. */
  skip(): void {
    const step = this.current
    if (!step) return
    // A completed step that is still showing its success just moves on.
    if (this.celebration > 0) { this.advance(); return }
    this.skippedSteps.push(step.id)
    this.note = `${step.title} pulado.`
    this.advance()
  }

  observe(event: CombatEvent): void {
    const step = this.current
    if (!step || this.celebration > 0) return
    switch (step.id) {
      case 'straights':
        if (event.type === 'attack' && event.fighter === 'player' && event.kind === 'straight') {
          this.sides.add(event.side)
          this.progress(this.sides.size)
          if (this.sides.size === 1) this.note = 'Boa. Agora com a outra mão.'
        }
        return
      case 'hook':
      case 'uppercut':
        if (event.type === 'attack' && event.fighter === 'player') {
          if (event.kind === step.id) this.progress(1)
          else this.note = event.kind === 'straight' ? 'Saiu um soco reto. Faça o movimento mais curvo.' : `Saiu um ${event.kind === 'hook' ? 'cruzado' : 'uppercut'}.`
        }
        return
      case 'block':
      case 'dodge':
        if (event.type !== 'impact' || event.impact.attacker !== 'opponent') return
        this.drillPending = false
        this.drillCooldown = DRILL_INTERVAL_SECONDS
        if (step.id === 'block' && event.impact.result === 'blocked' || step.id === 'dodge' && event.impact.result === 'dodged') {
          this.progress(this.count + 1)
          if (this.count < step.goal) this.note = 'Isso! Mais uma vez.'
        } else if (event.impact.result === 'hit') {
          this.note = step.id === 'block' ? 'Atingido. Levante a guarda assim que o aviso aparecer.' : 'Atingido. Incline o tronco antes do golpe chegar.'
        } else if (event.impact.result === 'dodged') this.note = 'Boa esquiva, mas aqui a ideia é bloquear.'
        else if (event.impact.result === 'blocked') this.note = 'Bloqueou. Agora tente sair do golpe inclinando o tronco.'
        return
      case 'combo':
        if (event.type === 'combo' && event.combo.fighter === 'player' && event.combo.combo === 'one-two') this.progress(1)
        else if (event.type === 'impact' && event.impact.attacker === 'player' && event.impact.result === 'hit') this.note = 'Acertou. Emende o próximo com a outra mão.'
        return
      case 'special':
        if (event.type === 'special' && event.fighter === 'player') this.progress(1)
        else if (event.type === 'attack' && event.fighter === 'player') this.note = 'Saiu um golpe só. As duas mãos precisam sair juntas.'
        return
      case 'guard':
        return
    }
  }

  private progress(count: number): void {
    const step = this.current
    if (!step) return
    this.count = Math.min(step.goal, count)
    this.elapsed = 0
    if (this.count >= step.goal) {
      this.celebration = STEP_CELEBRATION_SECONDS
      this.note = null
    }
  }

  private advance(): void {
    this.index += 1
    this.count = 0
    this.guardHeld = 0
    this.sides = new Set()
    this.elapsed = 0
    this.celebration = 0
    this.drillPending = false
    this.drillCooldown = DRILL_INTERVAL_SECONDS
  }
}
