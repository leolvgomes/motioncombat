import type { CombatEvent, FighterId, MatchMode } from '../../types/combat'

export type SoundCue = 'countdown' | 'fight' | 'swing' | 'hit' | 'knockout' | 'block' | 'dodge' | 'telegraph'
  | 'round-end' | 'victory' | 'defeat' | 'draw'

/** Which sound, if any, a simulation event deserves. Pure, so the mapping is testable without audio. */
export function cueForEvent(event: CombatEvent, mode: MatchMode): SoundCue | null {
  switch (event.type) {
    case 'countdown': return 'countdown'
    case 'fight': return 'fight'
    case 'attack': return 'swing'
    // Only a webcam player needs the warning; in demo it would be noise from both AIs.
    case 'telegraph': return mode === 'webcam' && event.fighter === 'opponent' ? 'telegraph' : null
    case 'impact': {
      const { result } = event.impact
      if (result === 'miss') return null
      if (result === 'dodged') return 'dodge'
      if (event.defenderHealth <= 0) return 'knockout'
      return result === 'blocked' ? 'block' : 'hit'
    }
    case 'round-end': return 'round-end'
    case 'match-end':
      if (event.winner === 'draw') return 'draw'
      return event.mode === 'demo' || event.winner === 'player' ? 'victory' : 'defeat'
  }
}

/** The fighter a sound belongs to, used for a slight timbre difference between the two robots. */
export function cueFighter(event: CombatEvent): FighterId | null {
  if (event.type === 'attack' || event.type === 'telegraph') return event.fighter
  if (event.type === 'impact') return event.impact.attacker
  return null
}

const MAX_VOICES = 8
const SILENCE = 0.0001

interface ToneOptions {
  type: OscillatorType
  from: number
  to?: number
  start?: number
  duration: number
  gain: number
  attack?: number
}

interface NoiseOptions {
  filter: BiquadFilterType
  from: number
  to?: number
  q?: number
  start?: number
  duration: number
  gain: number
}

function defaultContext(): AudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }
  const Context = scope.AudioContext ?? scope.webkitAudioContext
  return Context ? new Context({ latencyHint: 'interactive' }) : null
}

/**
 * Procedural combat sounds. The context is only created inside a user gesture (`unlock`) to respect autoplay
 * policies; before that, and when disabled, every call is a no-op. No audio files are loaded.
 */
