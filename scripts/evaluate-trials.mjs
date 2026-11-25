// Compares recognition variants over a recording downloaded from the guided trials.
// Usage: npm run evaluate:trials -- path/to/steel-sync-afericao-*.json
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const path = process.argv[2]
if (!path) {
  console.error('Informe o arquivo da aferição: npm run evaluate:trials -- arquivo.json')
  process.exit(1)
}

// A private cache keeps a running development server untouched.
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: 'node_modules/.vite-evaluate' })
try {
  const { parseRecording, scoreTrials, evaluateRecording } = await server.ssrLoadModule('/src/engine/motion/trials.ts')
  const recording = parseRecording(await readFile(path, 'utf8'))
  if (!recording) throw new Error('O arquivo não é uma aferição válida desta versão.')
  const seconds = recording.steps.at(-1).endsAt / 1000
  console.log(`Gravado em ${recording.recordedAt} · ${(recording.frames.length / seconds).toFixed(1)} Hz · proporção ${recording.aspectRatio.toFixed(3)}`)
  if (recording.performance) console.log('Desempenho:', JSON.stringify(recording.performance))
  const variants = [
    ['Ao vivo', scoreTrials(recording.steps, recording.events)],
    ['Atual (reprocessado)', evaluateRecording(recording)],
    ['Filtro fixo de 80 ms', evaluateRecording(recording, { adaptive: false })],
    ['Proporção corrigida', evaluateRecording(recording, { aspectCorrected: true })],
    ['Só socos retos', evaluateRecording(recording, { advancedAttacks: false })],
    ['Metade dos quadros', evaluateRecording(recording, { keepEvery: 2 })],
  ]
  console.table(Object.fromEntries(variants.map(([name, summary]) => [name, summary ? {
    acerto: `${Math.round(summary.accuracy * 100)}%`,
    ...Object.fromEntries(summary.gestures.map(({ gesture, correct, total }) => [gesture, `${correct}/${total}`])),
    parado: summary.idleFalsePositives, soltos: summary.strayAttacks,
  } : { acerto: 'calibração recusada' }])))
  for (const { step, outcome, detected, delayMs } of variants[0][1].results) {
    if (outcome !== 'correct' && outcome !== 'clean') console.log(`- ${step.instruction} (${step.repetition}/${step.repetitions}): ${outcome} ${detected.join(', ')} ${delayMs ?? ''}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await server.close()
}
