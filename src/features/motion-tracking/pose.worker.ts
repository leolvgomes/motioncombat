import { loadLandmarker } from './pose-landmarker'
import type { LoadedLandmarker } from './pose-landmarker'
import type { PoseWorkerReply, PoseWorkerRequest } from './worker-backend'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PoseWorkerRequest>) => void) | null
  postMessage(message: PoseWorkerReply): void
}

let landmarker: LoadedLandmarker | null = null

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Falha no rastreamento em segundo plano.'
}

scope.onmessage = ({ data }) => {
  if (data.type === 'init') {
    loadLandmarker(data.base, true).then(
      (loaded) => { landmarker = loaded; scope.postMessage({ type: 'ready', delegate: loaded.delegate }) },
      (error: unknown) => scope.postMessage({ type: 'failed', id: null, message: reason(error) }),
    )
    return
  }
  const { id, bitmap, timestamp } = data
  try {
    if (!landmarker) throw new Error('O rastreamento ainda não foi iniciado.')
    const started = performance.now()
    const frame = landmarker.detect(bitmap, timestamp)
    scope.postMessage({ type: 'result', id, frame, inferenceMs: performance.now() - started })
  } catch (error) {
    scope.postMessage({ type: 'failed', id, message: reason(error) })
  } finally {
    bitmap.close()
  }
}
