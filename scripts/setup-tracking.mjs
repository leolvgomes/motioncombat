import { cp, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = path.join(root, 'public', 'mediapipe')
const modelPath = path.join(target, 'pose_landmarker_lite.task')
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

await mkdir(target, { recursive: true })
await cp(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), path.join(target, 'wasm'), { recursive: true })
const existingModel = await stat(modelPath).catch(() => null)
if (existingModel && existingModel.size > 1_000_000) {
  console.log('Modelo já disponível; WebAssembly sincronizado com a versão instalada.')
} else {
  console.log('Baixando Pose Landmarker Lite (modelo oficial do Google)…')
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90_000) })
  if (!response.ok) throw new Error(`Não foi possível baixar o modelo: HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength < 1_000_000) throw new Error('O arquivo recebido não é um modelo válido.')
  await writeFile(`${modelPath}.download`, data)
  await rename(`${modelPath}.download`, modelPath)
  console.log(`Modelo pronto (${(data.byteLength / 1_000_000).toFixed(1)} MB).`)
}
