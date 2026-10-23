import { describe, expect, it } from 'vitest'
import type { Landmark, PoseFrame } from '../../types/motion'
import { PoseProcessor, TRACKED_LANDMARKS, UPPER_BODY_CONNECTIONS } from './pose-processor'

type Overrides = Readonly<Partial<Record<number, Partial<Landmark>>>>

function frame(timestamp = 0, overrides: Overrides = {}): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  const positions: Readonly<Record<number, readonly [number, number]>> = {
    0: [0.5, 0.15],
    11: [0.35, 0.35],
    12: [0.65, 0.35],
    13: [0.3, 0.55],
    14: [0.7, 0.55],
    15: [0.25, 0.4],
    16: [0.75, 0.4],
    23: [0.4, 0.95],
    24: [0.6, 0.95],
  }
  for (const index of TRACKED_LANDMARKS) {
    const [x, y] = positions[index]!
    landmarks[index] = { x, y, z: -0.1, visibility: 0.9, ...overrides[index] }
  }
  return { timestamp, landmarks, worldLandmarks: landmarks.map((point) => ({ ...point, x: point.x - 0.5 })) }
}

function shiftedFrame(timestamp: number, offset: number): PoseFrame {
  const source = frame(timestamp)
  return { ...source, landmarks: source.landmarks.map((point) => ({ ...point, x: point.x + offset })) }
}

