import type { ArenaId } from '../../types/customization'

interface ThemeLight { readonly color: string; readonly intensity: number }

/** Colours and lights only. The ring's size, the camera and the rules are the same everywhere. */
export interface ArenaTheme {
  readonly sky: string
  readonly fog: readonly [near: number, far: number]
  readonly ambient: number
  readonly hemisphere: [sky: string, ground: string, intensity: number]
  readonly key: ThemeLight
  readonly rim: ThemeLight
  readonly fill: ThemeLight
  readonly colors: Readonly<Record<'deck' | 'foundation' | 'steel' | 'wall' | 'ground' | 'marking' | 'grid' | 'gridCenter'
    | 'rock' | 'crateA' | 'crateB' | 'window', string>>
}

export const ARENA_THEMES: Readonly<Record<ArenaId, ArenaTheme>> = {
  foundry: {
    sky: '#080f16', fog: [22, 70], ambient: 0.62, hemisphere: ['#b6e3f3', '#17212a', 1.2],
    key: { color: '#d9e9ef', intensity: 3.4 }, rim: { color: '#62bcd5', intensity: 2.2 }, fill: { color: '#f1ac73', intensity: 1.5 },
    colors: {
      deck: '#1b2b36', foundation: '#111b24', steel: '#354753', wall: '#101c25', ground: '#0c141d', marking: '#3c5360',
      grid: '#12222c', gridCenter: '#213642', rock: '#2a3640', crateA: '#355067', crateB: '#6a4632', window: '#7ec7d8',
    },
  },
  harbor: {
    sky: '#0b1024', fog: [16, 52], ambient: 0.55, hemisphere: ['#8fa6dc', '#171a28', 1.1],
    key: { color: '#e4ebff', intensity: 2.8 }, rim: { color: '#8d86e0', intensity: 2 }, fill: { color: '#53d7ce', intensity: 1.1 },
    colors: {
      deck: '#222a3f', foundation: '#141a2b', steel: '#454f70', wall: '#171f36', ground: '#0d1326', marking: '#4d5a86',
      grid: '#151c36', gridCenter: '#2a3560', rock: '#2c3350', crateA: '#2c6470', crateB: '#7d3a5c', window: '#ffd58a',
    },
  },
  canyon: {
    sky: '#6f4d40', fog: [16, 48], ambient: 0.5, hemisphere: ['#f0cfb0', '#3d2a22', 1],
    key: { color: '#ffe6c4', intensity: 3.1 }, rim: { color: '#e88a58', intensity: 1.5 }, fill: { color: '#a9c6e0', intensity: 1.3 },
    colors: {
      deck: '#4a4540', foundation: '#38322e', steel: '#7a6f66', wall: '#6b4a39', ground: '#573d2f', marking: '#b09c88',
      grid: '#4d3629', gridCenter: '#4a3327', rock: '#74472f', crateA: '#2f8f95', crateB: '#b9532e', window: '#ffe9c8',
    },
  },
}
