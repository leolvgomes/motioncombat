import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Landmark, ProcessedPose } from '../../types/motion'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { useCombatMotionStore } from '../../stores/combat-motion-store'
import { combatMotionRuntime } from './combat-motion-runtime'

/** Synthetic inputs exercise the full real engine pipeline, never the application camera. */
function pose(timestamp: number, posture: 'neutral' | 'guard' | 'punch', progress = 0): ProcessedPose {
  const empty = (): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
  const landmarks = empty()
  const worldLandmarks = empty()
  const point = (x: number, y: number, z = 0): Landmark => ({ x, y, z, visibility: 0.95 })
  landmarks[0] = point(0.5, 0.15)
  landmarks[11] = point(0.65, 0.4)
  landmarks[12] = point(0.35, 0.4)
  landmarks[23] = point(0.6, 0.9)
  landmarks[24] = point(0.4, 0.9)
  worldLandmarks[11] = point(0.2, -0.4)
  worldLandmarks[12] = point(-0.2, -0.4)
  for (const side of [1, -1] as const) {
    const elbowIndex = side === 1 ? 13 : 14
    const wristIndex = side === 1 ? 15 : 16
    const guarded = posture !== 'neutral'
    const p = posture === 'punch' && side === 1 ? progress : 0
    const blend = (a: number, b: number) => a + (b - a) * p
    landmarks[elbowIndex] = guarded ? point(blend(0.5 + side * 0.23, 0.65), blend(0.6, 0.4)) : point(0.5 + side * 0.2, 0.6)
    landmarks[wristIndex] = guarded ? point(blend(0.5 + side * 0.1, 0.65), blend(0.23, 0.4)) : point(0.5 + side * 0.22, 0.84)
    worldLandmarks[elbowIndex] = guarded ? point(blend(side * 0.3, 0.2), blend(-0.14, -0.4), blend(-0.1, -0.3)) : point(side * 0.24, -0.1, 0.02)
    worldLandmarks[wristIndex] = guarded ? point(blend(side * 0.14, 0.2), blend(-0.42, -0.4), blend(-0.18, -0.6)) : point(side * 0.25, 0.15, 0.05)
  }
  return { timestamp, landmarks, worldLandmarks, confidence: 0.95, visibleCount: 9, upperBodyVisibleCount: 9, status: 'tracking', framing: 'ready', shoulderWidth: 0.3, torsoLean: 0 }
}

const snapshot = () => useCombatMotionStore.getState().snapshot
function calibrate() {
  combatMotionRuntime.startCalibration()
  for (let timestamp = 0; timestamp <= 1500; timestamp += 50) combatMotionRuntime.process(pose(timestamp, 'neutral'))
  combatMotionRuntime.publish()
  expect(snapshot().calibration.stage).toBe('guard')
  for (let timestamp = 1550; timestamp <= 2800; timestamp += 50) combatMotionRuntime.process(pose(timestamp, 'guard'))
  combatMotionRuntime.publish()
  expect(snapshot().calibration.stage).toBe('complete')
}

beforeEach(() => {
  useLabStore.setState({ session: { status: 'running', error: null, delegate: 'CPU' } })
  useRobotStore.setState({ mode: 'tracking' })
  combatMotionRuntime.reset()
})
afterEach(() => {
  combatMotionRuntime.reset()
  useLabStore.setState({ session: { status: 'idle', error: null, delegate: null } })
  useRobotStore.setState({ mode: 'tracking' })
})

describe('live calibration and gesture integration', () => {
  it('keeps recognition disabled until both real-pose calibration holds complete', () => {
    for (let index = 0; index < 6; index++) combatMotionRuntime.process(pose(index * 42, 'punch', index / 5))
    combatMotionRuntime.publish()
    expect(snapshot().events).toEqual([])
    expect(snapshot().features).toBeNull()
    combatMotionRuntime.startCalibration()
    for (let index = 0; index < 6; index++) combatMotionRuntime.process(pose(index * 42, 'punch', index / 5))
    combatMotionRuntime.publish()
    expect(snapshot().calibration.stage).toBe('neutral')
    expect(snapshot().events).toEqual([])
  })

  it('passes a forward trajectory from landmarks through calibration, velocity and recognition once', () => {
    calibrate()
    for (let index = 0; index < 6; index++) combatMotionRuntime.process(pose(2850 + index * 42, 'guard'))
    for (const [index, progress] of [0, 0.2, 0.45, 0.7, 0.9, 1].entries()) combatMotionRuntime.process(pose(3150 + index * 42, 'punch', progress))
    for (let index = 0; index < 15; index++) combatMotionRuntime.process(pose(3450 + index * 42, 'punch', 1))
    combatMotionRuntime.publish()
    expect(snapshot().events.filter((event) => event.type === 'PUNCH_LEFT')).toHaveLength(1)
    expect(snapshot().features?.leftArm?.depthAvailable).toBe(true)
    expect(snapshot().features?.leftArm?.extension).toBeCloseTo(1)
  })

  it('invalidates calibration and gesture history when demo replaces a live source', () => {
    calibrate()
    useRobotStore.setState({ mode: 'demo' })
    combatMotionRuntime.process(pose(3000, 'punch', 1))
    expect(snapshot().calibration.profile).toBeNull()
    expect(snapshot().events).toEqual([])
    expect(snapshot().features).toBeNull()
    combatMotionRuntime.startCalibration()
    expect(snapshot().calibration.stage).toBe('idle')
  })

  it('rejects a late capture after the session stops and clears a canceled calibration', () => {
    calibrate()
    useLabStore.setState({ session: { status: 'idle', error: null, delegate: null } })
    combatMotionRuntime.process(pose(3000, 'punch', 1))
    expect(snapshot().calibration.profile).toBeNull()
    expect(snapshot().events).toEqual([])
    useLabStore.setState({ session: { status: 'running', error: null, delegate: 'CPU' } })
    combatMotionRuntime.startCalibration()
    combatMotionRuntime.process(pose(3100, 'neutral'))
    combatMotionRuntime.cancelCalibration()
    expect(snapshot().calibration.stage).toBe('idle')
  })
})