describe('PoseProcessor', () => {
  it('reports real upper-body confidence and on-screen landmark counts', () => {
    const result = new PoseProcessor().process(frame())
    expect(result.confidence).toBeCloseTo(0.9)
    expect(result.visibleCount).toBe(9)
    expect(result.upperBodyVisibleCount).toBe(9)
    expect(result.status).toBe('tracking')
    expect(result.framing).toBe('ready')
    expect(result.shoulderWidth).toBeCloseTo(0.3)
    expect(result.torsoLean).toBeCloseTo(0)
    expect(UPPER_BODY_CONNECTIONS).toHaveLength(8)
  })

  it('immediately reports partial or lost tracking when confidence falls', () => {
    const processor = new PoseProcessor()
    processor.process(frame())
    const result = processor.process(frame(33, { 15: { visibility: 0.1 }, 16: { visibility: 0.1 } }))
    expect(result.status).toBe('partial')
    expect(result.framing).toBe('partial')
    expect(result.upperBodyVisibleCount).toBe(7)
    expect(result.confidence).toBeCloseTo((7 * 0.9 + 2 * 0.1) / 9)
    expect(processor.process({ timestamp: 66, landmarks: [], worldLandmarks: [] }).status).toBe('searching')
  })

  it('smooths according to elapsed time rather than inference frequency', () => {
    const sampleAt = (interval: number): number => {
      const processor = new PoseProcessor()
      processor.process(shiftedFrame(0, 0))
      let position = 0
      for (let timestamp = interval; timestamp <= 200; timestamp += interval) {
        position = processor.process(shiftedFrame(timestamp, 0.1)).landmarks[15]!.x
      }
      return position
    }
    expect(sampleAt(10)).toBeCloseTo(sampleAt(40), 10)
    expect(sampleAt(20)).toBeGreaterThan(0.25)
    expect(sampleAt(20)).toBeLessThan(0.35)
  })

  it('starts a new filter after a long capture gap, a changed clock or explicit reset', () => {
    const processor = new PoseProcessor()
    processor.process(shiftedFrame(0, 0))
    expect(processor.process(shiftedFrame(500, 0.1)).landmarks[15]!.x).toBeCloseTo(0.35)
    expect(processor.process(shiftedFrame(20, 0)).landmarks[15]!.x).toBeCloseTo(0.25)
    processor.reset()
    expect(processor.process(shiftedFrame(30, 0.1)).landmarks[15]!.x).toBeCloseTo(0.35)
  })

  it('does not blend recovered tracking with stale positions after a prolonged loss', () => {
    const processor = new PoseProcessor()
    processor.process(frame(0))
    const hidden = Object.fromEntries(TRACKED_LANDMARKS.map((index) => [index, { visibility: 0 }]))
    for (let timestamp = 50; timestamp <= 500; timestamp += 50) processor.process(frame(timestamp, hidden))
    expect(processor.process(shiftedFrame(550, 0.1)).landmarks[15]!.x).toBeCloseTo(0.35)
  })

  it('resets an individual joint after prolonged occlusion while the remaining body stays visible', () => {
    const processor = new PoseProcessor()
    processor.process(frame(0))
    for (let timestamp = 50; timestamp <= 500; timestamp += 50) {
      const result = processor.process(frame(timestamp, { 15: { visibility: 0 } }))
      expect(result.status).toBe('partial')
      expect(result.upperBodyVisibleCount).toBe(8)
    }
    expect(processor.process(shiftedFrame(550, 0.1)).landmarks[15]!.x).toBeCloseTo(0.35)
  })

  it('rejects invalid coordinates and confidence while keeping all output numbers finite', () => {
    const processor = new PoseProcessor()
    processor.process(frame())
    const result = processor.process(frame(33, {
      11: { x: Number.NaN },
      12: { z: Number.POSITIVE_INFINITY },
      13: { visibility: Number.NaN },
      14: { visibility: 5 },
      15: { visibility: -5 },
    }))
    expect(result.landmarks[11]!.x).toBeCloseTo(0.35)
    expect(result.landmarks[11]!.visibility).toBe(0)
    expect(result.landmarks[14]!.visibility).toBe(1)
    expect(result.landmarks[15]!.visibility).toBe(0)
    expect(result.upperBodyVisibleCount).toBe(5)
    expect(result.landmarks.every((point) => Object.values(point).every(Number.isFinite))).toBe(true)
    expect(result.shoulderWidth).toBe(0)
    expect(result.torsoLean).toBeNull()
  })

  it('initializes newly visible landmarks without smoothing from an invalid origin', () => {
    const processor = new PoseProcessor()
    processor.process(frame(0, { 15: { x: Number.NaN } }))
    expect(processor.process(frame(33)).landmarks[15]!.x).toBeCloseTo(0.25)
  })

  it('retains last coordinates during occlusion without presenting stale points as visible', () => {
    const processor = new PoseProcessor()
    processor.process(frame(0))
    const result = processor.process(frame(33, { 15: { x: 1.5 } }))
    expect(result.landmarks[15]!.x).toBeCloseTo(0.25)
    expect(result.landmarks[15]!.visibility).toBe(0)
    expect(result.upperBodyVisibleCount).toBe(8)
    expect(result.status).toBe('partial')
  })

  it('marks off-screen landmarks invisible even before any trustworthy position exists', () => {
    const result = new PoseProcessor().process(frame(0, { 15: { x: 1.5, visibility: 0.99 } }))
    expect(result.landmarks[15]!.visibility).toBe(0)
    expect(result.upperBodyVisibleCount).toBe(8)
    expect(result.status).toBe('partial')
  })

  it('gives framing advice using normalized body proportions', () => {
    expect(new PoseProcessor().process(frame(0, { 11: { x: 0.15 }, 12: { x: 0.85 } })).framing).toBe('too-close')
    expect(new PoseProcessor().process(frame(0, { 11: { x: 0.01 }, 12: { x: 0.31 } })).framing).toBe('off-center')
    expect(new PoseProcessor().process(frame(0, { 23: { y: 1.05 }, 24: { y: 1.05 } })).framing).toBe('ready')
    expect(new PoseProcessor().process({ timestamp: 0, landmarks: [], worldLandmarks: [] }).framing).toBe('searching')
  })

  it('exposes torso lean in radians and refuses degenerate torso geometry', () => {
    const result = new PoseProcessor().process(frame(0, { 23: { x: 0.3 }, 24: { x: 0.5 } }))
    expect(result.torsoLean).toBeCloseTo(Math.atan2(0.1, 0.6))
    expect(new PoseProcessor().process(frame(0, { 23: { y: 0.35 }, 24: { y: 0.35 } })).torsoLean).toBeNull()
  })

  it('retains validated world coordinates without smoothing or mutating source data', () => {
    const processor = new PoseProcessor()
    processor.process(frame(0))
    const source = frame(33)
    const worldLandmarks = source.worldLandmarks.map((point) => ({ ...point, x: point.x + 0.2 }))
    const result = processor.process({ ...source, worldLandmarks })
    expect(result.worldLandmarks[15]!.x).toBeCloseTo(-0.05)
    expect(result.worldLandmarks).not.toBe(worldLandmarks)
    expect(source.landmarks[15]!.x).toBeCloseTo(0.25)
    expect(source.worldLandmarks[15]!.x).toBeCloseTo(-0.25)
  })
})
