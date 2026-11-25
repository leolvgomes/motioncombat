import type { ArenaId, ArmorId, HeadId, LightId, RobotLook, ShoulderId } from '../../types/customization'

interface Option<Id extends string> { readonly id: Id; readonly label: string }
export interface ArmorOption extends Option<ArmorId> { readonly plate: string; readonly frame: string }
export interface LightOption extends Option<LightId> { readonly color: string; readonly emissive: string }
export interface ArenaOption extends Option<ArenaId> { readonly description: string }

export const ARMORS: readonly ArmorOption[] = [
  { id: 'titanium', label: 'Titânio', plate: '#a9b9c3', frame: '#415363' },
  { id: 'cobalt', label: 'Cobalto', plate: '#5f86c4', frame: '#2b3f63' },
  { id: 'crimson', label: 'Carmim', plate: '#b8505a', frame: '#4d2b33' },
  { id: 'forest', label: 'Floresta', plate: '#6f9a78', frame: '#2f4a3b' },
  { id: 'sand', label: 'Areia', plate: '#c7b48b', frame: '#5a5140' },
  { id: 'graphite', label: 'Grafite', plate: '#59636c', frame: '#262e36' },
]

export const LIGHTS: readonly LightOption[] = [
  { id: 'cyan', label: 'Ciano', color: '#60dbe3', emissive: '#26bfce' },
  { id: 'lime', label: 'Lima', color: '#b7ea5f', emissive: '#7fc522' },
  { id: 'amber', label: 'Âmbar', color: '#ffd06b', emissive: '#e0a020' },
  { id: 'magenta', label: 'Magenta', color: '#f27fc4', emissive: '#d23a98' },
  { id: 'violet', label: 'Violeta', color: '#a996ff', emissive: '#6d55ea' },
  { id: 'white', label: 'Branco', color: '#eef6ff', emissive: '#a9c6dd' },
]

export const HEADS: readonly Option<HeadId>[] = [
  { id: 'visor', label: 'Visor contínuo' }, { id: 'twin', label: 'Ótica dupla' }, { id: 'crest', label: 'Crista' },
]

export const SHOULDERS: readonly Option<ShoulderId>[] = [
  { id: 'standard', label: 'Padrão' }, { id: 'heavy', label: 'Reforçada' }, { id: 'light', label: 'Leve' },
]

export const ARENAS: readonly ArenaOption[] = [
  { id: 'foundry', label: 'Fundição', description: 'Plataforma industrial fechada, com luz fria.' },
  { id: 'harbor', label: 'Porto noturno', description: 'Cais com contêineres, guindaste e luzes da cidade.' },
  { id: 'canyon', label: 'Cânion', description: 'Ringue a céu aberto entre rochas, no fim da tarde.' },
]

export const DEFAULT_LOOK: RobotLook = Object.freeze({ armor: 'titanium', light: 'cyan', head: 'visor', shoulders: 'standard' })
export const DEFAULT_ARENA: ArenaId = 'foundry'
export const DEFAULT_NAME = 'ATLAS-01'
export const OPPONENT_NAME = 'VULCAN-07'
export const NAME_MAX_LENGTH = 12

function known<Id extends string>(options: readonly Option<Id>[], value: unknown, fallback: Id): Id {
  return options.find((option) => option.id === value)?.id ?? fallback
}

export function armorOption(id: ArmorId): ArmorOption { return ARMORS.find((option) => option.id === id) ?? ARMORS[0]! }
export function lightOption(id: LightId): LightOption { return LIGHTS.find((option) => option.id === id) ?? LIGHTS[0]! }
export function arenaOption(id: ArenaId): ArenaOption { return ARENAS.find((option) => option.id === id) ?? ARENAS[0]! }

/** Untrusted storage in, always a complete look out. */
export function sanitizeLook(value: unknown): RobotLook {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    armor: known(ARMORS, stored.armor, DEFAULT_LOOK.armor),
    light: known(LIGHTS, stored.light, DEFAULT_LOOK.light),
    head: known(HEADS, stored.head, DEFAULT_LOOK.head),
    shoulders: known(SHOULDERS, stored.shoulders, DEFAULT_LOOK.shoulders),
  }
}

export function sanitizeArena(value: unknown): ArenaId { return known(ARENAS, value, DEFAULT_ARENA) }

/** Upper-case letters, digits, spaces and hyphens only, so the name fits every HUD and screen reader. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.toLocaleUpperCase('pt-BR').replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trimStart().slice(0, NAME_MAX_LENGTH)
}

export function sanitizeName(value: unknown): string { return cleanName(value).trim() || DEFAULT_NAME }
