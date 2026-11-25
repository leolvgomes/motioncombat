import { createRecord } from '../../engine/career/career'
import { CombatEngine } from '../../engine/combat/combat-engine'
import { RigController } from '../../engine/motion/rig-controller'
import { ReplayPlayer, ReplayRecorder } from '../../engine/replay/replay'
import type { Replay, ReplaySpeed } from '../../engine/replay/replay'
import { useCareerStore } from '../../stores/career-store'
import { useLabStore } from '../../stores/lab-store'
import { useMatchStore } from '../../stores/match-store'
import { useProfileStore } from '../../stores/profile-store'
import { useReplayStore } from '../../stores/replay-store'
import { useRobotStore } from '../../stores/robot-store'
import type { CombatEvent, CombatInput, CombatSnapshot, MatchMode } from '../../types/combat'
import { sanitizeName } from '../customization/catalog'
import { combatMotionRuntime } from '../motion-tracking/combat-motion-runtime'
import { readPose, readPoseAspectRatio } from '../motion-tracking/pose-stream'
import { readAnimationGeneration, readAnimationGesture } from '../robot/animation-signals'

/** The only bridge between capture, UI commands, the independent match simulation and its replays. */
export class MatchRuntime {
  private readonly engine = new CombatEngine()
  private readonly rig = new RigController()
  private readonly recorder = new ReplayRecorder()
  private player: ReplayPlayer | null = null
  private nextPublication = 0
  private matchId = ''
  private matchSequence = 0
  private epoch = 0
  private readonly listeners = new Set<(event: CombatEvent) => void>()

  constructor(private readonly clock: () => number = () => performance.now(), private readonly wallClock: () => number = () => Date.now()) {}

  get fighters() { return this.player?.fighters ?? this.engine.fighters }
  get snapshot(): CombatSnapshot { return this.player?.snapshot ?? this.engine.snapshot }
  get replaying(): boolean { return this.player !== null }
  get currentMatchId(): string { return this.matchId }
  /** Changes whenever the scene jumps in time, so transient effects can be cleared. */
  get sceneEpoch(): number { return this.epoch }
  /** A replay never interrupts a running or paused match. */
  get canReplay(): boolean { return this.engine.snapshot.phase === 'ready' || this.engine.snapshot.phase === 'finished' }

