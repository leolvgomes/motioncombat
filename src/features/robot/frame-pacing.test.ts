import { describe, expect, it } from 'vitest'
import { FramePacer, MIN_FRAME_MS, TRACKING_FRAME_STEPS_MS, shouldRender } from './frame-pacing'
import { prefersWorker } from '../../stores/lab-store'
import { parseGpu } from './gpu-info'

/** Frames drawn per second on a display of the given rate. */
function drawn(displayHz: number, minimum: number): number {
  let last = -Infinity
  let count = 0
  for (let frame = 0; frame < displayHz; frame++) {
    const now = frame * 1000 / displayHz
    if (shouldRender(now, last, minimum)) { last = now; count++ }
  }
  return count
}

describe('frame limit', () => {
  it.each([[60, 60], [75, 75], [120, 60], [144, 72], [30, 30]])('draws an even share of a %s Hz display', (display, expected) => {
    expect(drawn(display, MIN_FRAME_MS)).toBe(expected)
  })

  it('keeps 60 FPS while tracking on an ordinary display and steps down evenly', () => {
    expect(TRACKING_FRAME_STEPS_MS.map((minimum) => drawn(60, minimum))).toEqual([60, 30, 30, 20])
  })
})

describe('FramePacer', () => {
  const feed = (pacer: FramePacer, latency: number, count: number) => { for (let index = 0; index < count; index++) pacer.observe(latency) }

  it('stays fluid while poses arrive on time', () => {
    const pacer = new FramePacer()
    feed(pacer, 25, 200)
    expect(pacer.minimumMs).toBe(TRACKING_FRAME_STEPS_MS[0])
  })

  it('gives up frames one step at a time until the limit', () => {
    const pacer = new FramePacer()
    const seen = new Set<number>()
    for (let index = 0; index < 80; index++) { pacer.observe(90); seen.add(pacer.minimumMs) }
    expect([...seen]).toEqual([...TRACKING_FRAME_STEPS_MS])
  })

  it('ignores a single slow sample and invalid values', () => {
    const pacer = new FramePacer()
    feed(pacer, 30, 20)
    pacer.observe(600)
    pacer.observe(Number.NaN)
    pacer.observe(-1)
    feed(pacer, 30, 20)
    expect(pacer.minimumMs).toBe(TRACKING_FRAME_STEPS_MS[0])
  })

  it('holds between both thresholds', () => {
    const pacer = new FramePacer()
    feed(pacer, 90, 8)
    const held = pacer.minimumMs
    feed(pacer, 48, 400)
    expect(pacer.minimumMs).toBe(held)
  })

  it('recovers slowly and does not oscillate when the fluid step is too expensive', () => {
    const pacer = new FramePacer()
    let changes = 0
    let previous = pacer.minimumMs
    // The fluid step costs 80 ms; the next one leaves room. Ten minutes of samples.
    for (let index = 0; index < 2400; index++) {
      pacer.observe(pacer.minimumMs === TRACKING_FRAME_STEPS_MS[0] ? 80 : 30)
      if (pacer.minimumMs !== previous) { changes++; previous = pacer.minimumMs }
    }
    expect(changes).toBeGreaterThan(1)
    expect(changes).toBeLessThan(30)
    pacer.reset()
    expect(pacer.minimumMs).toBe(TRACKING_FRAME_STEPS_MS[0])
  })
})

describe('parseGpu', () => {
  it.each([
    ['ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel UHD Graphics', true, false],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 3050 Laptop GPU', false, false],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon Graphics', true, false],
    ['ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 6700 XT', false, false],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', null, false, true],
    ['Apple M2', 'Apple M2', false, false],
  ])('understands %s', (renderer, name, integrated, software) => {
    const info = parseGpu(renderer)
    if (name) expect(info.name).toBe(name)
    expect(info).toMatchObject({ integrated, software })
  })

  it('keeps automatic tracking on the page only for shared or software graphics', () => {
    const gpu = (integrated: boolean, software = false) => ({ name: 'x', integrated, software })
    expect(prefersWorker('auto', gpu(false))).toBe(true)
    expect(prefersWorker('auto', null)).toBe(true)
    expect(prefersWorker('auto', gpu(true))).toBe(false)
    expect(prefersWorker('auto', gpu(false, true))).toBe(false)
    expect(prefersWorker('worker', gpu(true))).toBe(true)
    expect(prefersWorker('page', gpu(false))).toBe(false)
  })

  it('never guesses when the browser hides the hardware', () => {
    expect(parseGpu(null)).toEqual({ name: null, integrated: false, software: false })
  })
})
