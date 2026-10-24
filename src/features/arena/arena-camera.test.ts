import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { samplePunchClip } from '../../engine/animation/combat-clips'
import { createRestPose, sampleDemoPose } from '../../engine/motion/retarget'
import type { RigPose } from '../../types/robot'
import { ARENA_CAMERA_FOV, ARENA_CAMERA_TARGET, getArenaCameraPosition } from './arena-camera'

function camera(aspect: number) {
  const result = new PerspectiveCamera(ARENA_CAMERA_FOV, aspect, 0.1, 100)
  result.position.fromArray(getArenaCameraPosition(aspect))
  result.lookAt(...ARENA_CAMERA_TARGET)
  result.updateMatrixWorld()
  return result
}

function handCenter(pose: RigPose, side: 'left' | 'right'): Vector3 {
  const torso = new Quaternion().fromArray(pose.torso)
  const upper = torso.clone().multiply(new Quaternion().fromArray(pose[`${side}Shoulder`]))
  const forearm = upper.clone().multiply(new Quaternion().fromArray(pose[`${side}Elbow`]))
  const wrist = forearm.clone().multiply(new Quaternion().fromArray(pose[`${side}Wrist`]))
  return new Vector3(side === 'left' ? 0.53 : -0.53, 0.63, 0).applyQuaternion(torso).add(new Vector3(0, 1.2, 0))
    .add(new Vector3(0, -0.47, 0).applyQuaternion(upper)).add(new Vector3(0, -0.43, 0).applyQuaternion(forearm))
    .add(new Vector3(0, -0.12, 0.015).applyQuaternion(wrist))
}

function addBounds(points: Vector3[], center: Vector3, rootX: number, rootZ: number, facing: Quaternion, radius: number) {
  for (const x of [-radius, radius]) {
    for (const y of [-radius, radius]) {
      for (const z of [-radius, radius]) points.push(center.clone().add(new Vector3(x, y, z)).applyQuaternion(facing).add(new Vector3(rootX, 0, rootZ)))
    }
  }
}

function punchPoints(): Vector3[] {
  const points: Vector3[] = []
  for (const [rootZ, yaw] of [[-0.72, 0], [1.9, Math.PI]] as const) {
    const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    for (const side of ['left', 'right'] as const) {
      for (let time = 0; time <= 0.55; time += 0.025) {
        const sample = samplePunchClip(side, time, { durationScale: 1, intensity: 1.3 })
        for (const rootX of [-0.6, 0.6]) addBounds(points, handCenter(sample.pose, side), rootX, rootZ, facing, 0.16)
      }
    }
  }
  const defeat = createRestPose()
  const defeatedTorso = new Quaternion(...defeat.torso).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2))
  const defeatedHead = new Quaternion(...defeat.head).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2))
  const defeatPose: RigPose = { ...defeat, torso: [defeatedTorso.x, defeatedTorso.y, defeatedTorso.z, defeatedTorso.w], head: [defeatedHead.x, defeatedHead.y, defeatedHead.z, defeatedHead.w] }
  // Include terminal poses at engine movement clamps, full dodge and maximum lunge.
  for (const [rootZ, yaw] of [[-0.95, 0], [0.53, 0], [0.32, Math.PI], [1.8, Math.PI]] as const) {
    const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    for (const pose of [sampleDemoPose(8), defeatPose]) {
      const torso = new Quaternion(...pose.torso)
      const head = new Vector3(0, 0.1, 0).applyQuaternion(new Quaternion(...pose.head))
      head.y += 0.96
      head.applyQuaternion(torso).add(new Vector3(0, 1.2, 0))
      for (const rootX of [-0.52, 0.52]) {
        for (const side of ['left', 'right'] as const) addBounds(points, handCenter(pose, side), rootX, rootZ, facing, 0.16)
        addBounds(points, head, rootX, rootZ, facing, 0.25)
      }
    }
  }
  return points
}

describe('arena camera framing', () => {
  it.each([0.55, 0.68, 0.8, 1, 16 / 9, 21 / 9])('keeps both fighters and their full movement envelope inside aspect %s', (aspect) => {
    const view = camera(aspect)
    const points = punchPoints()
    for (const x of [-1.75, 1.75]) {
      for (const y of [-0.3, 3.2]) {
        for (const z of [-2.05, 3.25]) points.push(new Vector3(x, y, z))
      }
    }
    let maximumX = 0
    let maximumY = 0
    let minDepth = Infinity
    let maxDepth = -Infinity
    for (const point of points) {
      const projected = point.project(view)
      maximumX = Math.max(maximumX, Math.abs(projected.x))
      maximumY = Math.max(maximumY, Math.abs(projected.y))
      minDepth = Math.min(minDepth, projected.z)
      maxDepth = Math.max(maxDepth, projected.z)
    }
    expect(maximumX).toBeLessThanOrEqual(0.9 + 1e-9)
    expect(maximumY).toBeLessThanOrEqual(0.9 + 1e-9)
    expect(minDepth).toBeGreaterThan(-1)
    expect(maxDepth).toBeLessThan(1)
  })

  it('preserves the oblique view direction when a narrow canvas needs more room', () => {
    const target = new Vector3(...ARENA_CAMERA_TARGET)
    const desktop = new Vector3(...getArenaCameraPosition(16 / 9)).sub(target)
    const portrait = new Vector3(...getArenaCameraPosition(0.55)).sub(target)
    expect(desktop.clone().normalize().distanceTo(portrait.clone().normalize())).toBeLessThan(1e-12)
    expect(portrait.length()).toBeGreaterThan(desktop.length())
  })

  it('places the player on the left and the opponent on the right, matching their HUD', () => {
    const view = camera(16 / 9)
    const player = new Vector3(0, 1.5, -0.72).project(view)
    const opponent = new Vector3(0, 1.5, 1.9).project(view)
    expect(player.x).toBeLessThan(opponent.x)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back safely for invalid aspect %s', (aspect) => {
    expect(getArenaCameraPosition(aspect)).toEqual(getArenaCameraPosition(16 / 9))
  })
})
