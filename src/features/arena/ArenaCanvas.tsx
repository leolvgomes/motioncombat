import { Component, memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DodecahedronGeometry, DoubleSide, GridHelper, Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, RingGeometry, Vector2, Vector3 } from 'three'
import type { BufferGeometry, InstancedMesh, Material, Mesh, PointLight } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { KnockoutCinematic, SmokePuffs, SpecialFlash, damageLevel, fallAmount, lightFlicker, smokeRate } from '../../engine/effects/cinematic-effects'
import { CameraShake, ImpactParticles, ImpactPulses, impactFeedback } from '../../engine/effects/impact-effects'
import { RIG_JOINTS } from '../../engine/motion/rig-controller'
import { useProfileStore } from '../../stores/profile-store'
import { useReplayStore } from '../../stores/replay-store'
import { useRobotStore } from '../../stores/robot-store'
import { useSettingsStore } from '../../stores/settings-store'
import type { FighterFrame, FighterId } from '../../types/combat'
import type { ArenaId } from '../../types/customization'
import { matchRuntime } from '../combat/match-runtime'
import { FrameLimiter } from '../robot/FrameLimiter'
import { RobotModel } from '../robot/RobotModel'
import type { RobotRig } from '../robot/RobotModel'
import { ARENA_THEMES } from './arena-themes'
import type { ArenaTheme } from './arena-themes'
import { ARENA_CAMERA_FOV, ARENA_CAMERA_TARGET, getArenaCameraPosition } from './arena-camera'

const TEAM_COLOR = { player: new Color('#5acbd5'), opponent: new Color('#ef995d') }
const IMPACT_COLOR = new Color('#fff0c5')
const FIGHTER_IDS = ['player', 'opponent'] as const
const SPARK_CAPACITY = 64
const PULSE_CAPACITY = 4
const SMOKE_CAPACITY = 48
/** A knocked-out robot ends almost flat on its back. */
const FALL_ANGLE = 1.42
const SMOKE_DARK = new Color('#1c1f22')
const SMOKE_LIGHT = new Color('#6b7075')
const SPARK_COLORS = {
  hit: [new Color('#ff5a1f'), new Color('#ffe2a0')],
  blocked: [new Color('#2a8fc4'), new Color('#bff7ff')],
} as const

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Presentation-only state for one canvas. It reads combat events but never feeds back into the simulation. */
function createArenaFeedback() {
  const particles = new ImpactParticles(SPARK_CAPACITY)
  const pulses = new ImpactPulses(PULSE_CAPACITY)
  const shake = new CameraShake()
  const smoke = new SmokePuffs(SMOKE_CAPACITY)
  const knockout = new KnockoutCinematic()
  const flash = new SpecialFlash()
  const flashPoint = new Vector3()
  return {
    particles, pulses, shake, smoke, knockout, flash, flashPoint,
    /** Clock multiplier for this frame; below 1 during the knockout slow motion. */
    timeScale: 1,
    clear() { particles.clear(); pulses.clear(); shake.clear(); smoke.clear(); knockout.clear(); flash.clear(); this.timeScale = 1 },
  }
}

type ArenaFeedback = ReturnType<typeof createArenaFeedback>