export class CombatAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private enabled = true
  private volume = 0.7
  private voiceEnds: number[] = []

  constructor(private readonly createContext: () => AudioContext | null = defaultContext) {}

  get unlocked(): boolean { return this.context !== null }

  /** Must run inside a click/keyboard handler the first time. Safe to call repeatedly. */
  unlock(): void {
    if (!this.context) {
      let context: AudioContext | null = null
      try { context = this.createContext() } catch { context = null }
      if (!context) return
      this.context = context
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.setValueAtTime(-14, context.currentTime)
      compressor.ratio.setValueAtTime(4, context.currentTime)
      this.master = context.createGain()
      this.master.gain.setValueAtTime(this.targetGain, context.currentTime)
      this.master.connect(compressor)
      compressor.connect(context.destination)
      const length = Math.max(1, Math.floor(context.sampleRate * 0.6))
      this.noiseBuffer = context.createBuffer(1, length, context.sampleRate)
      const data = this.noiseBuffer.getChannelData(0)
      let seed = 0x2545f491
      for (let index = 0; index < data.length; index++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
        data[index] = (seed >>> 0) / 2147483648 - 1
      }
    }
    this.resume()
  }

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : this.volume
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.targetGain, this.context.currentTime, 0.02)
    // Re-enabling right after a click must also wake a context created while sound was off.
    this.resume()
  }

  suspend(): void {
    if (this.context?.state === 'running') this.context.suspend().catch(() => undefined)
  }

  resume(): void {
    if (this.context && this.enabled && this.context.state === 'suspended') this.context.resume().catch(() => undefined)
  }

  dispose(): void {
    this.context?.close().catch(() => undefined)
    this.context = null
    this.master = null
    this.noiseBuffer = null
    this.voiceEnds = []
  }

  play(cue: SoundCue, fighter: FighterId | null = null): boolean {
    const context = this.context
    if (!context || !this.master || !this.enabled || this.volume <= 0 || context.state !== 'running') return false
    const now = context.currentTime
    this.voiceEnds = this.voiceEnds.filter((end) => end > now)
    if (this.voiceEnds.length >= MAX_VOICES) return false
    const pitch = fighter === 'opponent' ? 0.84 : 1
    const end = this.render(cue, now, pitch)
    this.voiceEnds.push(end)
    return true
  }

  private get targetGain(): number { return this.enabled ? this.volume * 0.8 : 0 }

  private render(cue: SoundCue, now: number, pitch: number): number {
    switch (cue) {
      case 'countdown':
        return this.tone({ type: 'triangle', from: 880, start: now, duration: 0.14, gain: 0.28 })
      case 'fight':
        this.noise({ filter: 'highpass', from: 2400, start: now, duration: 0.18, gain: 0.12 })
        this.tone({ type: 'triangle', from: 1320, start: now, duration: 0.32, gain: 0.16 })
        return this.tone({ type: 'sawtooth', from: 440, to: 880, start: now, duration: 0.36, gain: 0.12 })
      case 'swing':
        return this.noise({ filter: 'bandpass', from: 650 * pitch, to: 2600 * pitch, q: 1.3, start: now, duration: 0.16, gain: 0.26 })
      case 'hit':
        this.noise({ filter: 'lowpass', from: 2600, to: 380, start: now, duration: 0.12, gain: 0.5 })
        this.tone({ type: 'square', from: 95 * pitch, start: now, duration: 0.07, gain: 0.1 })
        return this.tone({ type: 'sine', from: 155 * pitch, to: 52, start: now, duration: 0.24, gain: 0.75, attack: 0.002 })
      case 'knockout':
        this.noise({ filter: 'lowpass', from: 3200, to: 220, start: now, duration: 0.5, gain: 0.55 })
        this.tone({ type: 'sine', from: 160, to: 48, start: now, duration: 0.3, gain: 0.8, attack: 0.002 })
        return this.tone({ type: 'sine', from: 92, to: 34, start: now + 0.05, duration: 0.7, gain: 0.6 })
      case 'block':
        this.noise({ filter: 'highpass', from: 3000, start: now, duration: 0.05, gain: 0.22 })
        this.tone({ type: 'square', from: 310 * pitch, start: now, duration: 0.06, gain: 0.08 })
        this.tone({ type: 'triangle', from: 1870 * pitch, start: now, duration: 0.2, gain: 0.1 })
        return this.tone({ type: 'triangle', from: 1250 * pitch, start: now, duration: 0.28, gain: 0.16, attack: 0.002 })
      case 'dodge':
        return this.noise({ filter: 'bandpass', from: 1900, to: 700, q: 0.9, start: now, duration: 0.2, gain: 0.16 })
      case 'telegraph':
        this.tone({ type: 'triangle', from: 1040, start: now, duration: 0.06, gain: 0.12 })
        return this.tone({ type: 'triangle', from: 1040, start: now + 0.09, duration: 0.06, gain: 0.12 })
      case 'round-end': {
        let end = now
        for (const offset of [0, 0.24, 0.48]) {
          this.tone({ type: 'sine', from: 2215, start: now + offset, duration: 0.5, gain: 0.06 })
          end = this.tone({ type: 'sine', from: 880, start: now + offset, duration: 0.85, gain: 0.22, attack: 0.002 })
        }
        return end
      }
      case 'victory': {
        let end = now
        ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
          end = this.tone({ type: 'triangle', from: frequency, start: now + 0.45 + index * 0.12, duration: index === 3 ? 0.6 : 0.26, gain: 0.18 })
        })
        return end
      }
      case 'defeat': {
        let end = now
        ;[392, 329.63, 261.63].forEach((frequency, index) => {
          end = this.tone({ type: 'triangle', from: frequency, to: index === 2 ? 220 : undefined, start: now + 0.45 + index * 0.22, duration: index === 2 ? 0.8 : 0.4, gain: 0.16 })
        })
        return end
      }
      case 'draw':
        this.tone({ type: 'triangle', from: 523.25, start: now + 0.45, duration: 0.35, gain: 0.15 })
        return this.tone({ type: 'triangle', from: 523.25, start: now + 0.85, duration: 0.5, gain: 0.15 })
    }
  }

  private envelope(start: number, duration: number, gain: number, attack: number): GainNode {
    const context = this.context as AudioContext
    const node = context.createGain()
    node.gain.setValueAtTime(SILENCE, start)
    node.gain.linearRampToValueAtTime(Math.max(SILENCE, gain), start + attack)
    // Exponential ramps cannot reach 0; SILENCE keeps the decay valid.
    node.gain.exponentialRampToValueAtTime(SILENCE, start + duration)
    node.connect(this.master as GainNode)
    return node
  }

  private tone({ type, from, to, start = 0, duration, gain, attack = 0.005 }: ToneOptions): number {
    const context = this.context as AudioContext
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from, start)
    if (to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration)
    oscillator.connect(this.envelope(start, duration, gain, attack))
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
    return start + duration + 0.02
  }

  private noise({ filter, from, to, q = 0.7, start = 0, duration, gain }: NoiseOptions): number {
    const context = this.context as AudioContext
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const shaper = context.createBiquadFilter()
    shaper.type = filter
    shaper.Q.setValueAtTime(q, start)
    shaper.frequency.setValueAtTime(from, start)
    if (to !== undefined) shaper.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration)
    source.connect(shaper)
    shaper.connect(this.envelope(start, duration, gain, 0.004))
    source.start(start)
    source.stop(start + duration + 0.02)
    return start + duration + 0.02
  }
}

export const combatAudio = new CombatAudio()
