import { describe, expect, it, vi } from 'vitest'
import type { CombatEvent } from '../../types/combat'
import { CombatAudio, cueFighter, cueForEvent } from './combat-audio'
import type { SoundCue } from './combat-audio'

/** Minimal Web Audio double. It enforces the API constraint that exponential ramps never reach zero. */
class FakeParam {
  value = 0
  setValueAtTime(value: number) { this.value = value; return this }
  linearRampToValueAtTime(value: number) { this.value = value; return this }
  exponentialRampToValueAtTime(value: number) {
    if (!(value > 0)) throw new RangeError('exponential ramp target must be positive')
    this.value = value
    return this
  }
  setTargetAtTime(value: number) { this.value = value; return this }
}

class FakeNode {
  readonly outputs: unknown[] = []
  connect<Target>(target: Target): Target { this.outputs.push(target); return target }
  disconnect() {}
}

class FakeSource extends FakeNode {
  type = 'sine'
  buffer: unknown = null
  readonly frequency = new FakeParam()
  readonly started: number[] = []
  readonly stopped: number[] = []
  start(time: number) { this.started.push(time) }
  stop(time: number) { this.stopped.push(time) }
}

class FakeContext {
  state: AudioContextState = 'running'
  currentTime = 0
  sampleRate = 8000
  readonly destination = new FakeNode()
  readonly sources: FakeSource[] = []
  readonly gains: { gain: FakeParam }[] = []
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain() { const node = Object.assign(new FakeNode(), { gain: new FakeParam() }); this.gains.push(node); return node }
  createOscillator() { const node = new FakeSource(); this.sources.push(node); return node }
  createBufferSource() { const node = new FakeSource(); this.sources.push(node); return node }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }) }
  createDynamicsCompressor() { return Object.assign(new FakeNode(), { threshold: new FakeParam(), ratio: new FakeParam() }) }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data } }
}

function audio() {
  const context = new FakeContext()
  const factory = vi.fn(() => context as unknown as AudioContext)
  return { context, factory, audio: new CombatAudio(factory) }
}

const ALL_CUES: SoundCue[] = ['countdown', 'fight', 'swing', 'hit', 'knockout', 'block', 'dodge', 'telegraph', 'round-end', 'victory', 'defeat', 'draw']
const impact = (result: 'hit' | 'blocked' | 'dodged' | 'miss', defenderHealth = 50): CombatEvent =>
  ({ type: 'impact', impact: { id: 1, attacker: 'opponent', result, damage: 12 }, position: [0, 1, 0], defenderHealth })

describe('combat sound mapping', () => {
  it('maps each meaningful event to one cue and stays silent for misses', () => {
    expect(cueForEvent({ type: 'countdown', round: 1, value: 3 }, 'webcam')).toBe('countdown')
    expect(cueForEvent({ type: 'fight', round: 2 }, 'demo')).toBe('fight')
    expect(cueForEvent({ type: 'attack', fighter: 'player', side: 'left' }, 'webcam')).toBe('swing')
    expect(cueForEvent(impact('hit'), 'webcam')).toBe('hit')
    expect(cueForEvent(impact('blocked'), 'webcam')).toBe('block')
    expect(cueForEvent(impact('dodged'), 'webcam')).toBe('dodge')
    expect(cueForEvent(impact('miss'), 'webcam')).toBeNull()
    expect(cueForEvent(impact('hit', 0), 'webcam')).toBe('knockout')
    expect(cueForEvent(impact('blocked', 0), 'webcam')).toBe('knockout')
    expect(cueForEvent({ type: 'round-end', round: 1, winner: 'player', knockout: true }, 'webcam')).toBe('round-end')
  })

  it('warns only a webcam player about the opponent wind-up', () => {
    expect(cueForEvent({ type: 'telegraph', fighter: 'opponent', side: 'left' }, 'webcam')).toBe('telegraph')
    expect(cueForEvent({ type: 'telegraph', fighter: 'opponent', side: 'left' }, 'demo')).toBeNull()
    expect(cueForEvent({ type: 'telegraph', fighter: 'player', side: 'left' }, 'webcam')).toBeNull()
  })

  it('chooses the ending from the player perspective, and neutral fanfare for demos', () => {
    expect(cueForEvent({ type: 'match-end', winner: 'player', mode: 'webcam' }, 'webcam')).toBe('victory')
    expect(cueForEvent({ type: 'match-end', winner: 'opponent', mode: 'webcam' }, 'webcam')).toBe('defeat')
    expect(cueForEvent({ type: 'match-end', winner: 'opponent', mode: 'demo' }, 'demo')).toBe('victory')
    expect(cueForEvent({ type: 'match-end', winner: 'draw', mode: 'webcam' }, 'webcam')).toBe('draw')
  })

  it('identifies the fighter that owns a sound', () => {
    expect(cueFighter({ type: 'attack', fighter: 'opponent', side: 'right' })).toBe('opponent')
    expect(cueFighter(impact('hit'))).toBe('opponent')
    expect(cueFighter({ type: 'fight', round: 1 })).toBeNull()
  })
})

