import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { sampleDemoPose } from '../../engine/motion/retarget'
import { getPunchDuration, samplePunchClip } from '../../engine/animation/combat-clips'
import type { RigPose } from '../../types/robot'
import { getRobotCameraPosition, ROBOT_CAMERA_FOV, ROBOT_CAMERA_TARGET } from './camera-fit'

const ASPECTS = [0.55, 0.68, 0.8, 1, 16 / 9]
const VIEWS = ['front', 'perspective'] as const

function cameraFor(view: typeof VIEWS[number], aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(ROBOT_CAMERA_FOV, aspect, 0.1, 40)
  camera.position.fromArray(getRobotCameraPosition(view, aspect))
  camera.lookAt(new Vector3(...ROBOT_CAMERA_TARGET))
  camera.updateMatrixWorld()
  return camera
}

function envelopeCorners(): Vector3[] {
  const corners: Vector3[] = []
  for (const x of [-1.8, 1.8]) {
    for (const y of [-0.25, 3.15]) {
      for (const z of [-1.53, 1.53]) corners.push(new Vector3(x, y, z))
    }
  }
  return corners
}

/** Actual model hierarchy and bone lengths, sampled without a renderer or camera stream. */
function demonstrationPoints(): Vector3[] {
  const points: Vector3[] = []
  const appendPose = (pose: RigPose) => {
    const torso = new Quaternion().fromArray(pose.torso)
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const upper = torso.clone().multiply(new Quaternion().fromArray(pose[`${side}Shoulder`]))
      const forearm = upper.clone().multiply(new Quaternion().fromArray(pose[`${side}Elbow`]))
      const shoulder = new Vector3(sign * 0.53, 0.63, 0).applyQuaternion(torso).add(new Vector3(0, 1.2, 0))
      const elbow = shoulder.clone().add(new Vector3(0, -0.47, 0).applyQuaternion(upper))
      const wrist = elbow.clone().add(new Vector3(0, -0.43, 0).applyQuaternion(forearm))
      const hand = wrist.clone().add(new Vector3(0, -0.12, 0.02).applyQuaternion(forearm))
      points.push(shoulder, elbow, wrist)
      // A conservative cube also contains the required 0.16-radius fist envelope.
      for (const x of [-0.16, 0.16]) {
        for (const y of [-0.16, 0.16]) {
          for (const z of [-0.16, 0.16]) points.push(hand.clone().add(new Vector3(x, y, z)))
        }
      }
    }
  }
  for (let time = 0; time <= 16; time += 0.125) appendPose(sampleDemoPose(time))
  for (const side of ['left', 'right'] as const) {
    for (const intensity of [0.6, 1.3]) {
      for (const durationScale of [0.75, 1.35]) {
        const options = { intensity, durationScale }
        const duration = getPunchDuration(options)
        for (let step = 0; step <= 32; step++) appendPose(samplePunchClip(side, duration * step / 32, options).pose)
      }
    }
  }
  points.push(new Vector3(0, 2.47, 0))
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
    points.push(new Vector3(Math.cos(angle) * 1.53, -0.25, Math.sin(angle) * 1.53))
  }
  return points
}

function projectedExtents(points: readonly Vector3[], camera: PerspectiveCamera) {
  let maxX = 0
  let maxY = 0
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    const projected = point.clone().project(camera)
    maxX = Math.max(maxX, Math.abs(projected.x))
    maxY = Math.max(maxY, Math.abs(projected.y))
    minZ = Math.min(minZ, projected.z)
    maxZ = Math.max(maxZ, projected.z)
  }
  return { maxX, maxY, minZ, maxZ }
}

describe.each(VIEWS)('camera fitting: %s view', (view) => {
  it.each(ASPECTS)('fits all movement/platform box corners with margin at aspect %s', (aspect) => {
    const extents = projectedExtents(envelopeCorners(), cameraFor(view, aspect))
    expect(extents.maxX).toBeLessThanOrEqual(0.9 + 1e-10)
    expect(extents.maxY).toBeLessThanOrEqual(0.9 + 1e-10)
    expect(extents.minZ).toBeGreaterThan(-1)
    expect(extents.maxZ).toBeLessThan(1)
  })

  it.each(ASPECTS)('keeps rig demonstration, punch clips and fist bounds visible at aspect %s', (aspect) => {
    const extents = projectedExtents(demonstrationPoints(), cameraFor(view, aspect))
    expect(extents.maxX).toBeLessThanOrEqual(0.9)
    expect(extents.maxY).toBeLessThanOrEqual(0.9)
    expect(extents.minZ).toBeGreaterThan(-1)
    expect(extents.maxZ).toBeLessThan(1)
  })

  it('preserves the chosen view direction while narrowing the viewport', () => {
    const target = new Vector3(...ROBOT_CAMERA_TARGET)
    const wide = new Vector3(...getRobotCameraPosition(view, 16 / 9)).sub(target)
    const narrow = new Vector3(...getRobotCameraPosition(view, 0.55)).sub(target)
    const expected = view === 'front' ? new Vector3(0, 0.3, 6.1) : new Vector3(3.6, 0.85, 5.7)
    expect(wide.clone().normalize().distanceTo(expected.normalize())).toBeLessThan(1e-12)
    expect(narrow.clone().normalize().distanceTo(wide.clone().normalize())).toBeLessThan(1e-12)
    expect(narrow.length()).toBeGreaterThan(wide.length())
    expect(wide.length()).toBeGreaterThanOrEqual(view === 'front' ? 6.1 : Math.hypot(3.6, 0.85, 5.7))
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('uses the desktop fallback for invalid aspect %s', (aspect) => {
    expect(getRobotCameraPosition(view, aspect)).toEqual(getRobotCameraPosition(view, 16 / 9))
  })
})
