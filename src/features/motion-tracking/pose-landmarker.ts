import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark, PoseFrame } from '../../types/motion'

export type InferenceDelegate = 'GPU' | 'CPU'

export const ENGINE_LOAD_ERROR = 'Não foi possível carregar o motor de visão. Verifique os arquivos locais do MediaPipe e recarregue a página.'
export const DELEGATE_ERROR = 'Não foi possível iniciar o rastreamento em GPU ou CPU. Verifique os arquivos do modelo e use um navegador atualizado com WebAssembly.'

export interface LoadedLandmarker {
  readonly delegate: InferenceDelegate
  detect(source: TexImageSource, timestamp: number): PoseFrame
  close(): void
}

function copyLandmarks(points: readonly Landmark[] | undefined): readonly Landmark[] {
  return points?.map(({ x, y, z, visibility }) => ({ x, y, z, visibility: visibility ?? 0 })) ?? []
}

const WARM_UP_FRAMES = 4

/** A plain drawn figure, only so both model stages run once. It never reaches the application. */
function drawFigure(canvas: OffscreenCanvas | HTMLCanvasElement): void {
  const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!context) return
  const { width, height } = canvas
  context.scale(width / 1280, height / 720)
  context.fillStyle = '#c9cdd2'
  context.fillRect(0, 0, 1280, 720)
  context.fillStyle = '#2d4f86'
  context.fillRect(530, 270, 220, 450)
  context.lineCap = 'round'
  for (const side of [-1, 1]) {
    for (const [color, size, from, to] of [['#2d4f86', 52, [112, 295], [175, 430]], ['#d9a887', 40, [175, 430], [120, 330]]] as const) {
      context.strokeStyle = color
      context.lineWidth = size
      context.beginPath()
      context.moveTo(640 + side * from[0], from[1])
      context.lineTo(640 + side * to[0], to[1])
      context.stroke()
    }
  }
  context.fillStyle = '#d9a887'
  context.fillRect(612, 205, 56, 70)
  context.beginPath()
  context.ellipse(640, 160, 58, 74, 0, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#3a261a'
  context.beginPath()
  context.ellipse(640, 115, 62, 44, 0, 0, Math.PI * 2)
  context.fill()
}

/** Moves shader compilation into loading, instead of freezing the first seconds of tracking. */
function warmUp(landmarker: PoseLandmarker): void {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(640, 360)
      : Object.assign(document.createElement('canvas'), { width: 640, height: 360 })
    drawFigure(canvas)
    // Small timestamps: every real frame comes from a much later page clock.
    for (let frame = 1; frame <= WARM_UP_FRAMES; frame++) landmarker.detectForVideo(canvas, frame)
  } catch { /* The first real frame reports any lasting problem. */ }
}

/**
 * Shared by the page and the worker. `base` must be absolute: inside a module worker the runtime is
 * fetched with a dynamic import, which a development server would otherwise rewrite.
 */
export async function loadLandmarker(base: string, moduleRuntime: boolean): Promise<LoadedLandmarker> {
  const { FilesetResolver, PoseLandmarker: Landmarker } = await import('@mediapipe/tasks-vision')
  let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
  try {
    fileset = await FilesetResolver.forVisionTasks(`${base}wasm`, moduleRuntime)
  } catch {
    throw new Error(ENGINE_LOAD_ERROR)
  }

  for (const delegate of ['GPU', 'CPU'] as const) {
    let landmarker: PoseLandmarker
    try {
      landmarker = await Landmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      })
    } catch {
      // WebGL may be unavailable or deny initialization; the CPU delegate is a functional fallback.
      continue
    }
    warmUp(landmarker)
    return {
      delegate,
      detect(source, timestamp) {
        const result = landmarker.detectForVideo(source, timestamp)
        return { timestamp, landmarks: copyLandmarks(result.landmarks[0]), worldLandmarks: copyLandmarks(result.worldLandmarks[0]) }
      },
      close: () => landmarker.close(),
    }
  }
  throw new Error(DELEGATE_ERROR)
}