describe('CombatAudio', () => {
  it('creates no audio context before a user gesture unlocks it', () => {
    const { audio: sound, factory } = audio()
    expect(sound.play('hit')).toBe(false)
    expect(factory).not.toHaveBeenCalled()
    sound.unlock()
    sound.unlock()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(sound.unlocked).toBe(true)
    expect(sound.play('hit')).toBe(true)
  })

  it('renders every cue with valid envelopes and scheduled stops', () => {
    for (const cue of ALL_CUES) {
      const { audio: sound, context } = audio()
      sound.unlock()
      context.currentTime = 2
      expect(sound.play(cue, 'opponent')).toBe(true)
      expect(context.sources.length).toBeGreaterThan(0)
      for (const source of context.sources) {
        expect(source.started[0]).toBeGreaterThanOrEqual(2)
        expect(source.stopped[0]).toBeGreaterThan(source.started[0])
      }
    }
  })

  it('stays silent while disabled, at zero volume or with a suspended context', () => {
    const { audio: sound, context } = audio()
    sound.unlock()
    sound.configure(false, 0.5)
    expect(sound.play('swing')).toBe(false)
    expect(context.gains[0].gain.value).toBe(0)
    sound.configure(true, 0)
    expect(sound.play('swing')).toBe(false)
    sound.configure(true, 2)
    expect(context.gains[0].gain.value).toBeCloseTo(0.8)
    context.state = 'suspended'
    expect(sound.play('swing')).toBe(false)
  })

  it('resumes when sound is turned back on and suspends with the page', () => {
    const { audio: sound, context } = audio()
    sound.configure(false, 0.7)
    sound.unlock()
    context.state = 'suspended'
    sound.resume()
    expect(context.resume).not.toHaveBeenCalled()
    sound.configure(true, 0.7)
    expect(context.resume).toHaveBeenCalledTimes(1)
    context.state = 'running'
    sound.suspend()
    expect(context.suspend).toHaveBeenCalledTimes(1)
  })

  it('limits overlapping voices and frees them once their sounds end', () => {
    const { audio: sound, context } = audio()
    sound.unlock()
    const played = Array.from({ length: 12 }, () => sound.play('hit')).filter(Boolean)
    expect(played).toHaveLength(8)
    context.currentTime = 1
    expect(sound.play('hit')).toBe(true)
  })

  it('degrades to silence when Web Audio is unavailable', () => {
    const missing = new CombatAudio(() => null)
    missing.unlock()
    expect(missing.unlocked).toBe(false)
    expect(missing.play('fight')).toBe(false)
    const failing = new CombatAudio(() => { throw new Error('blocked') })
    expect(() => failing.unlock()).not.toThrow()
    expect(failing.play('fight')).toBe(false)
  })

  it('closes its context on dispose', () => {
    const { audio: sound, context } = audio()
    sound.unlock()
    sound.dispose()
    expect(context.close).toHaveBeenCalled()
    expect(sound.unlocked).toBe(false)
  })
})
