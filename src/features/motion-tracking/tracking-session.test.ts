import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPoseBackend } from './pose-backend'
import { TrackingSession } from './tracking-session'
import type { SessionCallbacks, TrackingSessionDependencies } from './tracking-session'

class FakeVideo extends EventTarget {
  srcObject: MediaProvider | null = null
  readyState = 2
  videoWidth = 1280
  videoHeight = 720
  currentTime = 0
  paused = true
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
}

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live'
  label = 'Test webcam'
  stop = vi.fn(() => { this.readyState = 'ended' })
}

class FakeVisibility extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<TrackingSessionDependencies> = {}) {
  const video = new FakeVideo()
  const track = new FakeTrack()
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  const backend = {
    detect: vi.fn((_video: HTMLVideoElement, timestamp: number) => ({ timestamp, landmarks: [], worldLandmarks: [] })),
    close: vi.fn(),
  }
  const callbacks: SessionCallbacks = { onState: vi.fn(), onPose: vi.fn(), onMetrics: vi.fn() }
  const visibility = new FakeVisibility()
  const page = new EventTarget()
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  const dependencies: TrackingSessionDependencies = {
    openCamera: vi.fn(async () => stream),
    createBackend: vi.fn(async () => ({ backend, delegate: 'CPU' as const })),
    now: () => Date.now(),
    requestFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id },
    cancelFrame: (id) => { frames.delete(id) },
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (handle) => clearTimeout(handle),
    visibilityTarget: visibility,
    pageTarget: page,
    ...overrides,
  }
  const session = new TrackingSession(video as unknown as HTMLVideoElement, callbacks, dependencies)
  const renderFrame = () => {
    const scheduled = [...frames.values()]
    frames.clear()
    for (const callback of scheduled) callback(Date.now())
  }
  return { session, video, track, stream, backend, callbacks, dependencies, visibility, page, frames, renderFrame }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('TrackingSession lifecycle', () => {
  it('closes late camera streams after permission is canceled by the user', async () => {
    const permission = deferred<MediaStream>()
    const fixture = setup({ openCamera: () => permission.promise })
    const pending = fixture.session.start('720p')
    fixture.session.stop()
    permission.resolve(fixture.stream)
    await pending

    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.dependencies.createBackend).not.toHaveBeenCalled()
    expect(fixture.video.srcObject).toBeNull()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({ status: 'idle', delegate: null, error: null })
  })

  it('disposes a model that finishes loading after the camera has been stopped', async () => {
    const loading = deferred<LoadedPoseBackend>()
    const fixture = setup({ createBackend: () => loading.promise })
    const pending = fixture.session.start('720p')
    await Promise.resolve()
    fixture.session.stop()
    loading.resolve({ backend: fixture.backend, delegate: 'GPU' })
    await pending

    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(fixture.frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an older permission request overwrite a restarted session', async () => {
    const permission = deferred<MediaStream>()
    const lateTrack = new FakeTrack()
    const lateStream = { getTracks: () => [lateTrack] } as unknown as MediaStream
    const open = vi.fn<TrackingSessionDependencies['openCamera']>().mockImplementationOnce(() => permission.promise)
    const fixture = setup({ openCamera: open })
    open.mockResolvedValue(fixture.stream)
    const oldStart = fixture.session.start('720p')
    fixture.session.stop()
    await fixture.session.start('480p')
    permission.resolve(lateStream)
    await oldStart

    expect(lateTrack.stop).toHaveBeenCalledOnce()
    expect(fixture.video.srcObject).toBe(fixture.stream)
    expect(fixture.track.stop).not.toHaveBeenCalled()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({ status: 'running', delegate: 'CPU', error: null })
    fixture.session.stop()
  })

  it('cancels pending video playback and ignores its late resolution', async () => {
    const playback = deferred<void>()
    const fixture = setup()
    fixture.video.play.mockImplementation(() => playback.promise)
    const pending = fixture.session.start('720p')
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.video.play).toHaveBeenCalledOnce()
    fixture.session.stop()
    await pending
    playback.resolve()
    await Promise.resolve()

    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({ status: 'idle', delegate: null, error: null })
    expect(fixture.frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('surfaces denied permission without starting model download', async () => {
    const fixture = setup({ openCamera: async () => { throw new DOMException('Denied', 'NotAllowedError') } })
    await fixture.session.start('720p')

    expect(fixture.dependencies.createBackend).not.toHaveBeenCalled()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: expect.stringContaining('Acesso à câmera negado'),
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the webcam when model initialization fails', async () => {
    const fixture = setup({ createBackend: async () => { throw new Error('Modelo indisponível') } })
    await fixture.session.start('720p')

    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.video.srcObject).toBeNull()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: 'Modelo indisponível',
    })
  })

  it('releases tracks, inference timers, display callbacks and model exactly once', async () => {
    const fixture = setup()
    await fixture.session.start('720p')
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({ status: 'running', delegate: 'CPU', error: null })

    fixture.session.stop()
    fixture.session.stop()
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(fixture.video.srcObject).toBeNull()
    expect(fixture.frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recognizes camera disconnection and frees the loaded backend', async () => {
    const fixture = setup()
    await fixture.session.start('720p')
    fixture.track.dispatchEvent(new Event('ended'))

    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: expect.stringContaining('desconectada'),
    })
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(fixture.frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases resources when a running video element reports a playback error', async () => {
    const fixture = setup()
    await fixture.session.start('720p')
    fixture.video.dispatchEvent(new Event('error'))

    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: expect.stringContaining('parou de fornecer vídeo'),
    })
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['visibility', 'pagehide'])('stops background camera work on %s', async (event) => {
    const fixture = setup()
    await fixture.session.start('720p')
    if (event === 'visibility') {
      fixture.visibility.visibilityState = 'hidden'
      fixture.visibility.dispatchEvent(new Event('visibilitychange'))
    } else fixture.page.dispatchEvent(new Event('pagehide'))

    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds video startup and cleans up a camera that produces no images', async () => {
    const fixture = setup()
    fixture.video.readyState = 0
    const pending = fixture.session.start('720p')
    await vi.advanceTimersByTimeAsync(12_001)
    await pending

    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: expect.stringContaining('demorou'),
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('TrackingSession scheduling', () => {
  it('never re-infers a decoded frame and clears stale overlays', async () => {
    const fixture = setup()
    await fixture.session.start('720p')
    await vi.advanceTimersByTimeAsync(500)
    fixture.renderFrame()

    expect(fixture.backend.detect).toHaveBeenCalledOnce()
    expect(fixture.callbacks.onPose).toHaveBeenLastCalledWith(null)
    fixture.video.currentTime = 0.5
    await vi.advanceTimersByTimeAsync(50)
    expect(fixture.backend.detect).toHaveBeenCalledTimes(2)
    fixture.session.stop()
  })

  it('caps inference at 24 Hz independently from a 60 Hz display and batches actual metrics', async () => {
    const fixture = setup()
    await fixture.session.start('720p')
    for (let frame = 1; frame <= 60; frame += 1) {
      fixture.video.currentTime = frame / 60
      await vi.advanceTimersByTimeAsync(1000 / 60)
      fixture.renderFrame()
    }

    expect(fixture.backend.detect.mock.calls.length).toBeLessThanOrEqual(24)
    expect(fixture.backend.detect.mock.calls.length).toBeGreaterThanOrEqual(20)
    // One initial reset plus at most four diagnostic samples per second.
    expect(vi.mocked(fixture.callbacks.onMetrics).mock.calls.length).toBeLessThanOrEqual(5)
    expect(fixture.callbacks.onMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      renderFps: expect.closeTo(60, 0), resolution: '1280 × 720', cameraLabel: 'Test webcam',
    }))
    fixture.session.stop()
  })

  it('cleans up and gives actionable feedback after an inference failure', async () => {
    const fixture = setup()
    fixture.backend.detect.mockImplementation(() => { throw new Error('lost context') })
    await fixture.session.start('720p')
    await vi.advanceTimersByTimeAsync(1)

    expect(fixture.callbacks.onState).toHaveBeenLastCalledWith({
      status: 'error', delegate: null, error: expect.stringContaining('rastreamento foi interrompido'),
    })
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
