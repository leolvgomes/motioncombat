/** Keeps 60 and 75 Hz displays at full rate and halves 120 and 144 Hz ones. */
export const MIN_FRAME_MS = 13
/** Minimum time between scene frames while tracking, from most fluid to most economical. */
export const TRACKING_FRAME_STEPS_MS = [15, 22, 30, 40] as const

const TIMER_TOLERANCE_MS = 0.5
const SLOW_LATENCY_MS = 58
const FAST_LATENCY_MS = 38
const WINDOW = 8
/** Samples arrive about four times a second. */
const SETTLE_SAMPLES = 8
const RECOVERY_SAMPLES = 20
const RETRY_SAMPLES = 160

export function shouldRender(now: number, last: number, minimum: number): boolean {
  return now - last >= minimum - TIMER_TOLERANCE_MS
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1] ?? 0
}

/**
 * Inference and the 3D scene share one GPU. When poses arrive late, the scene gives up frames; when there is
 * room, it takes them back. A step that proved too expensive is not retried for a while, so it cannot oscillate.
 */
export class FramePacer {
  private step = 0
  private latencies: number[] = []
  private sinceChange = 0
  private blockedFor = 0

  get minimumMs(): number { return TRACKING_FRAME_STEPS_MS[this.step]! }

  reset(): void {
    this.step = 0
    this.latencies = []
    this.sinceChange = 0
    this.blockedFor = 0
  }

  observe(latencyMs: number): void {
    this.blockedFor = Math.max(0, this.blockedFor - 1)
    if (!Number.isFinite(latencyMs) || latencyMs <= 0) return
    this.latencies = [...this.latencies, latencyMs].slice(-WINDOW)
    this.sinceChange += 1
    if (this.latencies.length < WINDOW || this.sinceChange < SETTLE_SAMPLES) return
    const typical = median(this.latencies)
    if (typical > SLOW_LATENCY_MS && this.step < TRACKING_FRAME_STEPS_MS.length - 1) {
      this.change(1)
      this.blockedFor = RETRY_SAMPLES
    } else if (typical < FAST_LATENCY_MS && this.step > 0 && this.sinceChange >= RECOVERY_SAMPLES && this.blockedFor === 0) this.change(-1)
  }

  private change(amount: 1 | -1): void {
    this.step += amount
    this.latencies = []
    this.sinceChange = 0
  }
}

/** Shared by the visible canvas and fed by the tracking session. */
export const framePacer = new FramePacer()
