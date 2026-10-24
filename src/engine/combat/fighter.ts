import { Quaternion, Vector3 } from 'three'
import type { AttackSide, PunchClipSampler } from '../../types/animation'
import type { CombatInput, CombatRotations, FighterAction, FighterFrame, FighterId, FighterStats } from '../../types/combat'
import type { RigJointName, RigPose } from '../../types/robot'
import { createCombatGuardPose, createPunchClipSampler } from '../animation/combat-clips'
import { RIG_JOINTS } from '../motion/rig-controller'
import { createRestPose, sampleDemoPose } from '../motion/retarget'
import { CombatAI } from './ai'
import { CombatHitGeometry } from './collision'
import { COMBAT_RULES } from './config'

type MutableFrame = { -readonly [Key in keyof FighterFrame]: Key extends 'position' ? [number, number, number]
  : Key extends 'rotations' ? CombatRotations : FighterFrame[Key] }
type MutableStats = { -readonly [Key in keyof FighterStats]: FighterStats[Key] }

export interface FighterAttack {
  readonly side: AttackSide
  readonly shoulder: 'leftShoulder' | 'rightShoulder'
  readonly sampler: PunchClipSampler
  elapsed: number
  previousElapsed: number
  resolved: boolean
  dodged: boolean
}

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

function rotations(pose: RigPose): CombatRotations {
  return Object.fromEntries(RIG_JOINTS.map((name) => [name, new Quaternion(...pose[name])])) as CombatRotations
}

function frame(pose: RigPose, yaw: number): MutableFrame {
  return {
    position: [0, 0, 0], yaw, rotations: rotations(pose), action: 'idle',
    attackSide: null, attackProgress: 0, hitActive: false, hitFlash: 0, blocking: false,
  }
}

function usable(rotation: Quaternion): boolean {
  return Number.isFinite(rotation.x) && Number.isFinite(rotation.y) && Number.isFinite(rotation.z)
    && Number.isFinite(rotation.w) && rotation.lengthSq() > 1e-8
}

/** One reusable fighter pose, its authored attack and independent defensive state. */
export class CombatFighter {
  readonly frame: MutableFrame
  readonly stats: MutableStats = { attacks: 0, hits: 0, blocks: 0, dodges: 0, damage: 0 }
  readonly collisionFrame: MutableFrame
  readonly sweepFrom = new Vector3()
  readonly sweepTo = new Vector3()
  readonly guard = rotations(createCombatGuardPose())
  readonly victory = rotations(sampleDemoPose(8))
  readonly defeat = rotations(createRestPose())
  readonly saved = rotations(createCombatGuardPose())
  private readonly outcomeFrom = rotations(createCombatGuardPose())
  readonly mask = Object.fromEntries(RIG_JOINTS.map((name) => [name, 0])) as Record<RigJointName, number>
  brain: CombatAI
  health: number = COMBAT_RULES.health
  anchorZ = 0
  dodge = 0
  stun = 0
  attack: FighterAttack | null = null
  returning = 0
  action: FighterAction = 'idle'
  blocking = false
  telegraphSide: AttackSide | null = null
  private readonly scratch = new Quaternion()
  private readonly torsoCompensation = new Quaternion()
  private readonly yawSign: 1 | -1
  private lastLunge = 0
  private returnLunge = 0
  private base: Readonly<CombatRotations>
  private outcome: 'victory' | 'defeat' | null = null
  private outcomeElapsed = 0

  constructor(readonly id: FighterId, seed: number) {
    this.yawSign = id === 'player' ? 1 : -1
    this.frame = frame(createCombatGuardPose(), id === 'player' ? 0 : Math.PI)
    this.collisionFrame = frame(createCombatGuardPose(), this.frame.yaw)
    this.brain = new CombatAI(seed)
    this.base = this.guard
    this.defeat.torso.multiply(this.scratch.setFromAxisAngle(X_AXIS, 0.2))
    this.defeat.head.multiply(this.scratch.setFromAxisAngle(X_AXIS, 0.2))
    this.reset(seed, true)
  }

