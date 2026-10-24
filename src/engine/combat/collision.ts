import { Quaternion, Vector3 } from 'three'
import type { AttackSide } from '../../types/animation'
import type { FighterFrame } from '../../types/combat'

const Y_AXIS = new Vector3(0, 1, 0)
const ARM_NAMES = {
  left: ['leftShoulder', 'leftElbow', 'leftWrist'],
  right: ['rightShoulder', 'rightElbow', 'rightWrist'],
} as const

function finite(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }

/** Squared closest distance between finite segments, including points and parallels. */
export function segmentDistanceSquared(p: Vector3, q: Vector3, a: Vector3, b: Vector3): number {
  if (!finite(p) || !finite(q) || !finite(a) || !finite(b)) return Infinity
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z
  const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z
  const rx = p.x - a.x, ry = p.y - a.y, rz = p.z - a.z
  const dd = dx * dx + dy * dy + dz * dz
  const ee = ex * ex + ey * ey + ez * ez
  const er = ex * rx + ey * ry + ez * rz
  let s = 0
  let t = 0
  if (dd <= 1e-12 && ee <= 1e-12) return rx * rx + ry * ry + rz * rz
  if (dd <= 1e-12) t = clamp01(er / ee)
  else {
    const dr = dx * rx + dy * ry + dz * rz
    if (ee <= 1e-12) s = clamp01(-dr / dd)
    else {
      const de = dx * ex + dy * ey + dz * ez
      const denominator = dd * ee - de * de
      if (denominator > 1e-12) s = clamp01((de * er - dr * ee) / denominator)
      t = (de * s + er) / ee
      if (t < 0) { t = 0; s = clamp01(-dr / dd) }
      else if (t > 1) { t = 1; s = clamp01((de - dr) / dd) }
    }
  }
  const x = rx + s * dx - t * ex
  const y = ry + s * dy - t * ey
  const z = rz + s * dz - t * ez
  return x * x + y * y + z * z
}

/** Shared FK and collision geometry; display and damage consume the same transforms. */
export class CombatHitGeometry {
  private readonly yaw = new Quaternion()
  private readonly bottom = new Vector3()
  private readonly top = new Vector3()
  private readonly head = new Vector3()

  fist(frame: FighterFrame, side: AttackSide, out: Vector3): Vector3 {
    const names = ARM_NAMES[side]
    out.set(0, -0.12, 0.015).applyQuaternion(frame.rotations[names[2]])
    out.y -= 0.43
    out.applyQuaternion(frame.rotations[names[1]])
    out.y -= 0.47
    out.applyQuaternion(frame.rotations[names[0]])
    out.x += side === 'left' ? 0.53 : -0.53
    out.y += 0.63
    out.applyQuaternion(frame.rotations.torso)
    out.y += 1.2
    this.yaw.setFromAxisAngle(Y_AXIS, frame.yaw)
    out.applyQuaternion(this.yaw)
    out.x += frame.position[0]
    out.y += frame.position[1]
    out.z += frame.position[2]
    return out
  }

  intersects(from: Vector3, to: Vector3, target: FighterFrame, undodgedX?: number): boolean {
    if (!finite(from) || !finite(to) || !Number.isFinite(target.yaw)
      || !target.position.every(Number.isFinite)) return false
    this.yaw.setFromAxisAngle(Y_AXIS, target.yaw)
    this.bottom.set(0, 0.2, 0)
    this.top.set(0, 0.75, 0)
    this.head.set(0, 0.09, 0).applyQuaternion(target.rotations.head)
    this.head.y += 0.96
    const rootX = undodgedX !== undefined && Number.isFinite(undodgedX) ? undodgedX : target.position[0]
    this.toWorld(this.bottom, target, rootX)
    this.toWorld(this.top, target, rootX)
    this.toWorld(this.head, target, rootX)
    return segmentDistanceSquared(from, to, this.bottom, this.top) <= (0.34 + 0.14) ** 2
      || segmentDistanceSquared(from, to, this.head, this.head) <= (0.25 + 0.14) ** 2
  }

  private toWorld(point: Vector3, frame: FighterFrame, x: number): void {
    point.applyQuaternion(frame.rotations.torso)
    point.y += 1.2
    point.applyQuaternion(this.yaw)
    point.x += x
    point.y += frame.position[1]
    point.z += frame.position[2]
  }
}
