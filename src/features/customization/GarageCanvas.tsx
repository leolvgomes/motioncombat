import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { createCombatGuardPose } from '../../engine/animation/combat-clips'
import { RIG_JOINTS } from '../../engine/motion/rig-controller'
import { useProfileStore } from '../../stores/profile-store'
import { useRobotStore } from '../../stores/robot-store'
import { RobotModel } from '../robot/RobotModel'
import type { RobotRig } from '../robot/RobotModel'

const GUARD = createCombatGuardPose()

function Turntable() {
  const rig = useRef<RobotRig | null>(null)
  const look = useProfileStore((state) => state.look)
  const angle = useRef(0.45)
  const reduced = useRef(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { reduced.current = media.matches }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useFrame((_state, elapsed) => {
    const model = rig.current
    if (!model) return
    if (!reduced.current) angle.current += Math.min(elapsed, 0.1) * 0.45
    model.root.rotation.y = angle.current
    for (const name of RIG_JOINTS) model[name].quaternion.fromArray(GUARD[name])
  })
  return <RobotModel rigRef={rig} look={look} />
}

function GarageCanvas() {
  const quality = useRobotStore((state) => state.quality)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [lost, setLost] = useState(false)
  useEffect(() => {
    if (!canvas) return
    const onLost = (event: Event) => { event.preventDefault(); setLost(true); setCanvas(null) }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [canvas])
  if (lost) return <div className="garage-message" role="alert"><p>A conexão com a GPU foi interrompida.</p><button className="combat-secondary-action" type="button" onClick={() => setLost(false)}>Reabrir prévia</button></div>
  return <div className="garage-canvas" role="img" aria-label="Prévia 3D do seu robô com a aparência escolhida.">
    <Canvas camera={{ position: [0, 1.75, 5.2], fov: 34, near: 0.1, far: 40 }} dpr={quality === 'light' ? 1 : [1, 1.5]}
      onCreated={({ gl, camera }) => { camera.lookAt(0, 1.2, 0); setCanvas(gl.domElement) }}
      fallback={<p className="garage-message">Ative a aceleração gráfica para ver a prévia.</p>}>
      <color attach="background" args={['#0c141b']} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#cfe8f5', '#17212a', 1.3]} />
      <directionalLight position={[3, 5, 5]} intensity={3.2} color="#e6f1f6" />
      <directionalLight position={[-4, 3, -2]} intensity={2.4} color="#ffb184" />
      <mesh position={[0, -0.06, 0]}>
        <cylinderGeometry args={[1.15, 1.22, 0.12, 48]} />
        <meshStandardMaterial color="#1b2832" metalness={0.6} roughness={0.5} />
      </mesh>
      <Turntable />
    </Canvas>
  </div>
}

export default memo(GarageCanvas)
