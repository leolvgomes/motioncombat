import { Component, memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { BoxGeometry, Color, CylinderGeometry, GridHelper, MeshBasicMaterial, MeshStandardMaterial, RingGeometry } from 'three'
import type { BufferGeometry, Material, Mesh } from 'three'
import { RIG_JOINTS } from '../../engine/motion/rig-controller'
import { useRobotStore } from '../../stores/robot-store'
import type { FighterFrame, FighterId } from '../../types/combat'
import { matchRuntime } from '../combat/match-runtime'
import { RobotModel } from '../robot/RobotModel'
import type { RobotRig } from '../robot/RobotModel'
import { ARENA_CAMERA_FOV, ARENA_CAMERA_TARGET, getArenaCameraPosition } from './arena-camera'

const TEAM_COLOR = { player: new Color('#5acbd5'), opponent: new Color('#ef995d') }
const IMPACT_COLOR = new Color('#fff0c5')
const FIGHTER_IDS = ['player', 'opponent'] as const

function createArenaResources() {
  const geometries = {
    box: new BoxGeometry(1, 1, 1),
    deck: new CylinderGeometry(1, 1, 1, 8),
    column: new CylinderGeometry(1, 1, 1, 12),
    rim: new RingGeometry(0.96, 1, 8),
    centerRing: new RingGeometry(1, 1.012, 64),
    marker: new RingGeometry(0.54, 0.57, 48),
  }
  const materials = {
    deck: new MeshStandardMaterial({ color: '#1b2b36', metalness: 0.6, roughness: 0.56 }),
    foundation: new MeshStandardMaterial({ color: '#111b24', metalness: 0.72, roughness: 0.43 }),
    steel: new MeshStandardMaterial({ color: '#354753', metalness: 0.82, roughness: 0.34 }),
    wall: new MeshStandardMaterial({ color: '#101c25', metalness: 0.5, roughness: 0.66 }),
    ground: new MeshStandardMaterial({ color: '#0c141d', metalness: 0.2, roughness: 0.82 }),
    marking: new MeshBasicMaterial({ color: '#3c5360' }),
    cyan: new MeshBasicMaterial({ color: '#49bdc9', toneMapped: false }),
    orange: new MeshBasicMaterial({ color: '#ce793f', toneMapped: false }),
    playerMarker: new MeshBasicMaterial({ color: TEAM_COLOR.player, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }),
    opponentMarker: new MeshBasicMaterial({ color: TEAM_COLOR.opponent, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }),
  }
  const grid = new GridHelper(24, 24, '#213642', '#12222c')
  grid.position.set(0, -0.421, 0.6)
  let disposed = false
  return {
    geometries, materials, grid,
    dispose() {
      if (disposed) return
      disposed = true
      for (const geometry of Object.values(geometries)) geometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
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

function applyFighter(model: RobotRig, frame: FighterFrame, marker: Mesh, material: MeshBasicMaterial, id: FighterId, swing: number, reduced: boolean) {
  model.root.position.fromArray(frame.position)
  model.root.rotation.set(0, frame.yaw, 0)
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

function ArenaFighters({ resources }: { resources: ArenaResources }) {
  const player = useRef<RobotRig | null>(null)
  const opponent = useRef<RobotRig | null>(null)
  const playerMarker = useRef<Mesh>(null)
  const opponentMarker = useRef<Mesh>(null)
  const reducedMotion = useRef(false)
  const timer = useRef({ elapsed: 0, frames: 0, primed: false })
  const legs = useRef({ player: { phase: 0, swing: 0 }, opponent: { phase: Math.PI, swing: 0 } })
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
    const dt = Math.max(0, Math.min(Number.isFinite(elapsed) ? elapsed : 0, 0.1))
    matchRuntime.step(dt)
    const frames = matchRuntime.fighters
    const snapshot = matchRuntime.snapshot
    const advancing = snapshot.phase === 'fighting' && snapshot.pauseReason === null
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
      applyFighter(model, frame, marker, resources.materials[id === 'player' ? 'playerMarker' : 'opponentMarker'], id, leg.swing, reducedMotion.current)
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
    <RobotModel rigRef={player} />
    <RobotModel rigRef={opponent} variant="opponent" />
    <mesh ref={playerMarker} geometry={resources.geometries.marker} material={resources.materials.playerMarker} rotation={[-Math.PI / 2, 0, 0]} />
    <mesh ref={opponentMarker} geometry={resources.geometries.marker} material={resources.materials.opponentMarker} rotation={[-Math.PI / 2, 0, 0]} />
  </>
}

function ArenaScene({ light }: { light: boolean }) {
  const resources = useMemo(createArenaResources, [])
  useArenaDisposal(resources)
  const { geometries: g, materials: m } = resources
  return <>
    <color attach="background" args={['#080f16']} />
    <fog attach="fog" args={['#080f16', 22, 70]} />
    <ambientLight intensity={0.62} />
    <hemisphereLight args={['#b6e3f3', '#17212a', 1.2]} />
    <directionalLight position={[-4, 7, 4]} color="#d9e9ef" intensity={3.4} castShadow={!light} shadow-mapSize={[1024, 1024]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5.5} shadow-camera-bottom={-2} shadow-camera-near={0.1} shadow-camera-far={20} shadow-bias={-0.0005} />
    <directionalLight position={[4, 4, -3]} color="#62bcd5" intensity={2.2} />
    <directionalLight position={[-1, 4, 5]} color="#f1ac73" intensity={1.5} />
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
      <StagePart geometry={g.box} material={m.wall} position={[3.45, 1.1, 0.6]} scale={[0.12, 3, 8.4]} />
      {[-2.5, -0.45, 1.65, 3.7].map((z) => <group key={z}>
        <StagePart geometry={g.box} material={m.foundation} position={[3.3, 1.1, z]} scale={[0.18, 3, 0.18]} />
        <StagePart geometry={g.box} material={m.cyan} position={[3.197, 2.05, z]} scale={[0.016, 0.4, 0.035]} />
      </group>)}
      <ArenaFighters resources={resources} />
    </group>
  </>
}

function ArenaCamera() {
  const camera = useThree((state) => state.camera)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  useEffect(() => {
    camera.position.fromArray(getArenaCameraPosition(width / height))
    camera.lookAt(...ARENA_CAMERA_TARGET)
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  return null
}

function ArenaFailure({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  useEffect(() => { matchRuntime.suspend('view'); matchRuntime.setSceneFps(null) }, [])
  return <div className="arena-renderer-error" role="alert"><strong>Arena 3D indisponível</strong><p>{children}</p>{onRetry && <button type="button" onClick={onRetry}>Reabrir arena 3D</button>}</div>
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

  return <div className="arena-canvas-shell" role="img" aria-label="Arena industrial 3D com o robô ciano do jogador e um adversário de armadura cobre.">
    <ArenaBoundary key={revision} onRetry={retry}>
      {lost ? <ArenaFailure onRetry={retry}>A conexão com a GPU foi interrompida. Reabra a visualização e retome o combate pelos controles.</ArenaFailure>
        : <Canvas key={revision} camera={{ position: [-7.4, 4.85, 5.7], fov: ARENA_CAMERA_FOV, near: 0.1, far: 100 }}
          dpr={quality === 'light' ? 1 : [1, 1.5]} shadows={quality === 'balanced'}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => setCanvas(gl.domElement)}
          fallback={<ArenaFailure>Ative a aceleração gráfica ou use um navegador com WebGL 2. O combate está pausado.</ArenaFailure>}>
          <ArenaScene light={quality === 'light'} />
          <ArenaCamera />
        </Canvas>}
    </ArenaBoundary>
  </div>
}

export default memo(ArenaCanvas)