  reset(seed: number, clearStats: boolean): void {
    this.brain = new CombatAI(seed)
    this.health = COMBAT_RULES.health
    this.anchorZ = this.id === 'player' ? COMBAT_RULES.playerStartZ : COMBAT_RULES.opponentStartZ
    this.dodge = 0
    this.stun = 0
    this.attack = null
    this.returning = 0
    this.lastLunge = 0
    this.returnLunge = 0
    this.outcome = null
    this.outcomeElapsed = 0
    this.action = 'idle'
    this.blocking = false
    this.telegraphSide = null
    if (clearStats) for (const key of ['attacks', 'hits', 'blocks', 'dodges', 'damage'] as const) this.stats[key] = 0
    this.clearMask()
    this.frame.position[0] = 0
    this.frame.position[1] = 0
    this.frame.position[2] = this.anchorZ
    this.frame.hitFlash = 0
    this.frame.hitActive = false
    this.frame.attackSide = null
    this.frame.attackProgress = 0
    this.frame.action = 'idle'
    this.frame.blocking = false
    for (const name of RIG_JOINTS) this.frame.rotations[name].copy(this.guard[name])
  }

  get available(): boolean { return this.health > 0 && !this.attack && this.stun <= 0 && this.returning <= 0 }

  beginAttack(side: AttackSide): boolean {
    if (!this.available) return false
    this.attack = { side, shoulder: `${side}Shoulder`, sampler: createPunchClipSampler(side), elapsed: 0, previousElapsed: 0, resolved: false, dodged: false }
    this.blocking = false
    this.telegraphSide = null
    this.stats.attacks += 1
    this.clearMask()
    return true
  }

  advance(elapsed: number): void {
    this.stun = Math.max(0, this.stun - elapsed)
    this.advanceVisual(elapsed)
    if (this.attack) {
      this.attack.previousElapsed = this.attack.elapsed
      this.attack.elapsed = Math.min(this.attack.sampler.duration, this.attack.elapsed + elapsed)
      if (this.attack.elapsed >= this.attack.sampler.duration) {
        this.attack = null
        this.lastLunge = 0
        this.clearMask()
      }
    }
  }

  advanceVisual(elapsed: number): void {
    this.frame.hitFlash = Math.max(0, this.frame.hitFlash - elapsed / 0.25)
    this.returning = Math.max(0, this.returning - elapsed)
    if (this.outcome) this.outcomeElapsed = Math.min(COMBAT_RULES.outcomeSeconds, this.outcomeElapsed + elapsed)
  }

  cancel(): void {
    if (this.attack) {
      const sample = this.attack.sampler.sample(this.attack.elapsed)
      for (const name of RIG_JOINTS) {
        this.saved[name].fromArray(sample.pose[name])
        this.mask[name] = sample.weights[name] ?? 0
      }
      this.returning = COMBAT_RULES.returnSeconds
      this.returnLunge = this.lastLunge
      this.attack = null
    }
    this.frame.hitActive = false
    this.frame.attackSide = null
    this.frame.attackProgress = 0
    this.blocking = false
    this.telegraphSide = null
  }

  takeDamage(damage: number): number {
    const actual = Math.min(this.health, Math.max(0, damage))
    this.health -= actual
    this.frame.hitFlash = actual > 0 ? 1 : this.frame.hitFlash
    this.stun = actual > 0 ? COMBAT_RULES.stunSeconds : this.stun
    this.cancel()
    this.brain.react()
    return actual
  }

  setBase(input: CombatInput, webcam: boolean): void { this.base = webcam && this.id === 'player' ? input.playerBase : this.guard }

