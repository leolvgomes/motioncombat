export const ARENA_CAMERA_TARGET = [0, 1.15, 0.6] as const
export const ARENA_CAMERA_FOV = 38

/** Fixed oblique direction; only the viewing distance changes with canvas aspect. */
export function getArenaCameraPosition(aspect: number): readonly [number, number, number] {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, Number.EPSILON) : 16 / 9
  const direction = [-7.4, 3.7, 5.1] as const
  const length = Math.hypot(...direction)
  const back = direction.map((value) => value / length)
  const horizontal = Math.hypot(back[0], back[2])
  const right = [back[2] / horizontal, 0, -back[0] / horizontal] as const
  const up = [back[1] * right[2], back[2] * right[0] - back[0] * right[2], -back[1] * right[0]] as const
  const tangent = Math.tan(ARENA_CAMERA_FOV * Math.PI / 360)
  let distance = length

  // Both fighter roots and their full articulated punch/victory envelope.
  for (const x of [-1.75, 1.75]) {
    for (const y of [-0.3, 3.2]) {
      for (const z of [-2.05, 3.25]) {
        const relativeY = y - ARENA_CAMERA_TARGET[1]
        const relativeZ = z - ARENA_CAMERA_TARGET[2]
        const viewX = x * right[0] + relativeY * right[1] + relativeZ * right[2]
        const viewY = x * up[0] + relativeY * up[1] + relativeZ * up[2]
        const depth = x * back[0] + relativeY * back[1] + relativeZ * back[2]
        distance = Math.max(distance, depth + Math.max(
          Math.abs(viewX) / (tangent * safeAspect * 0.9),
          Math.abs(viewY) / (tangent * 0.9),
          0.1,
        ))
      }
    }
  }
  return [back[0] * distance, ARENA_CAMERA_TARGET[1] + back[1] * distance, ARENA_CAMERA_TARGET[2] + back[2] * distance]
}