function createArenaResources({ colors }: ArenaTheme) {
  const geometries = {
    box: new BoxGeometry(1, 1, 1),
    deck: new CylinderGeometry(1, 1, 1, 8),
    column: new CylinderGeometry(1, 1, 1, 12),
    rim: new RingGeometry(0.96, 1, 8),
    centerRing: new RingGeometry(1, 1.012, 64),
    marker: new RingGeometry(0.54, 0.57, 48),
    spark: new OctahedronGeometry(1, 0),
    smoke: new DodecahedronGeometry(1, 1),
    pulse: new RingGeometry(0.72, 1, 40),
    rock: new DodecahedronGeometry(1, 0),
  }
  const materials = {
    deck: new MeshStandardMaterial({ color: colors.deck, metalness: 0.6, roughness: 0.56 }),
    foundation: new MeshStandardMaterial({ color: colors.foundation, metalness: 0.72, roughness: 0.43 }),
    steel: new MeshStandardMaterial({ color: colors.steel, metalness: 0.82, roughness: 0.34 }),
    wall: new MeshStandardMaterial({ color: colors.wall, metalness: 0.5, roughness: 0.66 }),
    ground: new MeshStandardMaterial({ color: colors.ground, metalness: 0.2, roughness: 0.82 }),
    marking: new MeshBasicMaterial({ color: colors.marking }),
    rock: new MeshStandardMaterial({ color: colors.rock, metalness: 0.05, roughness: 0.94, flatShading: true }),
    crateA: new MeshStandardMaterial({ color: colors.crateA, metalness: 0.45, roughness: 0.6 }),
    crateB: new MeshStandardMaterial({ color: colors.crateB, metalness: 0.45, roughness: 0.6 }),
    window: new MeshBasicMaterial({ color: colors.window, toneMapped: false, fog: false }),
    cyan: new MeshBasicMaterial({ color: '#49bdc9', toneMapped: false }),
    orange: new MeshBasicMaterial({ color: '#ce793f', toneMapped: false }),
    playerMarker: new MeshBasicMaterial({ color: TEAM_COLOR.player, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }),
    opponentMarker: new MeshBasicMaterial({ color: TEAM_COLOR.opponent, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }),
    spark: new MeshBasicMaterial({ toneMapped: false }),
    smoke: new MeshStandardMaterial({ transparent: true, opacity: 0.42, depthWrite: false, roughness: 1, metalness: 0 }),
  }
  const pulseMaterials = Array.from({ length: PULSE_CAPACITY }, () => new MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false,
  }))
  const grid = new GridHelper(24, 24, colors.gridCenter, colors.grid)
  grid.position.set(0, -0.421, 0.6)
  let disposed = false
  return {
    geometries, materials, pulseMaterials, grid,
    dispose() {
      if (disposed) return
      disposed = true
      for (const geometry of Object.values(geometries)) geometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
      for (const material of pulseMaterials) material.dispose()
      grid.geometry.dispose()
      if (Array.isArray(grid.material)) for (const material of grid.material) material.dispose()
      else grid.material.dispose()
    },
  }
}

type ArenaResources = ReturnType<typeof createArenaResources>
type Triple = [number, number, number]

function useArenaDisposal(resources: ArenaResources) {
  const pending = useRef(new Map<ArenaResources, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const disposals = pending.current
    const timer = disposals.get(resources)
    if (timer !== undefined) { clearTimeout(timer); disposals.delete(resources) }
    return () => {
      disposals.set(resources, setTimeout(() => { resources.dispose(); disposals.delete(resources) }, 0))
    }
  }, [resources])
}

function StagePart({ geometry, material, position, scale, rotation, shadow = false }: {
  geometry: BufferGeometry; material: Material; position: Triple; scale: Triple; rotation?: Triple; shadow?: boolean
}) {
  return <mesh geometry={geometry} material={material} position={position} scale={scale} rotation={rotation} receiveShadow={shadow} />
}

function applyFighter(model: RobotRig, frame: FighterFrame, marker: Mesh, material: MeshBasicMaterial, id: FighterId, swing: number, reduced: boolean, fall: number) {
  model.root.position.fromArray(frame.position)
  // Euler XYZ applies X last, about the world axis: each robot falls backward, away from its opponent.
  model.root.rotation.set((id === 'player' ? -1 : 1) * fall * FALL_ANGLE, frame.yaw, 0)
  for (const name of RIG_JOINTS) model[name].quaternion.copy(frame.rotations[name])
  model.leftHip.rotation.set(-0.025 + swing, 0, 0.025)
  model.rightHip.rotation.set(0.025 - swing, 0, -0.025)
  model.leftKnee.rotation.set(0.055 + Math.max(0, -swing) * 0.7, 0, 0)
  model.rightKnee.rotation.set(0.055 + Math.max(0, swing) * 0.7, 0, 0)
  marker.position.set(frame.position[0], -0.008, frame.position[2])
  const flash = Number.isFinite(frame.hitFlash) ? Math.max(0, Math.min(1, frame.hitFlash)) : 0
  material.color.copy(TEAM_COLOR[id]).lerp(IMPACT_COLOR, flash)
  material.opacity = 0.25 + flash * 0.65
  marker.scale.setScalar(reduced ? 1 : 1 + flash * 0.12)
}

const emitPoint = new Vector3()

