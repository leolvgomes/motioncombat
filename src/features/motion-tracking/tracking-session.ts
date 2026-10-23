import { PoseProcessor } from '../../engine/motion/pose-processor'
import type { ProcessedPose } from '../../types/motion'
import { cameraErrorMessage, openCamera, stopStream } from '../camera/camera'
import type { CameraResolution } from '../camera/camera'
import { createPoseBackend } from './pose-backend'
import type { InferenceDelegate, LoadedPoseBackend, PoseBackend } from './pose-backend'

export interface SessionState {
  status: 'idle' | 'requesting' | 'loading' | 'starting' | 'running' | 'error'
  error: string | null
  delegate: InferenceDelegate | null
}

export interface SessionMetrics {
  renderFps: number
  inferenceFps: number
  inferenceMs: number
  resolution: string
  cameraLabel: string
  elapsedSeconds: number
}

export interface SessionCallbacks {
  onState(state: SessionState): void
  /** Mutable rendering refs consume this callback; do not store every pose in React. */
  onPose(pose: ProcessedPose | null): void
  onMetrics(metrics: SessionMetrics): void
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>
type VisibilityTarget = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
type PageTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

/** Injection keeps cancellation and scheduler behavior testable without a physical webcam. */
export interface TrackingSessionDependencies {
  openCamera(resolution: CameraResolution): Promise<MediaStream>
  createBackend(): Promise<LoadedPoseBackend>
  now(): number
  requestFrame(callback: FrameRequestCallback): number
  cancelFrame(handle: number): void
  setTimer(callback: () => void, delay: number): TimerHandle
  clearTimer(handle: TimerHandle): void
  visibilityTarget: VisibilityTarget | null
  pageTarget: PageTarget | null
}

interface SessionRun {
  abort: AbortController
  stream: MediaStream | null
  backend: PoseBackend | null
  delegate: InferenceDelegate | null
  frame: number | null
  timer: TimerHandle | null
  onEnded: () => void
  onVideoError: () => void
  onVisibility: () => void
  onPageHide: () => void
}

const INFERENCE_INTERVAL_MS = 1000 / 24
const METRICS_INTERVAL_MS = 250
const VIDEO_TIMEOUT_MS = 12_000

export const EMPTY_SESSION_METRICS: SessionMetrics = {
  renderFps: 0, inferenceFps: 0, inferenceMs: 0, resolution: '—', cameraLabel: '—', elapsedSeconds: 0,
}

/** Owns all browser resources. Inference and display have separate, bounded schedules. */
export class TrackingSession {
  private readonly dependencies: TrackingSessionDependencies
  private readonly processor = new PoseProcessor()
  private run: SessionRun | null = null

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly callbacks: SessionCallbacks,
    dependencies: Partial<TrackingSessionDependencies> = {},
  ) {
    this.dependencies = {
      openCamera,
      createBackend: createPoseBackend,
      now: () => performance.now(),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimer: (handle) => globalThis.clearTimeout(handle),
      visibilityTarget: typeof document === 'undefined' ? null : document,
      pageTarget: typeof window === 'undefined' ? null : window,
      ...dependencies,
    }
  }

