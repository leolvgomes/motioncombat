import { beforeEach, describe, expect, it } from 'vitest'
import { publishAnimationGesture, readAnimationGeneration, readAnimationGesture, resetAnimationSignals } from './animation-signals'

beforeEach(() => resetAnimationSignals())

describe('recognition to animation signals', () => {
  it('passes only attack events without replacing one by a later posture pulse', () => {
    publishAnimationGesture({ type: 'PUNCH_LEFT', timestamp: 100, confidence: 0.9 })
    const attack = readAnimationGesture()
    publishAnimationGesture({ type: 'GUARD', timestamp: 120, confidence: 0.95 })
    expect(readAnimationGesture()).toBe(attack)
    expect(attack?.event.type).toBe('PUNCH_LEFT')
  })

  it('retains only the latest attack and invalidates it on reset', () => {
    publishAnimationGesture({ type: 'PUNCH_LEFT', timestamp: 100, confidence: 0.9 })
    const first = readAnimationGesture()
    publishAnimationGesture({ type: 'PUNCH_RIGHT', timestamp: 180, confidence: 0.9 })
    expect(readAnimationGesture()?.sequence).toBeGreaterThan(first?.sequence ?? 0)
    expect(readAnimationGesture()?.event.type).toBe('PUNCH_RIGHT')
    const generation = readAnimationGeneration()
    resetAnimationSignals()
    expect(readAnimationGesture()).toBeNull()
    expect(readAnimationGeneration()).toBeGreaterThan(generation)
    publishAnimationGesture({ type: 'PUNCH_LEFT', timestamp: 300, confidence: 0.9 })
    expect(readAnimationGesture()?.generation).toBe(readAnimationGeneration())
    expect(readAnimationGesture()?.sequence).toBeGreaterThan(first?.sequence ?? 0)
  })
})