function ArenaFighters({ resources, feedback }: { resources: ArenaResources; feedback: ArenaFeedback }) {
  const look = useProfileStore((state) => state.look)
  const replayLook = useReplayStore((state) => state.playback?.meta.look)
  const player = useRef<RobotRig | null>(null)
  const opponent = useRef<RobotRig | null>(null)
  const playerMarker = useRef<Mesh>(null)
  const opponentMarker = useRef<Mesh>(null)
  const reducedMotion = useRef(false)
  const timer = useRef({ elapsed: 0, frames: 0, primed: false })
  const legs = useRef({ player: { phase: 0, swing: 0 }, opponent: { phase: Math.PI, swing: 0 } })
  const wear = useRef({
    player: { knockedOut: 0, glow: 0, crackle: 0 }, opponent: { knockedOut: 0, glow: 0, crackle: 0 }, clock: 0,
  })
  const rigs = { player, opponent }
  const markers = { player: playerMarker, opponent: opponentMarker }

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { reducedMotion.current = preference.matches }
    const resetTiming = () => { timer.current = { elapsed: 0, frames: 0, primed: false } }
    update()
    preference.addEventListener('change', update)
    document.addEventListener('visibilitychange', resetTiming)
    return () => {
      preference.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', resetTiming)
    }
  }, [])

  useFrame((_state, elapsed) => {
    if (!player.current || !opponent.current || !playerMarker.current || !opponentMarker.current || document.visibilityState === 'hidden') return
    const real = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.1))
    const settings = useSettingsStore.getState()
    feedback.knockout.step(real)
    // The slowed clock drives the match too, but only once the round is decided, so it never changes a result.
    feedback.timeScale = settings.cinematicEnabled && !reducedMotion.current ? feedback.knockout.timeScale : 1
    const dt = real * feedback.timeScale
    matchRuntime.step(dt)
    const frames = matchRuntime.fighters
    const snapshot = matchRuntime.snapshot
    const advancing = snapshot.phase === 'fighting' && snapshot.pauseReason === null
    const decided = snapshot.phase === 'round-over' || snapshot.phase === 'finished'
    const frozen = snapshot.pauseReason !== null
    if (!frozen) wear.current.clock += dt
    for (const id of FIGHTER_IDS) {
      const model = rigs[id].current
      const marker = markers[id].current
      if (!model || !marker) continue
      const frame = frames[id]
      const leg = legs.current[id]
      if (reducedMotion.current) leg.swing = 0
      else if (advancing) {
        const moving = frame.action === 'approaching' || frame.action === 'retreating'
        if (moving) leg.phase += dt * 8
        const target = moving ? Math.sin(leg.phase) * 0.1 : 0
        leg.swing += (target - leg.swing) * -Math.expm1(-dt * 12)
      }
      const health = id === 'player' ? snapshot.playerHealth : snapshot.opponentHealth
      const state = wear.current[id]
      state.knockedOut = decided && health <= 0 ? state.knockedOut + (frozen ? 0 : dt) : 0
      const fall = state.knockedOut > 0 ? reducedMotion.current ? 1 : fallAmount(state.knockedOut) : 0
      applyFighter(model, frame, marker, resources.materials[id === 'player' ? 'playerMarker' : 'opponentMarker'], id, leg.swing, reducedMotion.current, fall)
      const level = damageLevel(health)
      // The special's glow rises fast while it is thrown and fades after it.
      const glowTarget = frame.special && frame.action === 'attacking' ? 1 : 0
      state.glow += (glowTarget - state.glow) * -Math.expm1(-real * (glowTarget > state.glow ? 18 : 5))
      model.condition(level, reducedMotion.current ? 1 : lightFlicker(level, wear.current.clock), state.glow)
      if (!settings.effectsEnabled || frozen || snapshot.phase === 'ready') continue
      model.head.getWorldPosition(emitPoint)
      feedback.smoke.emit(id, smokeRate(level), dt, emitPoint.x, emitPoint.y - 0.18, emitPoint.z)
      if (level >= 0.7 && health > 0) {
        state.crackle -= dt
        if (state.crackle <= 0) {
          state.crackle = 0.45 + (1 - level) * 2.4 + (Math.sin(wear.current.clock * 13.7 + (id === 'player' ? 0 : 2)) + 1) * 0.35
          model.leftShoulder.getWorldPosition(emitPoint)
          feedback.particles.burst('hit', emitPoint.x, emitPoint.y, emitPoint.z, id === 'player' ? -1 : 1, 0.22)
        }
      }
    }
    if (!timer.current.primed) { timer.current.primed = true; return }
    timer.current.elapsed += elapsed
    timer.current.frames += 1
    if (timer.current.elapsed >= 0.5) {
      matchRuntime.setSceneFps(timer.current.frames / timer.current.elapsed)
      timer.current.elapsed = 0
      timer.current.frames = 0
    }
  })

  return <>
    <RobotModel rigRef={player} look={replayLook ?? look} />
    <RobotModel rigRef={opponent} variant="opponent" />
    <mesh ref={playerMarker} geometry={resources.geometries.marker} material={resources.materials.playerMarker} rotation={[-Math.PI / 2, 0, 0]} />
    <mesh ref={opponentMarker} geometry={resources.geometries.marker} material={resources.materials.opponentMarker} rotation={[-Math.PI / 2, 0, 0]} />
  </>
}

