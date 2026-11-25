import type { AttackKind, AttackSide } from '../../types/animation'
import type { ComboId } from '../../types/combat'

export interface ComboStep {
  readonly kind: AttackKind
  /** Alternate requires the opposite fist of the previous hit. */
  readonly side: 'any' | 'alternate'
}

export interface ComboDefinition {
  readonly id: ComboId
  readonly name: string
  readonly steps: readonly ComboStep[]
  readonly bonus: number
}

export interface ComboHit {
  readonly kind: AttackKind
  readonly side: AttackSide
}

/** Seconds between two landed hits of the same sequence. */
export const COMBO_WINDOW_SECONDS = 1.5

const step = (kind: AttackKind, side: ComboStep['side'] = 'any'): ComboStep => ({ kind, side })

/** Every shorter combo that prefixes a longer one can be extended by the next hit. */
export const COMBOS: readonly ComboDefinition[] = Object.freeze([
  { id: 'one-two', name: 'Um-dois', steps: [step('straight'), step('straight', 'alternate')], bonus: 3 },
  { id: 'ascension', name: 'Ascensão', steps: [step('straight'), step('uppercut')], bonus: 4 },
  { id: 'double-gate', name: 'Portão duplo', steps: [step('hook'), step('hook', 'alternate')], bonus: 4 },
  { id: 'triple-hammer', name: 'Martelo triplo', steps: [step('straight'), step('straight', 'alternate'), step('hook')], bonus: 6 },
  { id: 'steel-storm', name: 'Tempestade de aço', steps: [step('straight'), step('hook'), step('uppercut')], bonus: 8 },
  { id: 'full-sync', name: 'Sincronia total', steps: [step('straight'), step('straight', 'alternate'), step('hook'), step('uppercut')], bonus: 10 },
])

const BY_ID = new Map(COMBOS.map((combo) => [combo.id, combo]))

export function comboById(id: ComboId): ComboDefinition {
  const combo = BY_ID.get(id)
  if (!combo) throw new Error(`Combo desconhecido: ${id}`)
  return combo
}

function matches(steps: readonly ComboStep[], chain: readonly ComboHit[]): boolean {
  return chain.length <= steps.length && chain.every((hit, index) => hit.kind === steps[index]!.kind
    && (steps[index]!.side === 'any' || index === 0 || hit.side !== chain[index - 1]!.side))
}

/** Landed, unblocked hits of one fighter. It only advances with the fixed simulation step. */
export class ComboTracker {
  private chain: ComboHit[] = []
  private remaining = 0
  private count = 0

  /** Consecutive landed hits, including those outside any named combo. */
  get streak(): number { return this.count }

  advance(elapsed: number): void {
    if (this.count === 0) return
    this.remaining -= elapsed
    if (this.remaining <= 1e-9) this.break()
  }

  break(): void {
    this.chain = []
    this.remaining = 0
    this.count = 0
  }

  /** Registers a hit and returns the combo it completes, if any. */
  land(hit: ComboHit): ComboDefinition | null {
    this.count += 1
    this.remaining = COMBO_WINDOW_SECONDS
    this.chain.push({ kind: hit.kind, side: hit.side })
    // A completed combo never repeats by overlap: an unmatched chain restarts at the current hit.
    if (!COMBOS.some(({ steps }) => matches(steps, this.chain))) this.chain = [{ kind: hit.kind, side: hit.side }]
    return COMBOS.find(({ steps }) => steps.length === this.chain.length && matches(steps, this.chain)) ?? null
  }
}
