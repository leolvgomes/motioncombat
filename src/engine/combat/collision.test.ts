import { describe, expect, it } from 'vitest'
import { Euler, Group, Quaternion, Vector3 } from 'three'
import type { AttackSide } from '../../types/animation'
import type { CombatRotations, FighterFrame } from '../../types/combat'
import { CombatHitGeometry, segmentDistanceSquared } from './collision'

function rotations(): CombatRotations {
  return {
    torso: new Quaternion(), head: new Quaternion(),
    leftShoulder: new Quaternion(), leftElbow: new Quaternion(), leftWrist: new Quaternion(),
    rightShoulder: new Quaternion(), rightElbow: new Quaternion(), rightWrist: new Quaternion(),
  }
}

function frame(overrides: Partial<FighterFrame> = {}): FighterFrame {
  return {
    position: [0, 0, 0], yaw: 0, rotations: rotations(), action: 'idle',
    attackSide: null, attackProgress: 0, hitActive: false, hitFlash: 0, blocking: false,
    ...overrides,
  }
}

/** Independent Three.js object hierarchy with the model's authored joint offsets. */
function sceneHierarchy(target: FighterFrame) {
  const root = new Group()
  root.position.fromArray(target.position)
  root.rotation.y = target.yaw
  const torso = new Group()
  torso.position.y = 1.2
  torso.quaternion.copy(target.rotations.torso)
  root.add(torso)
  const attach = (parent: Group, position: readonly [number, number, number], rotation?: Quaternion) => {
    const child = new Group()
    child.position.fromArray(position)
    if (rotation) child.quaternion.copy(rotation)
    parent.add(child)
    return child
  }
  const fists = {} as Record<AttackSide, Group>
  for (const side of ['left', 'right'] as const) {
    const shoulder = attach(torso, [side === 'left' ? 0.53 : -0.53, 0.63, 0], target.rotations[side === 'left' ? 'leftShoulder' : 'rightShoulder'])
    const elbow = attach(shoulder, [0, -0.47, 0], target.rotations[side === 'left' ? 'leftElbow' : 'rightElbow'])
    const wrist = attach(elbow, [0, -0.43, 0], target.rotations[side === 'left' ? 'leftWrist' : 'rightWrist'])
    fists[side] = attach(wrist, [0, -0.12, 0.015])
  }
  const torsoCenter = attach(torso, [0, 0.5, 0])
  const head = attach(torso, [0, 0.96, 0], target.rotations.head)
  const headCenter = attach(head, [0, 0.09, 0])
  root.updateMatrixWorld(true)
  return { root, fists, torsoCenter, headCenter }
}

describe('segmentDistanceSquared', () => {
  it('measures two points and point-to-segment interiors or clamped endpoints', () => {
    const point = new Vector3(1, 2, 3)
    const other = new Vector3(4, 4, 3)
    expect(segmentDistanceSquared(point, point, other, other)).toBe(13)
    const start = new Vector3(-2, 0, 0)
    const end = new Vector3(2, 0, 0)
    const inside = new Vector3(0, 1, 0)
    const outside = new Vector3(4, 1, 0)
    expect(segmentDistanceSquared(inside, inside, start, end)).toBeCloseTo(1)
    expect(segmentDistanceSquared(start, end, outside, outside)).toBeCloseTo(5)
  })

  it('finds crossings in a plane and the separation of skew segments in 3D', () => {
    const first = [new Vector3(-1, 0, 0), new Vector3(1, 0, 0)] as const
    expect(segmentDistanceSquared(...first, new Vector3(0, -1, 0), new Vector3(0, 1, 0))).toBeCloseTo(0)
    expect(segmentDistanceSquared(...first, new Vector3(0, -1, 2), new Vector3(0, 1, 2))).toBeCloseTo(4)
  })

  it('handles parallel overlap, collinear separation and endpoint order symmetrically', () => {
    const p = new Vector3(0, 0, 0), q = new Vector3(2, 0, 0)
    const a = new Vector3(1, 3, 0), b = new Vector3(3, 3, 0)
    expect(segmentDistanceSquared(p, q, a, b)).toBeCloseTo(9)
    expect(segmentDistanceSquared(b, a, q, p)).toBeCloseTo(9)
    expect(segmentDistanceSquared(p, q, new Vector3(4, 0, 0), new Vector3(5, 0, 0))).toBeCloseTo(4)
  })

  it('treats nearly zero-length segments as finite point-like geometry', () => {
    expect(segmentDistanceSquared(new Vector3(), new Vector3(1e-8, 0, 0), new Vector3(0, 2, 0), new Vector3(0, 2 + 1e-8, 0))).toBeCloseTo(4)
  })

  it('returns infinite distance for a NaN or infinity in any endpoint', () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      for (let index = 0; index < 4; index++) {
        const points = [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0)] as const
        points[index]?.set(value, 0, 0)
        expect(segmentDistanceSquared(...points)).toBe(Infinity)
      }
    }
  })
})