  /** Presentation listeners (sound, effects, announcements) receive events synchronously after each step. */
  subscribe(listener: (event: CombatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(mode: MatchMode): boolean {
    const input = this.input(0)
    // A rejected live start must not change the source or discard calibration.
    if (this.player || mode === 'webcam' && !input.ready) { this.publish(input); return false }
    this.saveRecording()
    const started = this.engine.start(mode, input)
    if (started) {
      if (mode === 'demo') useRobotStore.getState().setMode('demo')
      const { name, look, arena } = useProfileStore.getState()
      const recordedAt = this.wallClock()
      this.matchId = `${recordedAt.toString(36)}-${(++this.matchSequence).toString(36)}`
      this.recorder.begin({ id: this.matchId, recordedAt, mode, name: sanitizeName(name), look, arena })
    }
    this.publish(this.input(0))
    this.dispatch(this.engine.drainEvents())
    return started
  }

  pause(): void { this.engine.pause('manual'); this.publish(this.input(0)) }

  resume(): boolean {
    const input = this.input(0)
    const resumed = this.engine.resume(input)
    this.publish(input)
    return resumed
  }

  reset(): void {
    this.saveRecording()
    this.engine.reset()
    this.publish(this.input(0))
  }

  suspend(reason: 'view' | 'hidden'): void {
    this.player?.pause()
    this.engine.pause(reason)
    this.publish(this.input(0))
  }

  setSceneFps(fps: number | null): void { useMatchStore.getState().setSceneFps(fps) }

  startReplay(replay: Replay): boolean {
    if (!this.canReplay) return false
    this.saveRecording()
    this.player = new ReplayPlayer(replay)
    this.epoch += 1
    this.publish(this.input(0))
    return true
  }

  stopReplay(): void {
    if (!this.player) return
    this.player = null
    this.epoch += 1
    this.publish(this.input(0))
  }

  toggleReplay(): void {
    const player = this.player
    if (!player) return
    if (player.playing) player.pause()
    else {
      if (player.finished) this.epoch += 1
      player.play()
    }
    this.publish(this.input(0))
  }

  seekReplay(time: number): void {
    if (!this.player) return
    this.player.seek(time)
    this.epoch += 1
    this.publish(this.input(0))
  }

  setReplaySpeed(speed: ReplaySpeed): void {
    this.player?.setSpeed(speed)
    this.publish(this.input(0))
  }

  step(elapsed: number): void {
    const input = this.input(elapsed)
    const hidden = typeof document !== 'undefined' && document.hidden
    let events: CombatEvent[]
    if (this.player) {
      if (hidden) this.player.pause()
      this.player.step(elapsed)
      events = this.player.drainEvents()
    } else {
      if (hidden) this.engine.pause('hidden')
      this.engine.step(input, elapsed)
      events = this.engine.drainEvents()
      this.record(elapsed, events)
    }
    const snapshot = this.snapshot
    const previous = useMatchStore.getState()
    if (input.now >= this.nextPublication || previous.canFight !== input.ready
      || previous.snapshot.phase !== snapshot.phase || previous.snapshot.pauseReason !== snapshot.pauseReason
      || previous.opponentCue?.side !== this.opponentCue?.side || previous.opponentCue?.kind !== this.opponentCue?.kind
      || previous.snapshot.playerHealth !== snapshot.playerHealth || previous.snapshot.opponentHealth !== snapshot.opponentHealth
      || previous.snapshot.lastImpact?.id !== snapshot.lastImpact?.id || previous.snapshot.lastCombo?.id !== snapshot.lastCombo?.id) this.publish(input)
    this.dispatch(events)
  }

  private record(elapsed: number, events: readonly CombatEvent[]): void {
    this.recorder.capture(elapsed, this.engine.snapshot, this.engine.fighters, events)
    if (events.some(({ type }) => type === 'match-end')) {
      const { name, arena } = useProfileStore.getState()
      const result = createRecord(this.engine.snapshot, { id: this.matchId, playedAt: this.wallClock(), name: sanitizeName(name), arena })
      if (result) useCareerStore.getState().add(result)
    }
    if (this.recorder.complete) this.saveRecording()
  }

  private saveRecording(): void {
    const replay = this.recorder.finish()
    if (replay) useReplayStore.getState().add(replay)
  }

  private dispatch(events: readonly CombatEvent[]): void {
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
    const snapshot = this.snapshot
    useMatchStore.getState().publish({
      ...snapshot,
      playerStats: { ...snapshot.playerStats }, opponentStats: { ...snapshot.opponentStats },
      lastImpact: snapshot.lastImpact ? { ...snapshot.lastImpact } : null,
      lastCombo: snapshot.lastCombo ? { ...snapshot.lastCombo } : null,
    }, input.ready, this.opponentCue)
    const { player } = this
    if (player || useReplayStore.getState().playback) {
      useReplayStore.getState().setPlayback(player ? {
        meta: player.replay.meta, time: player.time, duration: player.replay.duration, playing: player.playing, speed: player.speed,
      } : null)
    }
    this.nextPublication = input.now + 125
  }

  private get opponentCue() {
    // The cue tells a player to react; a replay has nobody to warn.
    if (this.player) return null
    const { action, attackSide: side, attackKind: kind } = this.engine.fighters.opponent
    return this.engine.snapshot.phase === 'fighting' && !this.engine.snapshot.pauseReason
      && action === 'telegraph' && side && kind ? { side, kind } : null
  }
}

export const matchRuntime = new MatchRuntime()
