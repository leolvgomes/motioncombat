import { createRecord } from '../../engine/career/career'
import { circuitOpponent } from '../../engine/career/circuit'
import type { CircuitOutcome } from '../../engine/career/circuit'
import { CombatEngine } from '../../engine/combat/combat-engine'
import type { MatchSetup } from '../../engine/combat/combat-engine'
import { DIFFICULTY_RULES, OPPONENT_IDS, OPPONENTS, TRAINING_STYLE, applyDifficulty } from '../../engine/combat/opponents'
import type { Difficulty, OpponentId, RivalId } from '../../engine/combat/opponents'
import { GuidedTraining } from '../../engine/tutorial/tutorial'
import { RigController } from '../../engine/motion/rig-controller'
import { ReplayPlayer, ReplayRecorder } from '../../engine/replay/replay'
import type { Replay, ReplaySpeed } from '../../engine/replay/replay'
import { useCareerStore } from '../../stores/career-store'
import { useLabStore } from '../../stores/lab-store'
import { useMatchStore } from '../../stores/match-store'
import type { MatchKind } from '../../stores/match-store'
import { useProgressStore } from '../../stores/progress-store'
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

interface MatchPlan { readonly kind: MatchKind; readonly rival: RivalId; readonly difficulty: Difficulty; readonly setup: MatchSetup }

