import type { PoseFrame } from '../../types/motion'
import type { DetectedFrame, LoadedPoseBackend } from './pose-backend'
import type { InferenceDelegate } from './pose-landmarker'

export type PoseWorkerRequest =
  | { readonly type: 'init'; readonly base: string }
  | { readonly type: 'frame'; readonly id: number; readonly bitmap: ImageBitmap; readonly timestamp: number }

export type PoseWorkerReply =
  | { readonly type: 'ready'; readonly delegate: InferenceDelegate }
  | { readonly type: 'result'; readonly id: number; readonly frame: PoseFrame; readonly inferenceMs: number }
  /** A null id means the engine itself could not start. */
  | { readonly type: 'failed'; readonly id: number | null; readonly message: string }

export interface PoseWorkerPort {
  onmessage: ((event: MessageEvent<PoseWorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: PoseWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface WorkerBackendDependencies {
  createWorker(): PoseWorkerPort
  grab(video: HTMLVideoElement): Promise<ImageBitmap>
  startTimeoutMs: number
  detectTimeoutMs: number
}

/** The model works on about 256 px, so a smaller frame costs no accuracy and is cheaper to copy. */
export const MAX_FRAME_WIDTH = 640

export function frameSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_FRAME_WIDTH / width)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function grabFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
  const { width, height } = frameSize(video.videoWidth, video.videoHeight)
  return createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' })
}

const DEFAULTS: WorkerBackendDependencies = {
  createWorker: () => new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'steel-sync-pose' }) as unknown as PoseWorkerPort,
  grab: grabFrame,
  // Compiling the model's shaders can take several seconds on an integrated GPU.
  startTimeoutMs: 40_000,
  detectTimeoutMs: 8_000,
}

export function workerTrackingSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined'
}

interface Pending {
  readonly id: number
  readonly timer: ReturnType<typeof setTimeout>
  resolve(frame: DetectedFrame): void
  reject(error: Error): void
}

/** Inference off the page's thread. At most one frame is in flight, so nothing ever queues up. */
export function createWorkerBackend(base: string, overrides: Partial<WorkerBackendDependencies> = {}): Promise<LoadedPoseBackend> {
  const { createWorker, grab, startTimeoutMs, detectTimeoutMs } = { ...DEFAULTS, ...overrides }
  return new Promise((resolveBackend, rejectBackend) => {
    const worker = createWorker()
    let pending: Pending | null = null
    let closed = false
    let started = false
    let sequence = 0

    const settle = (): Pending | null => {
      const current = pending
      pending = null
      if (current) clearTimeout(current.timer)
      return current
    }
    const shutdown = (error: Error) => {
      if (closed) return
      closed = true
      clearTimeout(startTimer)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      settle()?.reject(error)
      if (!started) rejectBackend(error)
    }
    const startTimer = setTimeout(() => shutdown(new Error('O rastreamento em segundo plano demorou para iniciar.')), startTimeoutMs)

    worker.onerror = (event) => shutdown(new Error(event.message || 'O rastreamento em segundo plano foi interrompido.'))
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        if (started || closed) return
        started = true
        clearTimeout(startTimer)
        resolveBackend({ delegate: data.delegate, backend: { threaded: true, detect, close: () => shutdown(new Error('Sessão encerrada.')) } })
      } else if (data.type === 'failed' && data.id === null) shutdown(new Error(data.message))
      // A reply to a frame that already timed out has no listener and is ignored.
      else if (pending && pending.id === data.id) {
        const current = settle()
        if (data.type === 'result') current?.resolve({ ...data.frame, inferenceMs: data.inferenceMs })
        else if (data.type === 'failed') current?.reject(new Error(data.message))
      }
    }

    const detect = async (video: HTMLVideoElement, timestamp: number): Promise<DetectedFrame> => {
      if (closed) throw new Error('Sessão encerrada.')
      if (pending) throw new Error('Já existe um quadro em análise.')
      const bitmap = await grab(video)
      if (closed) {
        bitmap.close()
        throw new Error('Sessão encerrada.')
      }
      return new Promise<DetectedFrame>((resolve, reject) => {
        const id = ++sequence
        pending = { id, resolve, reject, timer: setTimeout(() => shutdown(new Error('O rastreamento em segundo plano parou de responder.')), detectTimeoutMs) }
        worker.postMessage({ type: 'frame', id, bitmap, timestamp }, [bitmap])
      })
    }

    worker.postMessage({ type: 'init', base })
  })
}