const sparkMatrix = new Matrix4()
const sparkColor = new Color()

function ArenaEffects({ resources, feedback }: { resources: ArenaResources; feedback: ArenaFeedback }) {
  const sparks = useRef<InstancedMesh>(null)
  const smoke = useRef<InstancedMesh>(null)
  const flashLight = useRef<PointLight>(null)
  const pulses = useRef<(Mesh | null)[]>([])
  const epoch = useRef(matchRuntime.sceneEpoch)

  useEffect(() => {
    const mesh = sparks.current
    if (!mesh) return
    // Allocates the per-instance colour buffer once; only `count` instances are drawn.
    for (let index = 0; index < SPARK_CAPACITY; index++) mesh.setColorAt(index, sparkColor.set(0, 0, 0))
    mesh.count = 0
    const puffs = smoke.current
    if (!puffs) return
    for (let index = 0; index < SMOKE_CAPACITY; index++) puffs.setColorAt(index, sparkColor.set(0, 0, 0))
    puffs.count = 0
  }, [])

  useEffect(() => matchRuntime.subscribe((event) => {
    if (event.type !== 'impact') return
    const settings = useSettingsStore.getState()
    const reduced = prefersReducedMotion()
    const response = impactFeedback(event, matchRuntime.snapshot.mode)
    const [x, y, z] = event.position
    if (settings.effectsEnabled && response.burst) {
      feedback.particles.burst(response.burst, x, y, z, response.direction, response.amount * (reduced ? 0.5 : 1))
      feedback.pulses.spawn(response.burst, x, y, z)
      if (event.impact.special) { feedback.flash.trigger(); feedback.flashPoint.set(x, y, z) }
    }
    if (settings.shakeEnabled && !reduced) feedback.shake.add(response.shake)
    const landed = event.impact.result === 'hit' || event.impact.result === 'blocked'
    if (landed && event.defenderHealth <= 0 && settings.cinematicEnabled && !reduced) {
      const [fx, , fz] = matchRuntime.fighters[event.impact.attacker === 'player' ? 'opponent' : 'player'].position
      feedback.knockout.trigger(fx, 1.1, fz)
    }
  }), [feedback])

  useFrame(({ camera }, elapsed) => {
    const snapshot = matchRuntime.snapshot
    if (snapshot.phase === 'ready' || epoch.current !== matchRuntime.sceneEpoch) feedback.clear()
    epoch.current = matchRuntime.sceneEpoch
    // Paused matches freeze their sparks with the rest of the scene.
    const dt = snapshot.pauseReason === null ? Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.1)) * feedback.timeScale : 0
    const { particles } = feedback
    particles.step(dt)
    feedback.pulses.step(dt)
    feedback.smoke.step(dt)
    feedback.flash.step(dt)
    const light = flashLight.current
    if (light) {
      const strength = feedback.flash.strength
      light.visible = strength > 0
      light.intensity = strength * strength * 60
      light.position.copy(feedback.flashPoint)
    }
    const puffs = smoke.current
    if (puffs) {
      const { smoke: pool } = feedback
      for (let index = 0; index < pool.count; index++) {
        const age = pool.age(index)
        // Grows as it rises, thinning out (shrinking) at the end of its life.
        const size = 0.07 + age * 0.22 * (age > 0.75 ? (1 - age) / 0.25 : 1)
        sparkMatrix.makeScale(size, size, size)
        sparkMatrix.setPosition(pool.position[index * 3], pool.position[index * 3 + 1], pool.position[index * 3 + 2])
        puffs.setMatrixAt(index, sparkMatrix)
        puffs.setColorAt(index, sparkColor.copy(SMOKE_DARK).lerp(SMOKE_LIGHT, age))
      }
      puffs.count = pool.count
      puffs.instanceMatrix.needsUpdate = true
      if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true
    }
    const mesh = sparks.current
    if (mesh) {
      for (let index = 0; index < particles.count; index++) {
        const fade = particles.fade(index)
        const size = (particles.kind[index] === 0 ? 0.034 : 0.026) * (0.35 + fade * 0.65)
        sparkMatrix.makeScale(size, size * 1.6, size)
        sparkMatrix.setPosition(particles.position[index * 3], particles.position[index * 3 + 1], particles.position[index * 3 + 2])
        mesh.setMatrixAt(index, sparkMatrix)
        const [end, start] = SPARK_COLORS[particles.kind[index] === 0 ? 'hit' : 'blocked']
        mesh.setColorAt(index, sparkColor.copy(end).lerp(start, fade))
      }
      mesh.count = particles.count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    feedback.pulses.pulses.forEach((pulse, index) => {
      const ring = pulses.current[index]
      if (!ring) return
      ring.visible = pulse.active
      if (!pulse.active) return
      const progress = feedback.pulses.progress(pulse)
      const blocked = pulse.kind === 'blocked'
      ring.position.set(pulse.x, pulse.y, pulse.z)
      ring.quaternion.copy(camera.quaternion)
      ring.scale.setScalar(blocked ? 0.2 + progress * 0.36 : 0.08 + progress * 0.3)
      const material = resources.pulseMaterials[index]
      material.color.copy(blocked ? SPARK_COLORS.blocked[1] : SPARK_COLORS.hit[1])
      material.opacity = (1 - progress) * (blocked ? 0.8 : 0.95)
    })
  })

  return <>
    <instancedMesh ref={sparks} args={[resources.geometries.spark, resources.materials.spark, SPARK_CAPACITY]} frustumCulled={false} />
    <instancedMesh ref={smoke} args={[resources.geometries.smoke, resources.materials.smoke, SMOKE_CAPACITY]} frustumCulled={false} renderOrder={1} />
    <pointLight ref={flashLight} color="#bff7ff" distance={4} decay={2} intensity={0} visible={false} />
    {resources.pulseMaterials.map((material, index) => <mesh key={index} ref={(mesh) => { pulses.current[index] = mesh }}
      geometry={resources.geometries.pulse} material={material} visible={false} renderOrder={2} />)}
  </>
}

