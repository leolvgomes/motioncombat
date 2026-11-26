import { describe, expect, it } from 'vitest'
import { FALL_SECONDS, KnockoutCinematic, SmokePuffs, SpecialFlash, damageLevel, fallAmount, lightFlicker, smokeRate } from './cinematic-effects'

describe('damage presentation', () => {
  it('maps integrity to a bounded damage level', () => {
    expect([100, 50, 0, 140, -5, Number.NaN].map((health) => damageLevel(health))).toEqual([0, 0.5, 1, 0, 1, 0])
  })

  it('smokes only past half damage and more as it grows', () => {
    expect(smokeRate(0.3)).toBe(0)
    expect(smokeRate(0.6)).toBeGreaterThan(0)
    expect(smokeRate(1)).toBeGreaterThan(smokeRate(0.6))
  })

  it('flickers lights only when critical, deterministically', () => {
    const samples = (level: number) => Array.from({ length: 400 }, (_, index) => lightFlicker(level, index / 60))
    expect(samples(0.6).every((value) => value === 1)).toBe(true)
    const critical = samples(0.95)
    expect(critical.some((value) => value < 1)).toBe(true)
    expect(critical.some((value) => value === 1)).toBe(true)
    expect(samples(0.95)).toEqual(critical)
  })
})

describe('knockout fall', () => {
  it('accelerates, lands and settles without leaving the floor range', () => {
    expect(fallAmount(0)).toBe(0)
    expect(fallAmount(FALL_SECONDS / 2)).toBeLessThan(0.5)
    expect(fallAmount(FALL_SECONDS)).toBeCloseTo(1, 5)
    const after = Array.from({ length: 120 }, (_, index) => fallAmount(FALL_SECONDS + index / 60))
    expect(Math.min(...after)).toBeGreaterThan(0.94)
    expect(Math.max(...after)).toBeLessThan(1.06)
    expect(fallAmount(FALL_SECONDS + 5)).toBeCloseTo(1, 3)
    expect(fallAmount(Number.NaN)).toBe(0)
  })
})

describe('KnockoutCinematic', () => {
  it('slows time, closes in and then returns to normal', () => {
    const cinematic = new KnockoutCinematic()
    expect(cinematic.timeScale).toBe(1)
    expect(cinematic.closeUp).toBe(0)
    cinematic.trigger(0, 1, 2)
    expect(cinematic.timeScale).toBe(KnockoutCinematic.SLOW_SCALE)
    for (let frame = 0; frame < 30; frame++) cinematic.step(1 / 60)
    expect(cinematic.closeUp).toBe(1)
    let previous = cinematic.timeScale
    for (let frame = 0; frame < 200; frame++) {
      cinematic.step(1 / 60)
      expect(cinematic.timeScale).toBeGreaterThanOrEqual(previous)
      previous = cinematic.timeScale
    }
    expect(cinematic.active).toBe(false)
    expect(cinematic.timeScale).toBe(1)
    expect(cinematic.closeUp).toBe(0)
  })

  it('ignores invalid focus points and can be cleared', () => {
    const cinematic = new KnockoutCinematic()
    cinematic.trigger(Number.NaN, 0, 0)
    expect(cinematic.active).toBe(false)
    cinematic.trigger(1, 1, 1)
    cinematic.clear()
    expect(cinematic.timeScale).toBe(1)
  })
})

describe('SpecialFlash', () => {
  it('fades out after the contact', () => {
    const flash = new SpecialFlash()
    expect(flash.strength).toBe(0)
    flash.trigger()
    expect(flash.strength).toBe(1)
    for (let frame = 0; frame < 30; frame++) flash.step(1 / 60)
    expect(flash.strength).toBe(0)
  })
})

describe('SmokePuffs', () => {
  it('carries fractional emission over frames and respects capacity', () => {
    const smoke = new SmokePuffs(4)
    let emitted = 0
    for (let frame = 0; frame < 60; frame++) emitted += smoke.emit('torso', 3, 1 / 60, 0, 1.5, 0)
    expect(emitted).toBe(3)
    for (let frame = 0; frame < 60; frame++) smoke.emit('torso', 30, 1 / 60, 0, 1.5, 0)
    expect(smoke.count).toBe(4)
  })

  it('rises, ages and expires', () => {
    const smoke = new SmokePuffs(8)
    smoke.emit('head', 60, 1 / 60, 0, 2, 0)
    expect(smoke.count).toBe(1)
    const start = smoke.position[1]!
    smoke.step(0.5)
    expect(smoke.position[1]).toBeGreaterThan(start)
    expect(smoke.age(0)).toBeGreaterThan(0)
    for (let frame = 0; frame < 30; frame++) smoke.step(0.1)
    expect(smoke.count).toBe(0)
  })

  it('emits nothing for an intact robot or invalid positions', () => {
    const smoke = new SmokePuffs(8)
    expect(smoke.emit('a', 0, 1, 0, 0, 0)).toBe(0)
    expect(smoke.emit('a', 10, 1, Number.NaN, 0, 0)).toBe(0)
    expect(smoke.count).toBe(0)
  })
})
