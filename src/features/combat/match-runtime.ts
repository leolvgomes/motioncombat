import { CombatEngine } from '../../engine/combat/combat-engine'
import { RigController } from '../../engine/motion/rig-controller'
import { useLabStore } from '../../stores/lab-store'
import { useMatchStore } from '../../stores/match-store'
import { useRobotStore } from '../../stores/robot-store'
import type { CombatEvent, CombatInput, MatchMode } from '../../types/combat'
import { combatMotionRuntime } from '../motion-tracking/combat-motion-runtime'
import { readPose, readPoseAspectRatio } from '../motion-tracking/pose-stream'
import { readAnimationGeneration, readAnimationGesture } from '../robot/animation-signals'

/** The only bridge between capture, UI commands and the independent match simulation. */
export class MatchRuntime {
  private readonly engine = new CombatEngine()
  private readonly rig = new RigController()
  private nextPublication = 0
  private readonly listeners = new Set<(event: CombatEvent) => void>()

  constructor(private readonly clock: () => number = () => performance.now()) {}

  get fighters() { return this.engine.fighters }
  get snapshot() { return this.engine.snapshot }

  /** Presentation listeners (sound, effects, announcements) receive events synchronously after each step. */
  subscribe(listener: (event: CombatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(mode: MatchMode): boolean {
    const input = this.input(0)
    // A rejected live start must not change the source or discard calibration.
    if (mode === 'webcam' && !input.ready) { this.publish(input); return false }
    const started = this.engine.start(mode, input)
    if (started && mode === 'demo') useRobotStore.getState().setMode('demo')
    this.publish(this.input(0))
    this.dispatch()
    return started
  }

  pause(): void { this.engine.pause('manual'); this.publish(this.input(0)) }

  resume(): boolean {
    const input = this.input(0)
    const resumed = this.engine.resume(input)
    this.publish(input)
    return resumed
  }

  reset(): void { this.engine.reset(); this.publish(this.input(0)) }

  suspend(reason: 'view' | 'hidden'): void {
    this.engine.pause(reason)
    this.publish(this.input(0))
  }

  setSceneFps(fps: number | null): void { useMatchStore.getState().setSceneFps(fps) }

  step(elapsed: number): void {
    const input = this.input(elapsed)
    if (typeof document !== 'undefined' && document.hidden) this.engine.pause('hidden')
    this.engine.step(input, elapsed)
    const snapshot = this.engine.snapshot
    const previous = useMatchStore.getState()
    if (input.now >= this.nextPublication || previous.canFight !== input.ready
      || previous.snapshot.phase !== snapshot.phase || previous.snapshot.pauseReason !== snapshot.pauseReason
      || previous.opponentCue !== this.opponentCue
      || previous.snapshot.playerHealth !== snapshot.playerHealth || previous.snapshot.opponentHealth !== snapshot.opponentHealth
      || previous.snapshot.lastImpact?.id !== snapshot.lastImpact?.id) this.publish(input)
    this.dispatch()
  }

  private dispatch(): void {
    const events = this.engine.drainEvents()
    for (const event of events) {
      for (const listener of this.listeners) {
        // A failing presentation layer must never interrupt the simulation.
        try { listener(event) } catch (error) { console.error('Falha ao apresentar evento de combate:', error) }
      }
    }
  }

  private input(elapsed: number): CombatInput {
    const now = this.clock()
    const lab = useLabStore.getState()
    const pose = readPose()
    const active = lab.session.status === 'running' && useRobotStore.getState().mode === 'tracking'
    const age = pose ? now - pose.timestamp : Infinity
    const fresh = age >= 0 && age <= 400 && pose !== null && pose.status !== 'searching'
    const visible = typeof document === 'undefined' || !document.hidden
    this.rig.step({ mode: 'tracking', active, pose, mirrored: lab.mirrored,
      aspectRatio: readPoseAspectRatio(), now, paused: false }, elapsed)
    return {
      now, ready: active && visible && fresh && combatMotionRuntime.calibrated && combatMotionRuntime.motionValid,
      generation: readAnimationGeneration(), pulse: readAnimationGesture(), mirrored: lab.mirrored,
      posture: combatMotionRuntime.currentPosture, playerBase: this.rig.rotations,
    }
  }

  private publish(input: CombatInput): void {
    const snapshot = this.engine.snapshot
    useMatchStore.getState().publish({
      ...snapshot,
      playerStats: { ...snapshot.playerStats }, opponentStats: { ...snapshot.opponentStats },
      lastImpact: snapshot.lastImpact ? { ...snapshot.lastImpact } : null,
    }, input.ready, this.opponentCue)
    this.nextPublication = input.now + 125
  }

  private get opponentCue() {
    const frame = this.engine.fighters.opponent
    return this.engine.snapshot.phase === 'fighting' && !this.engine.snapshot.pauseReason
      && frame.action === 'telegraph' ? frame.attackSide : null
  }
}

export const matchRuntime = new MatchRuntime()