function ArenaWorld({ light }: { light: boolean }) {
  const feedback = useMemo(createArenaFeedback, [])
  const chosen = useProfileStore((state) => state.arena)
  const arena = useReplayStore((state) => state.playback?.meta.arena) ?? chosen
  const bloom = useSettingsStore((state) => state.bloomEnabled)
  return <>
    <ArenaScene key={arena} light={light} feedback={feedback} arena={arena} />
    <ArenaCamera shake={feedback.shake} knockout={feedback.knockout} />
    {bloom && !light && <ArenaBloom />}
  </>
}

/**
 * Optional bloom: emissive lights, sparks and the special's flash glow. It takes over rendering
 * (priority 1), at the cost of extra full-screen passes, so it is off by default and never in Light quality.
 */
function ArenaBloom() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const composer = useMemo(() => {
    const result = new EffectComposer(gl)
    result.addPass(new RenderPass(scene, camera))
    result.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.6, 0.45, 0.82))
    result.addPass(new OutputPass())
    return result
  }, [gl, scene, camera])
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio())
    composer.setSize(width, height)
  }, [composer, gl, width, height])
  useEffect(() => () => composer.dispose(), [composer])
  useFrame((_state, delta) => composer.render(delta), 1)
  return null
}

/** Static scenery behind and beside the ring. It stays outside the fighters' reach and the camera's line of sight. */
function FoundryBackdrop({ resources: { geometries: g, materials: m } }: { resources: ArenaResources }) {
  return <>
    <StagePart geometry={g.box} material={m.wall} position={[3.45, 1.1, 0.6]} scale={[0.12, 3, 8.4]} />
    {[-2.5, -0.45, 1.65, 3.7].map((z) => <group key={z}>
      <StagePart geometry={g.box} material={m.foundation} position={[3.3, 1.1, z]} scale={[0.18, 3, 0.18]} />
      <StagePart geometry={g.box} material={m.cyan} position={[3.197, 2.05, z]} scale={[0.016, 0.4, 0.035]} />
    </group>)}
  </>
}

