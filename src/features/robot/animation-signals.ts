import { attackOfGesture } from '../../engine/gestures/gesture-engine'
import type { GestureEvent } from '../../engine/gestures/gesture-engine'

export interface AnimationGestureSignal {
  readonly sequence: number
  readonly generation: number
  readonly event: GestureEvent
}

let sequence = 0
let generation = 0
let current: AnimationGestureSignal | null = null

/** One fresh attack pulse. Never a buffered attack that can fire after a long pause. */
export function publishAnimationGesture(event: GestureEvent): void {
  if (!attackOfGesture(event.type)) return
  current = { sequence: ++sequence, generation, event }
}

export function resetAnimationSignals(): void { generation += 1; current = null }
export function readAnimationGesture(): AnimationGestureSignal | null { return current }
export function readAnimationGeneration(): number { return generation }
