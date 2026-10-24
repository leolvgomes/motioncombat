import { describe, expect, it } from 'vitest'
import type { CombatEvent, ImpactEvent } from '../../types/combat'
import { CameraShake, ImpactParticles, ImpactPulses, impactFeedback } from './impact-effects'

function impactEvent(result: ImpactEvent['result'], attacker: ImpactEvent['attacker'] = 'player', defenderHealth = 60): Extract<CombatEvent, { type: 'impact' }> {
  return { type: 'impact', impact: { id: 1, attacker, result, damage: 12 }, position: [0, 1.3, 0.4], defenderHealth }
}

describe('ImpactParticles', () => {
  it('emits deterministic sparks that travel with the punch, fall and expire', () => {
    const first = new ImpactParticles(64, 9)
    const second = new ImpactParticles(64, 9)
    expect(first.burst('hit', 0, 1.3, 0.4, 1)).toBe(14)
    second.burst('hit', 0, 1.3, 0.4, 1)
    expect(Array.from(first.velocity)).toEqual(Array.from(second.velocity))
    let forward = 0
    for (let index = 0; index < first.count; index++) forward += first.velocity[index * 3 + 2]
    expect(forward).toBeGreaterThan(0)

    const startY = first.position[1]
    // Lifetimes are 0.28–0.50 s: all alive after 0.25 s, all gone after 0.55 s.
    for (let frame = 0; frame < 15; frame++) first.step(1 / 60)
    expect(first.count).toBe(14)
    expect(first.fade(0)).toBeLessThan(1)
    for (let frame = 0; frame < 18; frame++) first.step(1 / 60)
    expect(first.count).toBe(0)
    expect(startY).toBeCloseTo(1.3)
  })

  it('respects its fixed capacity and ignores invalid bursts', () => {
    const particles = new ImpactParticles(20)
    expect(particles.burst('hit', 0, 0, 0, -1, 1)).toBe(14)
    expect(particles.burst('hit', 0, 0, 0, -1, 1)).toBe(6)
    expect(particles.count).toBe(20)
    expect(particles.burst('blocked', 0, 0, 0, 1)).toBe(0)
    particles.clear()
    expect(particles.burst('blocked', Number.NaN, 0, 0, 1)).toBe(0)
    expect(particles.burst('blocked', 0, 0, 0, 1, 0)).toBe(0)
    expect(particles.burst('blocked', 0, 0, 0, 1, 0.5)).toBe(5)
  })

  it('keeps surviving sparks intact when expired ones are removed', () => {
    const particles = new ImpactParticles(32, 3)
    particles.burst('blocked', 5, 5, 5, 1)
    for (let frame = 0; frame < 25; frame++) particles.step(1 / 60)
    for (let index = 0; index < particles.count; index++) {
      expect(particles.life[index]).toBeGreaterThan(0)
      expect(Number.isFinite(particles.position[index * 3])).toBe(true)
    }
    particles.step(Number.NaN)
    particles.step(-1)
  })
})

describe('ImpactPulses and CameraShake', () => {
  it('recycles the oldest pulse and expires each one after its duration', () => {
    const pulses = new ImpactPulses(2)
    pulses.spawn('hit', 1, 1, 1)
    pulses.spawn('blocked', 2, 2, 2)
    pulses.spawn('hit', 3, 3, 3)
    expect(pulses.pulses.map((pulse) => pulse.x)).toEqual([3, 2])
    pulses.step(0.1)
    expect(pulses.progress(pulses.pulses[0])).toBeCloseTo(0.1 / 0.24)
    pulses.step(0.1)
    pulses.step(0.1)
    expect(pulses.pulses[0].active).toBe(false)
    expect(pulses.pulses[1].active).toBe(true)
    pulses.step(0.1)
    expect(pulses.pulses[1].active).toBe(false)
  })

  it('shakes in proportion to trauma squared, decays to rest and stays bounded', () => {
    const shake = new CameraShake(0.1, 2)
    const offset = { x: 0, y: 0, z: 0 }
    shake.add(5)
    expect(shake.trauma).toBe(1)
    let largest = 0
    for (let frame = 0; frame < 60; frame++) {
      shake.step(1 / 60)
      shake.offset(offset)
      largest = Math.max(largest, Math.abs(offset.x), Math.abs(offset.y), Math.abs(offset.z))
    }
    expect(largest).toBeGreaterThan(0.005)
    expect(largest).toBeLessThanOrEqual(0.1)
    expect(shake.trauma).toBe(0)
    shake.offset(offset)
    expect([offset.x, offset.y, offset.z]).toEqual([0, 0, 0])
    shake.add(Number.NaN)
    shake.add(-1)
    expect(shake.trauma).toBe(0)
  })
})

describe('impactFeedback', () => {
  it('maps contact results to sparks, direction and shake', () => {
    expect(impactFeedback(impactEvent('hit'), 'webcam')).toEqual({ burst: 'hit', amount: 1, shake: 0.3, direction: 1 })
    expect(impactFeedback(impactEvent('hit', 'opponent'), 'webcam')).toEqual({ burst: 'hit', amount: 1, shake: 0.5, direction: -1 })
    expect(impactFeedback(impactEvent('hit', 'opponent'), 'demo').shake).toBe(0.3)
    expect(impactFeedback(impactEvent('blocked'), 'webcam')).toMatchObject({ burst: 'blocked', shake: 0.12 })
    expect(impactFeedback(impactEvent('dodged'), 'webcam')).toMatchObject({ burst: null, shake: 0 })
    expect(impactFeedback(impactEvent('miss'), 'webcam')).toMatchObject({ burst: null, shake: 0 })
  })

  it('emphasises a knockout, including a chip-damage knockout through the guard', () => {
    expect(impactFeedback(impactEvent('hit', 'player', 0), 'webcam')).toMatchObject({ amount: 1.8, shake: 0.85 })
    expect(impactFeedback(impactEvent('blocked', 'player', 0), 'webcam')).toMatchObject({ burst: 'blocked', amount: 1.2, shake: 0.6 })
  })
})
