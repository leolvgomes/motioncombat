import { Quaternion } from 'three'
import type { AnimationState, AttackPhase, AttackSide, PunchClipSampler } from '../../types/animation'
import type { RigJointName } from '../../types/robot'
import type { GestureEvent } from '../gestures/gesture-engine'
import { RIG_JOINTS } from '../motion/rig-controller'
import { createPunchClipSampler } from './combat-clips'

export interface HybridInput {
  readonly enabled: boolean
  readonly mode: 'tracking' | 'demo'
  readonly active: boolean
  readonly calibrated: boolean
  readonly trackingStatus: 'idle' | 'tracking' | 'partial' | 'lost' | 'demo'
  readonly mirrored: boolean
  readonly posture: 'neutral' | 'guard' | 'dodge-left' | 'dodge-right'
  readonly gesture: { readonly sequence: number; readonly generation: number; readonly event: GestureEvent } | null
  readonly generation: number
  readonly now: number
  readonly paused: boolean
  readonly durationScale: number
  readonly intensity: number
  readonly demoAttacks: boolean
}

export interface HybridAnimationSnapshot {
  readonly state: AnimationState
  readonly attackSide: AttackSide | null
  readonly phase: AttackPhase | null
  readonly progress: number
  readonly hitActive: boolean
  readonly blendWeight: number
  readonly source: 'gesture' | 'demo' | null
  readonly acceptedAttacks: number
  readonly ignoredGestures: number
}

type MutableSnapshot = { -readonly [Key in keyof HybridAnimationSnapshot]: HybridAnimationSnapshot[Key] }
type Rotations = Record<RigJointName, Quaternion>
interface Attack {
  readonly side: AttackSide
  readonly source: 'gesture' | 'demo'
  readonly sampler: PunchClipSampler
  elapsed: number
}
interface Returning {
  readonly side: AttackSide
  readonly source: 'gesture' | 'demo'
  elapsed: number
}

const RETURN_DURATION = 0.18
const MAX_GESTURE_AGE_MS = 250
const FIRST_DEMO_ATTACK_SECONDS = 1
const DEMO_INTERVAL_SECONDS = 1.8

function rotations(): Rotations {
  return Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion()])) as Rotations
}

function smoothstep(progress: number): number { return progress * progress * (3 - 2 * progress) }

/**
 * A display-rate animation layer over the current retargeted pose. No gesture
 * recognition, timers, hitboxes or gameplay state belong to this controller.
 */
export class HybridAnimationController {
  readonly rotations = rotations()
  private readonly savedClip = rotations()
  private readonly weights = Object.fromEntries(RIG_JOINTS.map((name) => [name, 0])) as Record<RigJointName, number>
  private readonly status: MutableSnapshot = {
    state: 'IDLE', attackSide: null, phase: null, progress: 0, hitActive: false,
    blendWeight: 0, source: null, acceptedAttacks: 0, ignoredGestures: 0,
  }
  private readonly createdAt: number
  private attack: Attack | null = null
  private returning: Returning | null = null
  private previousMode: HybridInput['mode'] | null = null
  private previousGeneration: number | null = null
  private previousMirror: boolean | null = null
  private previousDemoAttacks = false
  private previousEnabled = true
  private consumedSequence = -1
  private initialized = false
  private demoTime = 0
  private nextDemoAt = FIRST_DEMO_ATTACK_SECONDS
  private demoSide: AttackSide = 'left'

  constructor(createdAt = performance.now()) {
    this.createdAt = Number.isFinite(createdAt) ? Math.max(0, createdAt) : 0
  }

  /** Cached display data: copy it when publishing a lower-frequency React snapshot. */
  get snapshot(): HybridAnimationSnapshot { return this.status }