const CONTAINERS: readonly (readonly [x: number, y: number, z: number, material: 'crateA' | 'crateB' | 'wall'])[] = [
  [4.6, 0.12, -2.4, 'crateA'], [4.6, 0.12, 0.1, 'crateB'], [4.6, 0.12, 2.6, 'wall'],
  [4.75, 1.24, -1.5, 'crateB'], [4.6, 1.24, 2.2, 'crateA'], [4.9, 0.12, -5, 'wall'], [4.7, 2.36, 2.4, 'crateB'],
]
const TOWERS: readonly (readonly [x: number, z: number, height: number])[] = [
  [17, -9, 7], [19, -5.5, 10], [18, -2, 6], [20, 1.5, 12], [18, 4.5, 8], [19.5, 8, 5.5], [15, -12.5, 5],
]

function HarborBackdrop({ resources: { geometries: g, materials: m } }: { resources: ArenaResources }) {
  return <>
    {CONTAINERS.map(([x, y, z, material]) => <group key={`${x}-${y}-${z}`} position={[x, y, z]}>
      <StagePart geometry={g.box} material={m[material]} position={[0, 0, 0]} scale={[1.2, 1.08, 2.35]} />
      {[-0.85, -0.3, 0.3, 0.85].map((rib) => <StagePart key={rib} geometry={g.box} material={m.foundation} position={[-0.61, 0, rib]} scale={[0.03, 0.98, 0.07]} />)}
    </group>)}
    <group position={[6.6, 0, -1]}>
      <StagePart geometry={g.box} material={m.steel} position={[0, 2.6, -1.2]} scale={[0.22, 6.2, 0.22]} />
      <StagePart geometry={g.box} material={m.steel} position={[0, 2.6, 1.2]} scale={[0.22, 6.2, 0.22]} />
      <StagePart geometry={g.box} material={m.steel} position={[0, 5.6, 0.8]} scale={[0.26, 0.26, 7.4]} />
      <StagePart geometry={g.column} material={m.foundation} position={[0, 4.9, 3.6]} scale={[0.02, 1.3, 0.02]} />
      <StagePart geometry={g.box} material={m.orange} position={[-0.14, 5.6, 4.35]} scale={[0.02, 0.12, 0.12]} />
    </group>
    {TOWERS.map(([x, z, height]) => <group key={`${x}-${z}`} position={[x, height / 2 - 0.5, z]}>
      <StagePart geometry={g.box} material={m.wall} position={[0, 0, 0]} scale={[2, height, 2]} />
      {[0.12, 0.3, 0.42].map((level, index) => <StagePart key={level} geometry={g.box} material={m.window} position={[-1.01, height * (level - 0.05), index * 0.5 - 0.5]} scale={[0.02, 0.16, 0.5]} />)}
    </group>)}
    {[-3.4, 4.6].map((z) => <group key={z} position={[2.9, 0, z]}>
      <StagePart geometry={g.column} material={m.foundation} position={[0, 1.2, 0]} scale={[0.05, 3.2, 0.05]} />
      <StagePart geometry={g.box} material={m.window} position={[-0.16, 2.78, 0]} scale={[0.36, 0.05, 0.16]} />
    </group>)}
  </>
}

const ROCKS: readonly (readonly [x: number, y: number, z: number, width: number, height: number, depth: number, turn: number])[] = [
  [5.4, 0.1, -3.2, 1.5, 1.5, 1.7, 0.4], [6.2, 0.6, 0.4, 1.9, 2.5, 2, 1.1], [5.5, 0, 3.6, 1.4, 1.2, 1.6, 2.2],
  [8.8, 1.6, -5.5, 2.6, 4.2, 2.8, 0.8], [9.6, 2, 4.2, 2.9, 4.8, 3, 1.9], [12, 2.4, -0.6, 3.2, 5.6, 4, 0.2],
  [1.4, -0.1, -5.6, 0.9, 0.6, 1, 2.7], [4, 0, -6.2, 1.3, 1.1, 1.2, 1.4], [3.6, -0.15, 6, 0.8, 0.5, 0.9, 0.9],
]

function CanyonBackdrop({ resources: { geometries: g, materials: m } }: { resources: ArenaResources }) {
  return <>
    {ROCKS.map(([x, y, z, width, height, depth, turn]) => <StagePart key={`${x}-${z}`} geometry={g.rock} material={m.rock}
      position={[x, y, z]} scale={[width, height, depth]} rotation={[0.1, turn, 0.08]} />)}
    {[-2.6, 3.8].map((z) => <group key={z} position={[3, 0, z]}>
      <StagePart geometry={g.column} material={m.steel} position={[0, 1, 0]} scale={[0.05, 2.8, 0.05]} />
      <StagePart geometry={g.box} material={z < 0 ? m.crateA : m.crateB} position={[0, 1.75, 0.36]} scale={[0.03, 1, 0.62]} />
    </group>)}
  </>
}

