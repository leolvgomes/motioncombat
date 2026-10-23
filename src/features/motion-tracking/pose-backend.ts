import type { Landmark, PoseFrame } from '../../types/motion'

export type InferenceDelegate = 'GPU' | 'CPU'

export interface PoseBackend {
  detect(video: HTMLVideoElement, timestamp: number): PoseFrame
  close(): void
}

export interface LoadedPoseBackend {
  backend: PoseBackend
  delegate: InferenceDelegate
}

/** Loaded on demand so the idle laboratory does not initialize WebAssembly/WebGL. */
export async function createPoseBackend(): Promise<LoadedPoseBackend> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const base = `${import.meta.env.BASE_URL}mediapipe/`
  let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
  try {
    fileset = await FilesetResolver.forVisionTasks(`${base}wasm`)
  } catch {
    throw new Error('Não foi possível carregar o motor de visão. Verifique os arquivos locais do MediaPipe e recarregue a página.')
  }

  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      })
      const copyLandmarks = (points: readonly Landmark[] | undefined): readonly Landmark[] =>
        points?.map(({ x, y, z, visibility }) => ({ x, y, z, visibility: visibility ?? 0 })) ?? []

      return {
        delegate,
        backend: {
          detect(video, timestamp) {
            const result = landmarker.detectForVideo(video, timestamp)
            return {
              timestamp,
              landmarks: copyLandmarks(result.landmarks[0]),
              worldLandmarks: copyLandmarks(result.worldLandmarks[0]),
            }
          },
          close: () => landmarker.close(),
        },
      }
    } catch {
      // WebGL may be unavailable or deny initialization; the CPU delegate is a functional fallback.
      if (delegate === 'CPU') {
        throw new Error('Não foi possível iniciar o rastreamento em GPU ou CPU. Verifique os arquivos do modelo e use um navegador atualizado com WebAssembly.')
      }
    }
  }
  throw new Error('O motor de visão não está disponível neste navegador.')
}
