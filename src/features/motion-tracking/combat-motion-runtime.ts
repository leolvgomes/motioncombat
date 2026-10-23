import { MotionCalibrator } from '../../engine/motion/calibration'
import { MotionFeatureExtractor } from '../../engine/motion/motion-features'
import { GestureEngine } from '../../engine/gestures/gesture-engine'
import type { GestureEvent } from '../../engine/gestures/gesture-engine'
import type { ProcessedPose } from '../../types/motion'
import type { MotionFeatures } from '../../types/combat-motion'
import { emptyCombatMotionSnapshot, useCombatMotionStore } from '../../stores/combat-motion-store'
import type { CombatMotionSnapshot } from '../../stores/combat-motion-store'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'

/** Consumes real capture samples; UI snapshots are published by the 250 ms diagnostic schedule. */
class CombatMotionRuntime {
  private readonly calibrator = new MotionCalibrator()
  private readonly extractor = new MotionFeatureExtractor()
  private readonly gestures = new GestureEngine()
  private features: MotionFeatures | null = null
  private posture: CombatMotionSnapshot['posture'] = 'neutral'
  private lastEvent: GestureEvent | null = null
  private events: GestureEvent[] = []

  startCalibration(): void {
    if (!this.isLive()) return
    this.reset()
    this.calibrator.start()
    this.publish()
  }

  cancelCalibration(): void {
    this.reset()
  }

  reset(): void {
    this.calibrator.reset()
    this.extractor.reset()
    this.gestures.reset()
    this.features = null
    this.posture = 'neutral'
    this.lastEvent = null
    this.events = []
    useCombatMotionStore.getState().publish(emptyCombatMotionSnapshot())
  }

  process(pose: ProcessedPose | null): void {
    if (!this.isLive()) { this.reset(); return }
    const calibration = this.calibrator.update(pose)
    const calibrating = calibration.stage === 'neutral' || calibration.stage === 'guard'
    if (!pose || !calibration.profile || calibrating) {
      this.features = null
      this.posture = 'neutral'
      this.extractor.reset()
      this.gestures.reset()
      return
    }
    this.features = this.extractor.update(pose, calibration.profile)
    const recognized = this.gestures.update(this.features, { enabled: true, calibrating: false, profile: calibration.profile })
    this.posture = recognized.posture
    if (recognized.event) {
      this.lastEvent = recognized.event
      this.events = [recognized.event, ...this.events].slice(0, 6)
      // Recognition is an infrequent semantic event, not a frame-by-frame React update.
      this.publish()
    }
  }

  publish(): void {
    if (!this.isLive()) return
    useCombatMotionStore.getState().publish({
      calibration: this.calibrator.snapshot,
      features: this.features,
      posture: this.posture,
      lastEvent: this.lastEvent,
      events: this.events,
    })
  }

  private isLive(): boolean {
    return useLabStore.getState().session.status === 'running' && useRobotStore.getState().mode === 'tracking'
  }
}

export const combatMotionRuntime = new CombatMotionRuntime()