  update(base: Readonly<Rotations>, input: HybridInput, elapsed: number): void {
    const dt = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.1))
    const modeChanged = this.previousMode !== null && this.previousMode !== input.mode
    const epochChanged = this.previousGeneration !== null && this.previousGeneration !== input.generation
    const mirrorChanged = this.previousMirror !== null && this.previousMirror !== input.mirrored
    const routineChanged = this.previousDemoAttacks !== input.demoAttacks
    const enabledChanged = this.previousEnabled !== input.enabled
    if (this.previousGeneration !== input.generation) this.consumedSequence = -1
    if (modeChanged || epochChanged || routineChanged || enabledChanged) this.resetDemoClock()
    this.previousMode = input.mode
    this.previousGeneration = input.generation
    this.previousMirror = input.mirrored
    this.previousDemoAttacks = input.demoAttacks
    this.previousEnabled = input.enabled

    let canceled = false
    if (this.attack && (modeChanged || epochChanged || !input.enabled
      || this.attack.source === 'gesture' && (mirrorChanged || !this.live(input))
      || this.attack.source === 'demo' && (input.mode !== 'demo' || !input.demoAttacks))) {
      canceled = this.cancelAttack()
    }
    const gestureStarted = this.consumeGesture(input)
    if (!this.initialized) {
      this.copyBase(base)
      this.setBaseState(input)
      this.initialized = true
    }
    if (!this.attack && !this.returning) this.setBaseState(input)
    // Demo pause freezes its clock, pose and phase immediately, including a return.
    // Context cancellation above still disables the active hit window immediately.
    if (input.mode === 'demo' && input.paused) return

    let demoStarted = false
    if (input.mode === 'demo' && input.demoAttacks && input.enabled) {
      this.demoTime += dt
      if (this.demoTime + 1e-9 >= this.nextDemoAt) {
        this.nextDemoAt = this.demoTime + DEMO_INTERVAL_SECONDS
        if (!this.attack && !this.returning) {
          this.startAttack(this.demoSide, 'demo', input)
          this.demoSide = this.demoSide === 'left' ? 'right' : 'left'
          demoStarted = true
        }
      }
    }
    this.copyBase(base)
    if (this.attack) {
      if (!gestureStarted && !demoStarted) this.attack.elapsed = Math.min(this.attack.sampler.duration, this.attack.elapsed + dt)
      if (this.attack.elapsed >= this.attack.sampler.duration) {
        this.attack = null
        this.clearWeights()
        this.setBaseState(input)
        return
      }
      const sample = this.attack.sampler.sample(this.attack.elapsed)
      let maximumWeight = 0
      for (const name of RIG_JOINTS) {
        const weight = Math.max(0, Math.min(1, sample.weights[name] ?? 0))
        this.weights[name] = weight
        this.savedClip[name].fromArray(sample.pose[name])
        if (weight > 0) this.rotations[name].slerp(this.savedClip[name], weight)
        maximumWeight = Math.max(maximumWeight, weight)
      }
      this.status.state = this.attack.side === 'left' ? 'PUNCH_LEFT' : 'PUNCH_RIGHT'
      this.status.attackSide = this.attack.side
      this.status.phase = sample.phase
      this.status.progress = sample.progress
      this.status.hitActive = sample.hitActive
      this.status.blendWeight = maximumWeight
      this.status.source = this.attack.source
      return
    }
    if (this.returning) {
      if (!canceled) this.returning.elapsed += dt
      const progress = Math.min(1, this.returning.elapsed / RETURN_DURATION)
      const remaining = 1 - smoothstep(progress)
      let maximumWeight = 0
      for (const name of RIG_JOINTS) {
        const weight = this.weights[name] * remaining
        if (weight > 0) this.rotations[name].slerp(this.savedClip[name], weight)
        maximumWeight = Math.max(maximumWeight, weight)
      }
      if (progress >= 1) {
        this.returning = null
        this.clearWeights()
        this.setBaseState(input)
      } else {
        this.status.state = 'RETURNING'
        this.status.attackSide = this.returning.side
        this.status.phase = null
        this.status.progress = progress
        this.status.hitActive = false
        this.status.blendWeight = maximumWeight
        this.status.source = this.returning.source
      }
      return
    }
    this.setBaseState(input)
  }

  private live(input: HybridInput): boolean {
    return input.mode === 'tracking' && input.active && input.calibrated
      && (input.trackingStatus === 'tracking' || input.trackingStatus === 'partial')
  }

  private consumeGesture(input: HybridInput): boolean {
    const pulse = input.gesture
    if (!pulse || pulse.generation !== input.generation || !Number.isSafeInteger(pulse.sequence)
      || pulse.sequence < 0 || pulse.sequence <= this.consumedSequence) return false
    // Consume before any gate: disabling, being busy or changing epochs never queues an attack.
    this.consumedSequence = pulse.sequence
    const type = pulse.event.type
    if (type !== 'PUNCH_LEFT' && type !== 'PUNCH_RIGHT') return false
    const age = input.now - pulse.event.timestamp
    if (!input.enabled || !this.live(input) || this.attack || this.returning
      || !Number.isFinite(input.now) || !Number.isFinite(age) || age < 0 || age > MAX_GESTURE_AGE_MS
      || pulse.event.timestamp <= this.createdAt
      || !Number.isFinite(pulse.event.confidence) || pulse.event.confidence < 0.6 || pulse.event.confidence > 1) {
      this.status.ignoredGestures += 1
      return false
    }
    const humanLeft = type === 'PUNCH_LEFT'
    const modelLeft = input.mirrored ? !humanLeft : humanLeft
    this.startAttack(modelLeft ? 'left' : 'right', 'gesture', input)
    return true
  }

  private startAttack(side: AttackSide, source: Attack['source'], input: HybridInput): void {
    const sampler = createPunchClipSampler(side, { durationScale: input.durationScale, intensity: input.intensity })
    this.attack = { side, source, sampler, elapsed: 0 }
    this.clearWeights()
    this.status.acceptedAttacks += 1
  }

  private cancelAttack(): boolean {
    const attack = this.attack
    if (!attack) return false
    this.attack = null
    this.status.hitActive = false
    if (RIG_JOINTS.some((name) => this.weights[name] > 0.00001)) {
      this.returning = { side: attack.side, source: attack.source, elapsed: 0 }
      this.status.state = 'RETURNING'
      this.status.phase = null
      this.status.progress = 0
      return true
    }
    this.returning = null
    return false
  }

  private copyBase(base: Readonly<Rotations>): void {
    for (const name of RIG_JOINTS) this.rotations[name].copy(base[name])
  }

  private clearWeights(): void { for (const name of RIG_JOINTS) this.weights[name] = 0 }

  private resetDemoClock(): void {
    this.demoTime = 0
    this.nextDemoAt = FIRST_DEMO_ATTACK_SECONDS
    this.demoSide = 'left'
  }

  private setBaseState(input: HybridInput): void {
    const tracking = input.mode === 'tracking' && input.active
      && (input.trackingStatus === 'tracking' || input.trackingStatus === 'partial')
    this.status.state = !tracking ? 'IDLE' : input.posture === 'guard' ? 'GUARD'
      : input.posture === 'neutral' ? 'TRACKING' : 'DODGE'
    this.status.attackSide = null
    this.status.phase = null
    this.status.progress = 0
    this.status.hitActive = false
    this.status.blendWeight = 0
    this.status.source = null
  }
}