  compose(outcome: 'victory' | 'defeat' | null = null): void {
    const target = this.frame
    if (outcome && this.outcome !== outcome) {
      this.outcome = outcome
      this.outcomeElapsed = 0
      for (const name of RIG_JOINTS) this.outcomeFrom[name].copy(target.rotations[name])
    }
    this.composeAt(this.attack?.elapsed ?? 0, target)
    if (outcome) {
      const pose = outcome === 'victory' ? this.victory : this.defeat
      const progress = this.outcomeElapsed / COMBAT_RULES.outcomeSeconds
      const amount = progress * progress * (3 - 2 * progress)
      for (const name of RIG_JOINTS) target.rotations[name].slerpQuaternions(this.outcomeFrom[name], pose[name], amount)
    }
    target.action = outcome ?? (this.stun > 0 ? 'stunned' : this.attack ? 'attacking' : this.blocking ? 'guard' : this.action)
    target.attackSide = this.attack?.side ?? this.telegraphSide
    target.attackProgress = this.attack ? this.attack.elapsed / this.attack.sampler.duration : 0
    target.hitActive = this.attack !== null && !this.attack.resolved
      && this.attack.elapsed >= this.attack.sampler.hitWindow.start && this.attack.elapsed < this.attack.sampler.hitWindow.end
    target.blocking = !this.attack && this.stun <= 0 && this.blocking
  }

  fistAt(time: number, geometry: CombatHitGeometry, out: Vector3): Vector3 {
    this.composeAt(time, this.collisionFrame)
    return geometry.fist(this.collisionFrame, this.attack?.side ?? 'left', out)
  }

  private composeAt(time: number, target: MutableFrame): void {
    for (const name of RIG_JOINTS) {
      target.rotations[name].copy(usable(this.base[name]) ? this.base[name] : this.guard[name]).normalize()
    }
    let lunge = 0
    if (this.attack) {
      const sample = this.attack.sampler.sample(time)
      target.rotations.torso.slerp(this.scratch.fromArray(sample.pose.torso), sample.weights.torso ?? 0)
      this.torsoCompensation.copy(target.rotations.torso).invert().multiply(this.scratch.fromArray(sample.pose.torso))
      for (const name of RIG_JOINTS) {
        if (name === 'torso') continue
        const weight = sample.weights[name] ?? 0
        if (weight > 0) {
          this.scratch.fromArray(sample.pose[name])
          if (name === this.attack.shoulder) this.scratch.premultiply(this.torsoCompensation)
          target.rotations[name].slerp(this.scratch, weight)
        }
      }
      lunge = COMBAT_RULES.lungeDistance * (sample.weights[this.attack.shoulder] ?? 0)
    } else if (this.returning > 0) {
      const remaining = this.returning / COMBAT_RULES.returnSeconds
      const strength = remaining * remaining * (3 - 2 * remaining)
      target.rotations.torso.slerp(this.saved.torso, this.mask.torso * strength)
      this.torsoCompensation.copy(target.rotations.torso).invert().multiply(this.saved.torso)
      for (const name of RIG_JOINTS) {
        if (name === 'torso') continue
        const weight = this.mask[name] * strength
        if (weight > 0) {
          this.scratch.copy(this.saved[name])
          if (name.endsWith('Shoulder')) this.scratch.premultiply(this.torsoCompensation)
          target.rotations[name].slerp(this.scratch, weight)
        }
      }
      lunge = this.returnLunge * strength
    }
    if (this.stun > 0) {
      const recoil = Math.sin(Math.PI * (1 - this.stun / COMBAT_RULES.stunSeconds)) * 0.12
      target.rotations.torso.multiply(this.scratch.setFromAxisAngle(X_AXIS, -recoil))
    } else if (this.telegraphSide && !this.attack) {
      const side = this.telegraphSide === 'left' ? 1 : -1
      target.rotations[`${this.telegraphSide}Shoulder`].multiply(this.scratch.setFromAxisAngle(Y_AXIS, side * 0.16))
      target.rotations.torso.multiply(this.scratch.setFromAxisAngle(Z_AXIS, side * 0.025))
    }
    target.position[0] = this.dodge
    target.position[1] = 0
    target.position[2] = this.anchorZ + this.yawSign * lunge
    if (target === this.frame) this.lastLunge = lunge
  }

  private clearMask(): void { for (const name of RIG_JOINTS) this.mask[name] = 0 }
}
