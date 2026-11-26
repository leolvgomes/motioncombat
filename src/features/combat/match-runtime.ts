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

/** How long the player must hold the guard, in view, to start an armed match or end a tracking pause hands-free. */
export const AUTO_RESUME_MS = 1500

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
  private guardSince: number | null = null
  private armed = false
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
  /** A webcam start was requested from the keyboard/mouse and waits for the player's guard in position. */
  get armedStart(): boolean { return this.armed }
  /** 0–1 while the player's guard is starting an armed match or releasing a tracking pause; null otherwise. */
  get autoResumeProgress(): number | null {
    return this.guardSince === null ? null : Math.min(1, Math.max(0, (this.clock() - this.guardSince) / AUTO_RESUME_MS))
  }

  /** Presentation listeners (sound, effects, announcements) receive events synchronously after each step. */
  subscribe(listener: (event: CombatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(mode: MatchMode): boolean {
    this.armed = false
    this.guardSince = null
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

  /**
   * Lets the player click start at the computer and walk to the fighting spot: the match
   * starts (with its normal countdown) once a valid pose holds the guard for AUTO_RESUME_MS.
   */
  arm(): boolean {
    const { phase } = this.engine.snapshot
    if (this.player || phase !== 'ready' && phase !== 'finished' || !this.armable()) { this.publish(this.input(0)); return false }
    this.armed = true
    this.guardSince = null
    this.publish(this.input(0))
    return true
  }

  disarm(): void {
    if (!this.armed) return
    this.armed = false
    this.guardSince = null
    this.publish(this.input(0))
  }

  pause(): void { this.engine.pause('manual'); this.publish(this.input(0)) }

  resume(): boolean {
    const input = this.input(0)
    const resumed = this.engine.resume(input)
    this.publish(input)
    return resumed
  }

  reset(): void {
    this.armed = false
    this.guardSince = null
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
    this.armed = false
    this.guardSince = null
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
      if (this.armed && this.armedStartReady(input)) { this.start('webcam'); return }
      if (hidden) this.engine.pause('hidden')
      this.engine.step(input, elapsed)
      this.autoResume(input)
      events = this.engine.drainEvents()
      this.record(elapsed, events)
    }
    const snapshot = this.snapshot
    const previous = useMatchStore.getState()
    if (input.now >= this.nextPublication || previous.canFight !== input.ready
      || previous.snapshot.phase !== snapshot.phase || previous.snapshot.pauseReason !== snapshot.pauseReason
      || previous.opponentCue?.side !== this.opponentCue?.side || previous.opponentCue?.kind !== this.opponentCue?.kind
      || previous.snapshot.playerHealth !== snapshot.playerHealth || previous.snapshot.opponentHealth !== snapshot.opponentHealth
      || (previous.autoResume === null) !== (this.guardSince === null) || previous.armed !== this.armed || previous.canArm !== this.armable()
      || previous.snapshot.lastImpact?.id !== snapshot.lastImpact?.id || previous.snapshot.lastCombo?.id !== snapshot.lastCombo?.id) this.publish(input)
    this.dispatch(events)
  }

  /**
   * Losing the player pauses the match for safety. Coming back does not need the mouse:
   * a valid, calibrated pose holding the guard for AUTO_RESUME_MS resumes it. Manual,
   * hidden-page and off-screen pauses still wait for an explicit command.
   */
  /** Camera running and calibrated: enough to arm a start, even before the player is framed. */
  private armable(): boolean {
    return useLabStore.getState().session.status === 'running' && useRobotStore.getState().mode === 'tracking'
      && combatMotionRuntime.calibrated
  }

  private sceneVisible(): boolean {
    const sceneFps = useMatchStore.getState().sceneFps
    return sceneFps !== null && Number.isFinite(sceneFps) && sceneFps > 0
  }

  private armedStartReady(input: CombatInput): boolean {
    const { phase } = this.engine.snapshot
    if (!this.armable() || phase !== 'ready' && phase !== 'finished') { this.armed = false; this.guardSince = null; return false }
    if (!input.ready || input.posture !== 'guard' || !this.sceneVisible()) { this.guardSince = null; return false }
    this.guardSince ??= input.now
    return input.now - this.guardSince >= AUTO_RESUME_MS
  }

  private autoResume(input: CombatInput): void {
    if (this.armed) return
    const { pauseReason, mode } = this.engine.snapshot
    const waiting = pauseReason === 'tracking' && mode === 'webcam' && input.ready && input.posture === 'guard' && this.sceneVisible()
    if (!waiting) { this.guardSince = null; return }
    this.guardSince ??= input.now
    if (input.now - this.guardSince >= AUTO_RESUME_MS && this.engine.resume(input)) this.guardSince = null
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
    }, input.ready, this.opponentCue, this.autoResumeProgress, this.armed, this.armable())
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
