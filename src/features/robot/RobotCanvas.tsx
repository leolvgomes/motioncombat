import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { RigController, RIG_JOINTS } from '../../engine/motion/rig-controller'
import { useLabStore } from '../../stores/lab-store'
import { useRobotStore } from '../../stores/robot-store'
import { readPose, readPoseAspectRatio } from '../motion-tracking/pose-stream'
import { RobotModel } from './RobotModel'
import type { RobotRig } from './RobotModel'
import { getRobotCameraPosition, ROBOT_CAMERA_FOV, ROBOT_CAMERA_TARGET } from './camera-fit'

function RigDriver() {
  const rig = useRef<RobotRig | null>(null)
  const controller = useRef<RigController | null>(null)
  if (!controller.current) controller.current = new RigController()
  const timer = useRef({ measured: 0, frames: 0, legsTime: 0 })
  const reducedMotion = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { reducedMotion.current = media.matches }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useFrame((_state, delta) => {
    const model = rig.current
    const motion = controller.current
    if (!model || !motion) return
    const settings = useRobotStore.getState()
    const lab = useLabStore.getState()
    const dt = Math.min(delta, 0.1)
    motion.step({
      mode: settings.mode, paused: settings.paused,
      active: lab.session.status === 'running', pose: readPose(),
      mirrored: lab.mirrored, aspectRatio: readPoseAspectRatio(), now: performance.now(),
    }, settings.mode === 'demo' && reducedMotion.current ? dt * 0.5 : dt)
    for (const name of RIG_JOINTS) model[name].quaternion.copy(motion.rotations[name])

    // Legs remain independent of camera tracking, supporting a planted stance.
    const frozen = settings.mode === 'demo' && settings.paused
    if (!frozen && !reducedMotion.current) timer.current.legsTime += dt
    const weight = reducedMotion.current ? 0 : Math.sin(timer.current.legsTime * 1.15) * 0.012
    model.leftHip.rotation.set(-0.025, 0, 0.025 + weight)
    model.rightHip.rotation.set(0.025, 0, -0.025 + weight)
    model.leftKnee.rotation.x = 0.055
    model.rightKnee.rotation.x = 0.055

    timer.current.measured += delta
    timer.current.frames += 1
    if (timer.current.measured >= 0.5) {
      settings.setSceneDiagnostics(timer.current.frames / timer.current.measured, motion.sourceStatus)
      timer.current.measured = 0
      timer.current.frames = 0
    }
  })

  useEffect(() => () => useRobotStore.getState().setSceneDiagnostics(null, 'idle'), [])
  return <RobotModel rigRef={rig} />
}

function ViewController() {
  const camera = useThree((state) => state.camera)
  const view = useRobotStore((state) => state.view)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  useEffect(() => {
    camera.position.fromArray(getRobotCameraPosition(view, width / height))
    camera.lookAt(...ROBOT_CAMERA_TARGET)
    camera.updateProjectionMatrix()
  }, [camera, view, width, height])
  return null
}

function LabStage({ light }: { light: boolean }) {
  return <>
    <color attach="background" args={['#0b1217']} />
    <fog attach="fog" args={['#0b1217', 7, 17]} />
    <ambientLight intensity={0.65} />
    <hemisphereLight args={['#b9e8ff', '#13212d', 1.3]} />
    <directionalLight position={[3.5, 5, 5]} intensity={3.5} color="#d8efff" castShadow={!light} shadow-mapSize={[1024, 1024]} shadow-camera-left={-2.5} shadow-camera-right={2.5} shadow-camera-top={3.4} shadow-camera-bottom={-0.5} shadow-bias={-0.0005} />
    <directionalLight position={[-4, 3, -2]} intensity={3.1} color="#ff9a61" />
    <directionalLight position={[-2, 2, 4]} intensity={1.6} color="#74dddd" />
    <mesh receiveShadow position={[0, -0.13, 0]}>
      <cylinderGeometry args={[1.45, 1.53, 0.22, 64]} />
      <meshStandardMaterial color="#192630" metalness={0.65} roughness={0.48} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.014, 0]}>
      <ringGeometry args={[1.34, 1.355, 64]} />
      <meshBasicMaterial color="#4ed6db" transparent opacity={0.65} />
    </mesh>
    <Grid args={[14, 14]} position={[0, -0.245, 0]} cellSize={0.3} cellThickness={0.45} cellColor="#233d49" sectionSize={1.5} sectionThickness={0.8} sectionColor="#3a6471" fadeDistance={8} fadeStrength={2} infiniteGrid />
  </>
}

function CanvasFallback({ children }: { children: React.ReactNode }) {
  return <div className="robot-renderer-error" role="alert"><strong>Visualização 3D indisponível</strong><p>{children}</p></div>
}

function RobotCanvas() {
  const quality = useRobotStore((state) => state.quality)
  const [lost, setLost] = useState(false)
  const [revision, setRevision] = useState(0)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!canvas) return
    const onLost = (event: Event) => {
      event.preventDefault()
      setLost(true)
      setCanvas(null)
      useRobotStore.getState().setSceneDiagnostics(null, 'idle')
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [canvas])

  if (lost) return <CanvasFallback>A conexão com a GPU foi interrompida. <button type="button" onClick={() => { setLost(false); setRevision((value) => value + 1) }}>Reabrir visualização 3D</button></CanvasFallback>

  return <div className="robot-canvas-shell" role="img" aria-label="Robô metálico articulado em uma plataforma de teste 3D; acompanha a fonte de movimento selecionada.">
    <Canvas key={revision} camera={{ position: [0, 1.65, 6.1], fov: ROBOT_CAMERA_FOV, near: 0.1, far: 40 }}
      dpr={quality === 'light' ? 1 : [1, 1.5]} shadows={quality === 'balanced'}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => setCanvas(gl.domElement)}
      fallback={<CanvasFallback>Ative a aceleração gráfica ou tente um navegador com WebGL 2. A webcam continua disponível.</CanvasFallback>}>
      <LabStage light={quality === 'light'} />
      <RigDriver />
      <ViewController />
    </Canvas>
  </div>
}

export default memo(RobotCanvas)
