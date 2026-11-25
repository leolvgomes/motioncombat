import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkerBackend, frameSize } from './worker-backend'
import type { PoseWorkerPort, PoseWorkerReply, PoseWorkerRequest } from './worker-backend'

class FakeWorker implements PoseWorkerPort {
  onmessage: ((event: MessageEvent<PoseWorkerReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly sent: PoseWorkerRequest[] = []
  readonly transfers: (Transferable[] | undefined)[] = []
  terminate = vi.fn()
  postMessage(message: PoseWorkerRequest, transfer?: Transferable[]) { this.sent.push(message); this.transfers.push(transfer) }
  reply(data: PoseWorkerReply) { this.onmessage?.({ data } as MessageEvent<PoseWorkerReply>) }
  crash(message: string) { this.onerror?.({ message } as ErrorEvent) }
}

const video = {} as HTMLVideoElement
const frame = (timestamp: number) => ({ timestamp, landmarks: [], worldLandmarks: [] })

function setup(grab: () => Promise<ImageBitmap> = async () => ({ close: vi.fn() }) as unknown as ImageBitmap) {
  const worker = new FakeWorker()
  const promise = createWorkerBackend('http://local/mediapipe/', { createWorker: () => worker, grab, startTimeoutMs: 1000, detectTimeoutMs: 500 })
  return { worker, promise }
}

async function ready(grab?: () => Promise<ImageBitmap>) {
  const fixture = setup(grab)
  fixture.worker.reply({ type: 'ready', delegate: 'GPU' })
  return { ...fixture, loaded: await fixture.promise }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('worker pose backend', () => {
  it('initializes with an absolute base and reports the delegate', async () => {
    const { worker, loaded } = await ready()
    expect(worker.sent[0]).toEqual({ type: 'init', base: 'http://local/mediapipe/' })
    expect(loaded.delegate).toBe('GPU')
    expect(loaded.backend.threaded).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('transfers each frame and returns its pose with the model time', async () => {
    const { worker, loaded } = await ready()
    const pending = loaded.backend.detect(video, 123)
    await vi.advanceTimersByTimeAsync(0)
    const request = worker.sent[1]!
    expect(request).toMatchObject({ type: 'frame', id: 1, timestamp: 123 })
    expect(worker.transfers[1]).toEqual([(request as { bitmap: ImageBitmap }).bitmap])
    worker.reply({ type: 'result', id: 1, frame: frame(123), inferenceMs: 41 })
    await expect(pending).resolves.toEqual({ ...frame(123), inferenceMs: 41 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never has two frames in flight', async () => {
    const { worker, loaded } = await ready()
    const first = loaded.backend.detect(video, 1)
    await vi.advanceTimersByTimeAsync(0)
    await expect(loaded.backend.detect(video, 2)).rejects.toThrow('Já existe')
    worker.reply({ type: 'result', id: 1, frame: frame(1), inferenceMs: 1 })
    await first
  })

  it('rejects one failed frame but stays usable', async () => {
    const { worker, loaded } = await ready()
    const failed = loaded.backend.detect(video, 1)
    const expectation = expect(failed).rejects.toThrow('quadro ruim')
    await vi.advanceTimersByTimeAsync(0)
    worker.reply({ type: 'failed', id: 1, message: 'quadro ruim' })
    await expectation
    const next = loaded.backend.detect(video, 2)
    await vi.advanceTimersByTimeAsync(0)
    worker.reply({ type: 'result', id: 1, frame: frame(1), inferenceMs: 1 })
    worker.reply({ type: 'result', id: 2, frame: frame(2), inferenceMs: 1 })
    await expect(next).resolves.toMatchObject({ timestamp: 2 })
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it.each([
    ['an engine failure', (worker: FakeWorker) => worker.reply({ type: 'failed', id: null, message: 'sem modelo' }), 'sem modelo'],
    ['a crash', (worker: FakeWorker) => worker.crash('bloqueado'), 'bloqueado'],
  ] as const)('rejects startup on %s so the page can take over', async (_label, act, message) => {
    const { worker, promise } = setup()
    const expectation = expect(promise).rejects.toThrow(message)
    act(worker)
    await expectation
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds startup and each detection', async () => {
    const slow = setup()
    const startup = expect(slow.promise).rejects.toThrow('demorou')
    await vi.advanceTimersByTimeAsync(1001)
    await startup
    expect(slow.worker.terminate).toHaveBeenCalledOnce()

    const { worker, loaded } = await ready()
    const detection = expect(loaded.backend.detect(video, 1)).rejects.toThrow('parou de responder')
    await vi.advanceTimersByTimeAsync(501)
    await detection
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(loaded.backend.detect(video, 2)).rejects.toThrow('encerrada')
  })

  it('closes once, rejecting work in progress and releasing a late frame', async () => {
    const { worker, loaded } = await ready()
    const pending = expect(loaded.backend.detect(video, 1)).rejects.toThrow('encerrada')
    await vi.advanceTimersByTimeAsync(0)
    loaded.backend.close()
    loaded.backend.close()
    await pending
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)

    let deliver!: (bitmap: ImageBitmap) => void
    const late = await ready(() => new Promise((resolve) => { deliver = resolve }))
    const detection = expect(late.loaded.backend.detect(video, 1)).rejects.toThrow('encerrada')
    late.loaded.backend.close()
    const bitmap = { close: vi.fn() }
    deliver(bitmap as unknown as ImageBitmap)
    await detection
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(late.worker.sent).toHaveLength(1)
  })

  it('shrinks large frames, keeping proportion, and never enlarges', () => {
    expect(frameSize(1280, 720)).toEqual({ width: 640, height: 360 })
    expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 })
  })
})
