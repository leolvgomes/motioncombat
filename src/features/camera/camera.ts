export type CameraResolution = '720p' | '480p'

/** Ask only after a deliberate UI action; browsers require a secure context. */
export async function openCamera(resolution: CameraResolution): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('A webcam exige HTTPS ou localhost e um navegador com suporte a câmera.')
  }

  const dimensions = resolution === '720p' ? { width: 1280, height: 720 } : { width: 640, height: 480 }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: dimensions.width },
      height: { ideal: dimensions.height },
      frameRate: { ideal: 30, max: 30 },
    },
  })
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Acesso à câmera negado. Libere a permissão nas configurações do navegador e tente novamente.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma webcam foi encontrada. Conecte uma câmera e tente novamente.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Não foi possível abrir a webcam. Feche outros aplicativos que estejam usando a câmera.'
    case 'OverconstrainedError':
      return 'A câmera não suporta esta configuração. Selecione 480p e tente novamente.'
    case 'SecurityError':
      return 'O navegador bloqueou a câmera. Use localhost ou HTTPS e verifique as permissões.'
    default:
      return error instanceof Error && error.message
        ? error.message
        : 'Não foi possível iniciar o laboratório. Verifique a webcam e tente novamente.'
  }
}
