import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraErrorMessage, openCamera, stopStream } from './camera'

afterEach(() => vi.unstubAllGlobals())

describe('camera resource helpers', () => {
  it('requests an adjustable video stream without microphone access', async () => {
    const stream = { id: 'test-camera' }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })

    await expect(openCamera('720p')).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
      },
    })
    await openCamera('480p')
    expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      video: expect.objectContaining({ width: { ideal: 640 }, height: { ideal: 480 } }),
    }))
  })

  it('explains unavailable camera APIs and insecure contexts', async () => {
    vi.stubGlobal('navigator', {})
    await expect(openCamera('720p')).rejects.toThrow('HTTPS ou localhost')
  })

  it('stops every stream track', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
    stopStream({ getTracks: () => tracks } as unknown as MediaStream)
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce()
  })

  it.each([
    ['NotAllowedError', 'Acesso à câmera negado'],
    ['NotFoundError', 'Nenhuma webcam'],
    ['NotReadableError', 'outros aplicativos'],
    ['OverconstrainedError', '480p'],
    ['SecurityError', 'HTTPS'],
  ])('localizes %s', (name, expected) => {
    expect(cameraErrorMessage(new DOMException('browser-specific message', name))).toContain(expected)
  })

  it('handles unknown error values without exposing arbitrary objects', () => {
    expect(cameraErrorMessage({ secret: 'unexpected' })).toContain('Não foi possível iniciar')
  })
})