/** A different, reproducible seed for every match. */
function matchSeed(recordedAt: number, sequence: number): number {
  return (Math.floor(recordedAt) ^ Math.imul(sequence, 0x9e3779b1)) | 0
}

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
  private kind: MatchKind = 'quick'
  /** The match that was started last; null before the first one and after a reset. */
  private plan: MatchPlan | null = null
  private training: GuidedTraining | null = null
  private circuitOutcome: CircuitOutcome | null = null
  private trainingKey = ''
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

  /** Chooses what the next webcam match is. Ignored while a match runs or a start is armed. */
  select(kind: MatchKind): void {
    const { phase } = this.engine.snapshot
    if (this.armed || this.player || phase !== 'ready' && phase !== 'finished') return
    this.kind = kind
    this.publish(this.input(0))
  }

  start(mode: MatchMode): boolean {
    this.armed = false
    this.guardSince = null
    const input = this.input(0)
    // A rejected live start must not change the source or discard calibration.
    if (this.player || mode === 'webcam' && !input.ready) { this.publish(input); return false }
    this.saveRecording()
    const recordedAt = this.wallClock()
    const sequence = this.matchSequence + 1
    const plan = this.planMatch(mode, matchSeed(recordedAt, sequence))
    const started = this.engine.start(mode, input, plan.setup)
    if (started) {
      if (mode === 'demo') useRobotStore.getState().setMode('demo')
      const { name, look, arena, advancedAttacks } = useProfileStore.getState()
      this.matchSequence = sequence
      this.matchId = `${recordedAt.toString(36)}-${sequence.toString(36)}`
      this.plan = plan
      this.circuitOutcome = null
      this.training = plan.kind === 'training' ? new GuidedTraining(advancedAttacks) : null
      this.trainingKey = ''
      // Training is practice, never a replay or a career entry.
      if (plan.rival === 'sparring') this.recorder.discard()
      else this.recorder.begin({ id: this.matchId, recordedAt, mode, name: sanitizeName(name), look, arena, opponent: plan.rival, difficulty: plan.difficulty })
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
    this.plan = null
    this.training = null
    this.circuitOutcome = null
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
      this.coach(input, elapsed, events)
      this.record(elapsed, events)
    }
    const snapshot = this.snapshot
    const previous = useMatchStore.getState()
    if (input.now >= this.nextPublication || previous.canFight !== input.ready
      || previous.snapshot.phase !== snapshot.phase || previous.snapshot.pauseReason !== snapshot.pauseReason
      || previous.opponentCue?.side !== this.opponentCue?.side || previous.opponentCue?.kind !== this.opponentCue?.kind
      || previous.snapshot.playerHealth !== snapshot.playerHealth || previous.snapshot.opponentHealth !== snapshot.opponentHealth
      || (previous.autoResume === null) !== (this.guardSince === null) || previous.armed !== this.armed || previous.canArm !== this.armable()
      || previous.snapshot.lastImpact?.id !== snapshot.lastImpact?.id || previous.snapshot.lastCombo?.id !== snapshot.lastCombo?.id
      || this.trainingChanged()) this.publish(input)
    this.dispatch(events)
  }

  /** What the next match is, from the current selection and saved progress. Demonstrations pick their own. */
  private planMatch(mode: MatchMode, seed: number): MatchPlan {
    if (mode === 'demo') {
      // Every demonstration is a different fight: another seed, another opponent and another style for the left robot.
      const rival = OPPONENT_IDS[(seed >>> 3) % OPPONENT_IDS.length]!
      const style = OPPONENT_IDS[(seed >>> 7) % OPPONENT_IDS.length]!
      return { kind: 'quick', rival, difficulty: 'normal', setup: { seed, opponentStyle: OPPONENTS[rival].ai, playerStyle: OPPONENTS[style].ai } }
    }
    if (this.kind === 'training') return { kind: 'training', rival: 'sparring', difficulty: 'normal', setup: { seed, training: true, opponentStyle: TRAINING_STYLE } }
    const profile = useProfileStore.getState()
    let rival: OpponentId = profile.opponent
    let difficulty = profile.difficulty
    if (this.kind === 'circuit') {
      if (!useProgressStore.getState().circuit.run) useProgressStore.getState().startCircuit(profile.difficulty, this.wallClock())
      const run = useProgressStore.getState().circuit.run!
      rival = circuitOpponent(run)
      difficulty = run.difficulty
    }
    return {
      kind: this.kind, rival, difficulty,
      setup: { seed, opponentStyle: applyDifficulty(OPPONENTS[rival].ai, difficulty), opponentDamage: DIFFICULTY_RULES[difficulty].damage },
    }
  }

  /** The robot in the opposite corner, as the arena and the HUD should show it. */
  private rival(): RivalId {
    if (this.player) return this.player.replay.meta.opponent
    if (this.plan && this.engine.snapshot.phase !== 'ready') return this.plan.rival
    if (this.kind === 'training') return 'sparring'
    if (this.kind === 'circuit') {
      const { run } = useProgressStore.getState().circuit
      return run ? circuitOpponent(run) : 'kestrel'
    }
    return useProfileStore.getState().opponent
  }

  private difficulty(): Difficulty {
    if (this.player) return this.player.replay.meta.difficulty
    if (this.plan && this.engine.snapshot.phase !== 'ready') return this.plan.difficulty
    if (this.kind === 'circuit') return useProgressStore.getState().circuit.run?.difficulty ?? useProfileStore.getState().difficulty
    return useProfileStore.getState().difficulty
  }

  /** Feeds the guided training with the real events of the session and lets it drive the training robot. */
  private coach(input: CombatInput, elapsed: number, events: readonly CombatEvent[]): void {
    const training = this.training
    if (!training || !this.engine.training) return
    for (const event of events) training.observe(event)
    const { phase, pauseReason } = this.engine.snapshot
    if (phase !== 'fighting' || pauseReason) return
    const wasFinished = training.finished
    training.step(elapsed, input.posture === 'guard')
    const drill = training.wantsAttack
    if (drill && this.engine.requestAttack(drill.kind, drill.side)) training.drillStarted()
    if (training.wantsOverdrive && this.engine.snapshot.playerOverdrive < 100) this.engine.fillOverdrive()
    if (!wasFinished && training.finished) useProgressStore.getState().completeTutorial()
  }

  /** Skips the current guided-training step. */
  skipTrainingStep(): void {
    if (!this.training || !this.engine.training) return
    const wasFinished = this.training.finished
    this.training.skip()
    if (!wasFinished && this.training.finished) useProgressStore.getState().completeTutorial()
    this.publish(this.input(0))
  }

  private trainingChanged(): boolean {
    const view = this.training?.view
    const key = view ? `${view.index}:${view.count}:${view.completed}:${view.finished}:${view.note}` : ''
    if (key === this.trainingKey) return false
    this.trainingKey = key
    return true
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
    const plan = this.plan
    if (plan && plan.rival !== 'sparring' && events.some(({ type }) => type === 'match-end')) {
      const { name, arena } = useProfileStore.getState()
      const snapshot = this.engine.snapshot
      const result = createRecord(snapshot, { id: this.matchId, playedAt: this.wallClock(), name: sanitizeName(name), arena, rival: plan.rival, difficulty: plan.difficulty })
      if (result) useCareerStore.getState().add(result)
      if (plan.kind === 'circuit' && snapshot.mode === 'webcam' && snapshot.winner) this.circuitOutcome = useProgressStore.getState().recordCircuit(snapshot.winner)
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
    }, {
      canFight: input.ready, opponentCue: this.opponentCue, autoResume: this.autoResumeProgress, armed: this.armed, canArm: this.armable(),
      kind: this.kind, rival: this.rival(), difficulty: this.difficulty(),
      training: this.player || !this.engine.training ? null : this.training?.view ?? null, circuitOutcome: this.player ? null : this.circuitOutcome,
    })
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
