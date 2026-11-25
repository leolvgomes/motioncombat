import type { PoseFrame } from '../../types/motion'
import { loadLandmarker } from './pose-landmarker'
import type { InferenceDelegate } from './pose-landmarker'
import { createWorkerBackend, workerTrackingSupported } from './worker-backend'

export type { InferenceDelegate } from './pose-landmarker'

export interface DetectedFrame extends PoseFrame {
  /** Time spent by the model itself, when measured apart from copying and messaging. */
  readonly inferenceMs?: number
}

export interface PoseBackend {
  /** True when inference does not block the page. */
  readonly threaded?: boolean
  detect(video: HTMLVideoElement, timestamp: number): DetectedFrame | Promise<DetectedFrame>
  close(): void
}

export interface LoadedPoseBackend {
  backend: PoseBackend
  delegate: InferenceDelegate
}

function mediapipeBase(): string {
  return new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI).href
}

async function createPageBackend(base: string): Promise<LoadedPoseBackend> {
  const { delegate, detect, close } = await loadLandmarker(base, false)
  return { delegate, backend: { threaded: false, detect, close } }
}

/**
 * Loaded on demand so the idle laboratory does not initialize WebAssembly/WebGL. Any failure
 * to start the worker falls back to the page, which works everywhere the previous versions did.
 */
export async function createPoseBackend(preferWorker = true): Promise<LoadedPoseBackend> {
  const base = mediapipeBase()
  if (preferWorker && workerTrackingSupported()) {
    try { return await createWorkerBackend(base) } catch (error) {
      console.warn('Rastreamento em segundo plano indisponível; usando a página.', error)
    }
  }
  return createPageBackend(base)
}
