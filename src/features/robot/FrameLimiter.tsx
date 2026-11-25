import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useLabStore } from '../../stores/lab-store'
import { MIN_FRAME_MS, framePacer, shouldRender } from './frame-pacing'
import { describeGpu } from './gpu-info'

/**
 * Drives a `frameloop="demand"` canvas. Inference shares the GPU with the scene, so frames a fast display
 * would only discard are time taken from the player's own movement.
 */
export function FrameLimiter() {
  const invalidate = useThree((state) => state.invalidate)
  const gl = useThree((state) => state.gl)
  useEffect(() => { useLabStore.getState().setGpu(describeGpu(gl.getContext())) }, [gl])
  useEffect(() => {
    let handle = 0
    let last = -Infinity
    const tick = (now: number) => {
      const tracking = useLabStore.getState().session.status === 'running'
      if (shouldRender(now, last, tracking ? framePacer.minimumMs : MIN_FRAME_MS)) {
        last = now
        invalidate()
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [invalidate])
  return null
}
