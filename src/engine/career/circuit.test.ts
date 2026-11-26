import { describe, expect, it } from 'vitest'
import { CIRCUIT, EMPTY_CIRCUIT, abandonCircuit, circuitOpponent, parseCircuit, recordCircuitMatch, startCircuit } from './circuit'

describe('circuit', () => {
  it('advances on wins, repeats on draws and crowns the champion after the last fight', () => {
    let progress = startCircuit(EMPTY_CIRCUIT, 'hard', 10)
    expect(circuitOpponent(progress.run!)).toBe(CIRCUIT[0])
    let result = recordCircuitMatch(progress, 'draw')
    expect(result.outcome).toBe('retry')
    expect(result.progress.run?.stage).toBe(0)
    for (let stage = 1; stage < CIRCUIT.length; stage++) {
      result = recordCircuitMatch(progress, 'player')
      expect(result.outcome).toBe('advanced')
      progress = result.progress
      expect(circuitOpponent(progress.run!)).toBe(CIRCUIT[stage])
    }
    result = recordCircuitMatch(progress, 'player')
    expect(result.outcome).toBe('champion')
    expect(result.progress).toMatchObject({ run: null, bestStage: CIRCUIT.length, titles: { easy: 0, normal: 0, hard: 1 } })
  })

  it('ends the run on a loss but keeps the best result', () => {
    const progress = recordCircuitMatch(startCircuit(EMPTY_CIRCUIT, 'normal', 0), 'player').progress
    const result = recordCircuitMatch(progress, 'opponent')
    expect(result).toMatchObject({ outcome: 'eliminated', progress: { run: null, bestStage: 1 } })
    expect(abandonCircuit(progress).run).toBeNull()
  })

  it('round-trips through storage and rejects inconsistent values', () => {
    const progress = recordCircuitMatch(startCircuit(EMPTY_CIRCUIT, 'easy', 5), 'player').progress
    expect(parseCircuit(JSON.parse(JSON.stringify(progress)))).toEqual(progress)
    expect(parseCircuit(null)).toEqual(EMPTY_CIRCUIT)
    expect(parseCircuit({ run: { stage: 9, difficulty: 'easy', startedAt: 1 }, bestStage: 99, titles: { easy: -1, hard: 2 } }))
      .toEqual({ run: null, bestStage: 0, titles: { easy: 0, normal: 0, hard: 2 } })
    expect(parseCircuit({ run: { stage: 1, difficulty: 'insane', startedAt: 1 } }).run).toEqual({ stage: 1, difficulty: 'normal', startedAt: 1 })
  })
})
