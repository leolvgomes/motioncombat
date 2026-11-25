export interface PerformanceSample {
  readonly sceneFps: number | null
  readonly trackingHz: number
  readonly inferenceMs: number
  readonly latencyMs: number
  readonly worstFrameMs: number
}

export interface Distribution {
  readonly median: number
  /** The value 5% of the samples fall below, and the one 5% exceed. */
  readonly low: number
  readonly high: number
}

export interface PerformanceReport {
  readonly samples: number
  readonly threaded: boolean
  readonly sceneFps: Distribution | null
  readonly trackingHz: Distribution
  readonly inferenceMs: Distribution
  readonly latencyMs: Distribution
  readonly worstFrameMs: Distribution
}

function distribution(values: readonly number[]): Distribution | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const at = (share: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)))]! * 10) / 10
  return { median: at(0.5), low: at(0.05), high: at(0.95) }
}

const MIN_SAMPLES = 8

/** Collects the published diagnostics; it adds no measuring work of its own. */
export class PerformanceSampler {
  private samples: PerformanceSample[] = []
  private threaded = false

  get count(): number { return this.samples.length }

  add(sample: PerformanceSample, threaded: boolean): void {
    // A diagnostic window with no inference has no duration to report.
    if (!Number.isFinite(sample.trackingHz) || sample.trackingHz <= 0) return
    this.threaded = threaded
    this.samples.push(sample)
  }

  report(): PerformanceReport | null {
    if (this.samples.length < MIN_SAMPLES) return null
    const pick = (key: keyof PerformanceSample) => distribution(this.samples.flatMap((sample) => sample[key] === null ? [] : [sample[key]]))
    const trackingHz = pick('trackingHz')
    const inferenceMs = pick('inferenceMs')
    const latencyMs = pick('latencyMs')
    const worstFrameMs = pick('worstFrameMs')
    if (!trackingHz || !inferenceMs || !latencyMs || !worstFrameMs) return null
    return { samples: this.samples.length, threaded: this.threaded, sceneFps: pick('sceneFps'), trackingHz, inferenceMs, latencyMs, worstFrameMs }
  }
}
