export type ArmorId = 'titanium' | 'cobalt' | 'crimson' | 'forest' | 'sand' | 'graphite'
export type LightId = 'cyan' | 'lime' | 'amber' | 'magenta' | 'violet' | 'white'
export type HeadId = 'visor' | 'twin' | 'crest'
export type ShoulderId = 'standard' | 'heavy' | 'light'
export type ArenaId = 'foundry' | 'harbor' | 'canyon'

/** Purely visual: hitboxes, reach and damage are the same for every look. */
export interface RobotLook {
  readonly armor: ArmorId
  readonly light: LightId
  readonly head: HeadId
  readonly shoulders: ShoulderId
}