  async start(resolution: CameraResolution): Promise<void> {
    if (this.run) return
    const run: SessionRun = {
      abort: new AbortController(), stream: null, backend: null, delegate: null, frame: null, timer: null,
      onEnded: () => this.fail(run, 'A webcam foi desconectada ou interrompida. Reconecte a câmera e inicie novamente.'),
      onVideoError: () => this.fail(run, 'A webcam parou de fornecer vídeo. Verifique a conexão e inicie novamente.'),
      onVisibility: () => {
        if (this.dependencies.visibilityTarget?.visibilityState === 'hidden') this.stop()
      },
      onPageHide: () => this.stop(),
    }
    this.run = run
    this.processor.reset()
    this.callbacks.onPose(null)
    this.callbacks.onMetrics({ ...EMPTY_SESSION_METRICS })
    this.setState('requesting')
    this.dependencies.visibilityTarget?.addEventListener('visibilitychange', run.onVisibility)
    this.dependencies.pageTarget?.addEventListener('pagehide', run.onPageHide)

    try {
      const stream = await this.dependencies.openCamera(resolution)
      if (!this.isCurrent(run)) {
        stopStream(stream)
        return
      }
      run.stream = stream
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', run.onEnded)
        if (track.readyState === 'ended') throw new Error('A webcam foi desconectada antes de iniciar.')
      }
      this.video.srcObject = stream
      this.video.addEventListener('error', run.onVideoError)
      this.setState('loading')
      const loaded = await this.dependencies.createBackend()
      if (!this.isCurrent(run)) {
        loaded.backend.close()
        return
      }
      run.backend = loaded.backend
      run.delegate = loaded.delegate
      this.setState('starting', loaded.delegate)
      await this.waitForVideo(run.abort.signal)
      if (!this.isCurrent(run)) return
      this.setState('running', loaded.delegate)
      if (this.isCurrent(run)) this.schedule(run)
    } catch (error) {
      if (this.isCurrent(run)) this.fail(run, cameraErrorMessage(error))
    }
  }

  stop(): void {
    if (this.run) this.release(this.run)
    this.callbacks.onPose(null)
    this.callbacks.onMetrics({ ...EMPTY_SESSION_METRICS })
    this.setState('idle')
  }

  private isCurrent(run: SessionRun): boolean {
    return this.run === run && !run.abort.signal.aborted
  }

  private setState(status: SessionState['status'], delegate: InferenceDelegate | null = null): void {
    this.callbacks.onState({ status, delegate, error: null })
  }

  private fail(run: SessionRun, error: string): void {
    if (!this.isCurrent(run)) return
    this.release(run)
    this.callbacks.onPose(null)
    this.callbacks.onMetrics({ ...EMPTY_SESSION_METRICS })
    this.callbacks.onState({ status: 'error', delegate: null, error })
  }

  private release(run: SessionRun): void {
    this.run = null
    run.abort.abort()
    if (run.frame !== null) this.dependencies.cancelFrame(run.frame)
    if (run.timer !== null) this.dependencies.clearTimer(run.timer)
    this.dependencies.visibilityTarget?.removeEventListener('visibilitychange', run.onVisibility)
    this.dependencies.pageTarget?.removeEventListener('pagehide', run.onPageHide)
    this.video.removeEventListener('error', run.onVideoError)
    if (run.stream) {
      for (const track of run.stream.getVideoTracks()) track.removeEventListener('ended', run.onEnded)
      stopStream(run.stream)
    }
    // MediaPipe disposal failure must not prevent webcam and video cleanup.
    try { run.backend?.close() } catch { /* Native resources may already have been released. */ }
    this.video.pause()
    this.video.srcObject = null
    this.processor.reset()
  }

  private waitForVideo(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let playResolved = false
      const clean = () => {
        this.dependencies.clearTimer(timeout)
        signal.removeEventListener('abort', onAbort)
        this.video.removeEventListener('loadeddata', check)
        this.video.removeEventListener('resize', check)
        this.video.removeEventListener('error', onError)
      }
      const onAbort = () => { clean(); reject(new DOMException('Sessão interrompida.', 'AbortError')) }
      const onError = () => { clean(); reject(new Error('A webcam foi aberta, mas o vídeo não pôde ser reproduzido. Tente iniciar novamente.')) }
      const check = () => {
        if (playResolved && this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
          clean()
          resolve()
        }
      }
      const timeout = this.dependencies.setTimer(() => {
        clean()
        reject(new Error('A câmera demorou para fornecer imagens. Verifique a conexão e tente novamente.'))
      }, VIDEO_TIMEOUT_MS)
      signal.addEventListener('abort', onAbort, { once: true })
      this.video.addEventListener('loadeddata', check)
      this.video.addEventListener('resize', check)
      this.video.addEventListener('error', onError, { once: true })
      if (signal.aborted) { onAbort(); return }
      void this.video.play().then(() => { playResolved = true; check() }, (error: unknown) => { clean(); reject(error) })
    })
  }

  private schedule(run: SessionRun): void {
    const started = this.dependencies.now()
    let measuredSince = started
    let renderFrames = 0
    let inferenceFrames = 0
    let inferenceDuration = 0
    let lastVideoTime = -1
    let lastPoseAt = started
    let hasPose = false

    const render = () => {
      if (!this.isCurrent(run)) return
      renderFrames += 1
      const now = this.dependencies.now()
      if (hasPose && now - lastPoseAt > 400) {
        hasPose = false
        this.processor.reset()
        this.callbacks.onPose(null)
      }
      const elapsed = now - measuredSince
      if (elapsed >= METRICS_INTERVAL_MS) {
        this.callbacks.onMetrics({
          renderFps: renderFrames * 1000 / elapsed,
          inferenceFps: inferenceFrames * 1000 / elapsed,
          inferenceMs: inferenceFrames > 0 ? inferenceDuration / inferenceFrames : 0,
          resolution: `${this.video.videoWidth} × ${this.video.videoHeight}`,
          cameraLabel: run.stream?.getVideoTracks()[0]?.label || 'Webcam',
          elapsedSeconds: Math.floor((now - started) / 1000),
        })
        measuredSince = now
        renderFrames = 0
        inferenceFrames = 0
        inferenceDuration = 0
      }
      if (this.isCurrent(run)) run.frame = this.dependencies.requestFrame(render)
    }

    const infer = () => {
      if (!this.isCurrent(run)) return
      const before = this.dependencies.now()
      try {
        // currentTime prevents repeating synchronous inference on the same decoded video frame.
        if (this.video.readyState >= 2 && !this.video.paused && this.video.currentTime !== lastVideoTime && run.backend) {
          lastVideoTime = this.video.currentTime
          const pose = this.processor.process(run.backend.detect(this.video, before))
          inferenceDuration += this.dependencies.now() - before
          inferenceFrames += 1
          lastPoseAt = this.dependencies.now()
          hasPose = true
          this.callbacks.onPose(pose)
        }
      } catch {
        this.fail(run, 'O rastreamento foi interrompido. Reinicie a câmera; se persistir, recarregue a página ou use outro navegador.')
        return
      }
      if (this.isCurrent(run)) {
        run.timer = this.dependencies.setTimer(infer, Math.max(0, Math.ceil(INFERENCE_INTERVAL_MS - (this.dependencies.now() - before))))
      }
    }

    run.frame = this.dependencies.requestFrame(render)
    run.timer = this.dependencies.setTimer(infer, 0)
  }
}