const BACKDROPS: Readonly<Record<ArenaId, typeof FoundryBackdrop>> = { foundry: FoundryBackdrop, harbor: HarborBackdrop, canyon: CanyonBackdrop }

function ArenaScene({ light, feedback, arena }: { light: boolean; feedback: ArenaFeedback; arena: ArenaId }) {
  const theme = ARENA_THEMES[arena]
  const resources = useMemo(() => createArenaResources(theme), [theme])
  const Backdrop = BACKDROPS[arena]
  useArenaDisposal(resources)
  const { geometries: g, materials: m } = resources
  return <>
    <color attach="background" args={[theme.sky]} />
    <fog attach="fog" args={[theme.sky, theme.fog[0], theme.fog[1]]} />
    <ambientLight intensity={theme.ambient} />
    <hemisphereLight args={theme.hemisphere} />
    <directionalLight position={[-4, 7, 4]} color={theme.key.color} intensity={theme.key.intensity} castShadow={!light} shadow-mapSize={[1024, 1024]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5.5} shadow-camera-bottom={-2} shadow-camera-near={0.1} shadow-camera-far={20} shadow-bias={-0.0005} />
    <directionalLight position={[4, 4, -3]} color={theme.rim.color} intensity={theme.rim.intensity} />
    <directionalLight position={[-1, 4, 5]} color={theme.fill.color} intensity={theme.fill.intensity} />
    <group dispose={null}>
      <StagePart geometry={g.box} material={m.ground} position={[0, -0.44, 0.6]} scale={[40, 0.02, 40]} />
      <primitive object={resources.grid} />
      <StagePart geometry={g.deck} material={m.foundation} position={[0, -0.34, 0.6]} rotation={[0, Math.PI / 8, 0]} scale={[3.15, 0.13, 3.55]} />
      <StagePart geometry={g.deck} material={m.deck} position={[0, -0.16, 0.6]} rotation={[0, Math.PI / 8, 0]} scale={[3, 0.28, 3.4]} shadow />
      <StagePart geometry={g.rim} material={m.steel} position={[0, -0.014, 0.6]} rotation={[-Math.PI / 2, 0, Math.PI / 8]} scale={[3, 3.4, 1]} />
      <StagePart geometry={g.centerRing} material={m.marking} position={[0, -0.012, 0.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.45, 1.45, 1]} />
      <StagePart geometry={g.box} material={m.marking} position={[0, -0.011, 0.6]} scale={[2.2, 0.006, 0.012]} />
      {([-1, 1] as const).flatMap((side) => ([-1.5, 2.7] as const).map((z) => <group key={`${side}-${z}`} position={[side * 2, 0, z]}>
        <StagePart geometry={g.column} material={m.foundation} position={[0, 0.3, 0]} scale={[0.135, 0.64, 0.135]} />
        <StagePart geometry={g.column} material={m.steel} position={[0, 0.63, 0]} scale={[0.16, 0.065, 0.16]} />
        <StagePart geometry={g.column} material={z < 0 ? m.cyan : m.orange} position={[0, 0.67, 0]} scale={[0.12, 0.035, 0.12]} />
        <StagePart geometry={g.box} material={z < 0 ? m.cyan : m.orange} position={[-side * 0.132, 0.31, 0]} scale={[0.014, 0.32, 0.04]} />
      </group>))}
      <StagePart geometry={g.box} material={m.foundation} position={[-2.55, -0.06, 0.6]} scale={[0.08, 0.12, 3.25]} />
      <StagePart geometry={g.box} material={m.foundation} position={[2.55, -0.06, 0.6]} scale={[0.08, 0.12, 3.25]} />
      <StagePart geometry={g.box} material={m.cyan} position={[-2.596, -0.04, -0.34]} scale={[0.012, 0.027, 1.1]} />
      <StagePart geometry={g.box} material={m.orange} position={[-2.596, -0.04, 1.54]} scale={[0.012, 0.027, 1.1]} />
      <Backdrop resources={resources} />
      <ArenaFighters resources={resources} feedback={feedback} />
      <ArenaEffects resources={resources} feedback={feedback} />
    </group>
  </>
}

const focusTarget = new Vector3()
const lookTarget = new Vector3()
const closeTarget = new Vector3()