describe('CombatHitGeometry', () => {
  it.each(['left', 'right'] as const)('matches the %s fist to a hierarchical Three.js scene under full joint, torso and root transforms', (side) => {
    const pose = rotations()
    pose.torso.setFromEuler(new Euler(0.13, -0.2, 0.31))
    pose.leftShoulder.setFromEuler(new Euler(1.2, 0.22, -0.15))
    pose.leftElbow.setFromEuler(new Euler(0.72, -0.14, 0.23))
    pose.leftWrist.setFromEuler(new Euler(-0.12, 0.33, -0.18))
    pose.rightShoulder.setFromEuler(new Euler(0.9, -0.28, 0.17))
    pose.rightElbow.setFromEuler(new Euler(1.1, 0.19, -0.12))
    pose.rightWrist.setFromEuler(new Euler(0.14, -0.31, 0.22))
    const target = frame({ position: [1.4, 0.18, -2.2], yaw: -Math.PI * 0.65, rotations: pose })
    const actual = sceneHierarchy(target).fists[side].getWorldPosition(new Vector3())
    const out = new Vector3()
    expect(new CombatHitGeometry().fist(target, side, out)).toBe(out)
    expect(out.distanceTo(actual)).toBeLessThan(1e-10)
  })

  it('detects torso sweeps and head-only contact while rejecting paths above the head', () => {
    const geometry = new CombatHitGeometry()
    const target = frame()
    expect(geometry.intersects(new Vector3(-1, 1.7, 0), new Vector3(1, 1.7, 0), target)).toBe(true)
    expect(geometry.intersects(new Vector3(-1, 2.58, 0), new Vector3(1, 2.58, 0), target)).toBe(true)
    expect(geometry.intersects(new Vector3(-1, 2.8, 0), new Vector3(1, 2.8, 0), target)).toBe(false)
  })

  it('projects torso and head collision targets through the same yaw and joint hierarchy as the scene', () => {
    const pose = rotations()
    pose.torso.setFromEuler(new Euler(0.22, -0.19, 0.38))
    pose.head.setFromEuler(new Euler(-0.6, 0.3, 0.15))
    const target = frame({ position: [-1.1, 0.35, 2.4], yaw: Math.PI / 2, rotations: pose })
    const hierarchy = sceneHierarchy(target)
    const geometry = new CombatHitGeometry()
    for (const node of [hierarchy.torsoCenter, hierarchy.headCenter]) {
      const center = node.getWorldPosition(new Vector3())
      expect(geometry.intersects(center.clone().add(new Vector3(-0.7, 0, 0)), center.clone().add(new Vector3(0.7, 0, 0)), target)).toBe(true)
    }
  })

  it('misses left and right dodge offsets but identifies the undodged path without moving the target', () => {
    const geometry = new CombatHitGeometry()
    for (const x of [-0.9, 0.9]) {
      const target = frame({ position: [x, 0, 0], yaw: x < 0 ? -Math.PI / 2 : Math.PI })
      const from = new Vector3(0, 1.7, -0.15), to = new Vector3(0, 1.7, 0.15)
      expect(geometry.intersects(from, to, target)).toBe(false)
      expect(geometry.intersects(from, to, target, 0)).toBe(true)
      expect(target.position).toEqual([x, 0, 0])
    }
  })

  it('rejects non-finite sweep or target transforms without false contacts', () => {
    const geometry = new CombatHitGeometry()
    const from = new Vector3(0, 1.7, -0.1), to = new Vector3(0, 1.7, 0.1)
    expect(geometry.intersects(new Vector3(Number.NaN, 1.7, 0), to, frame())).toBe(false)
    expect(geometry.intersects(from, to, frame({ yaw: Infinity }))).toBe(false)
    expect(geometry.intersects(from, to, frame({ position: [0, Number.NaN, 0] }))).toBe(false)
    const pose = rotations()
    pose.torso.set(Number.NaN, 0, 0, 1)
    expect(geometry.intersects(from, to, frame({ rotations: pose }))).toBe(false)
  })
})
