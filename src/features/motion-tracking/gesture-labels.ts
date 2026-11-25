import type { GestureType } from '../../engine/gestures/gesture-engine'

export const gestureLabels: Record<GestureType, string> = {
  PUNCH_LEFT: 'Soco esquerdo', PUNCH_RIGHT: 'Soco direito',
  HOOK_LEFT: 'Gancho esquerdo', HOOK_RIGHT: 'Gancho direito',
  UPPERCUT_LEFT: 'Uppercut esquerdo', UPPERCUT_RIGHT: 'Uppercut direito', GUARD: 'Guarda',
  DODGE_LEFT: 'Esquiva à esquerda', DODGE_RIGHT: 'Esquiva à direita',
}
