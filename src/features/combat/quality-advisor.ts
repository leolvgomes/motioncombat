import type { RobotQuality } from '../../stores/robot-store'

/**
 * Suggests the light preset after a sustained low arena frame rate. It only recommends; the quality setting is
 * never changed without the player's action. Samples arrive about every 500 ms from the arena FPS meter.
 */
export class QualityAdvisor {
  private readonly samples: number[] = []

  constructor(private readonly threshold = 42, private readonly window = 6) {}

  observe(fps: number | null, quality: RobotQuality): boolean {
    if (quality !== 'balanced' || fps === null || !Number.isFinite(fps) || fps <= 0) {
      this.samples.length = 0
      return false
    }
    this.samples.push(fps)
    if (this.samples.length > this.window) this.samples.shift()
    if (this.samples.length < this.window) return false
    const sorted = [...this.samples].sort((a, b) => a - b)
    const middle = sorted.length / 2
    const median = sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2
    return median < this.threshold
  }

  reset(): void { this.samples.length = 0 }
}