function ArenaCamera({ shake, knockout }: { shake: CameraShake; knockout: KnockoutCinematic }) {
  const camera = useThree((state) => state.camera)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const base = useRef(new Vector3())
  const offset = useRef({ x: 0, y: 0, z: 0 })
  useEffect(() => {
    base.current.fromArray(getArenaCameraPosition(width / height))
    camera.position.copy(base.current)
    camera.lookAt(...ARENA_CAMERA_TARGET)
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  const framed = useRef(false)
  useFrame((_state, elapsed) => {
    const paused = matchRuntime.snapshot.pauseReason !== null
    if (!paused) shake.step(elapsed)
    const closeUp = knockout.closeUp
    if (shake.trauma <= 0 && closeUp <= 0 && !framed.current && offset.current.x === 0 && offset.current.y === 0 && offset.current.z === 0) return
    if (shake.trauma <= 0) offset.current = { x: 0, y: 0, z: 0 }
    else shake.offset(offset.current)
    lookTarget.set(...ARENA_CAMERA_TARGET)
    camera.position.copy(base.current)
    if (closeUp > 0) {
      // Closes in along the usual line of sight, keeping the fallen robot centred.
      const { focus } = knockout
      focusTarget.set(focus.x, focus.y, focus.z)
      closeTarget.copy(base.current).sub(focusTarget).setLength(3.1).add(focusTarget)
      camera.position.lerp(closeTarget, closeUp * 0.7)
      lookTarget.lerp(focusTarget, closeUp)
    }
    framed.current = closeUp > 0
    camera.position.x += offset.current.x
    camera.position.y += offset.current.y
    camera.position.z += offset.current.z
    camera.lookAt(lookTarget)
  })
  return null
}

function ArenaFailure({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  useEffect(() => { matchRuntime.suspend('view'); matchRuntime.setSceneFps(null) }, [])
  return <div className="arena-renderer-error" role="alert"><strong>Arena 3D indisponível</strong><p>{children}</p><button type="button" onClick={onRetry}>Reabrir arena 3D</button></div>
}

class ArenaBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    matchRuntime.suspend('view')
    matchRuntime.setSceneFps(null)
    console.error('A arena 3D foi interrompida:', error, info.componentStack)
  }
  render() {
    if (this.state.failed) return <ArenaFailure onRetry={this.props.onRetry}>Verifique a aceleração gráfica do navegador. O combate foi pausado.</ArenaFailure>
    return this.props.children
  }
}

function ArenaCanvas() {
  const quality = useRobotStore((state) => state.quality)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [lost, setLost] = useState(false)
  const [revision, setRevision] = useState(0)
  const pendingExit = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retry = () => { setLost(false); setRevision((value) => value + 1) }

  useEffect(() => {
    if (pendingExit.current !== null) { clearTimeout(pendingExit.current); pendingExit.current = null }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { matchRuntime.suspend('hidden'); matchRuntime.setSceneFps(null) }
    }
    const onPageHide = () => { matchRuntime.suspend('hidden'); matchRuntime.setSceneFps(null) }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    onVisibility()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      pendingExit.current = setTimeout(() => { matchRuntime.suspend('view'); matchRuntime.setSceneFps(null) }, 0)
    }
  }, [])

  useEffect(() => {
    if (!canvas) return
    const onLost = (event: Event) => {
      event.preventDefault()
      matchRuntime.suspend('view')
      matchRuntime.setSceneFps(null)
      setLost(true)
      setCanvas(null)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [canvas])

  return <div className="arena-canvas-shell" role="img" aria-label="Arena 3D com o robô do jogador e um adversário de armadura cobre.">
    <ArenaBoundary key={revision} onRetry={retry}>
      {lost ? <ArenaFailure onRetry={retry}>A conexão com a GPU foi interrompida. Reabra a visualização e retome o combate pelos controles.</ArenaFailure>
        : <Canvas key={revision} frameloop="demand" camera={{ position: [-7.4, 4.85, 5.7], fov: ARENA_CAMERA_FOV, near: 0.1, far: 100 }}
          dpr={quality === 'light' ? 1 : [1, 1.5]} shadows={quality === 'balanced'}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => setCanvas(gl.domElement)}
          // Rendered inside the canvas element even when WebGL works, so it must have no side effects.
          fallback={<p>Ative a aceleração gráfica ou use um navegador com WebGL 2 para ver a arena.</p>}>
          <FrameLimiter />
          <ArenaWorld light={quality === 'light'} />
        </Canvas>}
    </ArenaBoundary>
  </div>
}

export default memo(ArenaCanvas)
