import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import type { BufferGeometry, Group, Material } from 'three'
import { createRobotResources } from './robot-resources'
import type { RobotResources } from './robot-resources'

/** Local rest axes point down -Y; +Z is forward and anatomical left is +X. */
export interface RobotRig {
  root: Group
  torso: Group
  head: Group
  leftShoulder: Group
  leftElbow: Group
  leftWrist: Group
  rightShoulder: Group
  rightElbow: Group
  rightWrist: Group
  leftHip: Group
  leftKnee: Group
  rightHip: Group
  rightKnee: Group
}

type Vector3Tuple = [number, number, number]
type GroupRef = RefObject<Group | null>

interface PartProps {
  geometry: BufferGeometry
  material: Material
  position?: Vector3Tuple
  rotation?: Vector3Tuple
  scale: Vector3Tuple
  name?: string
}

function Part(props: PartProps) {
  return <mesh {...props} castShadow receiveShadow />
}

interface ArmProps {
  side: 1 | -1
  resources: RobotResources
  shoulderRef: GroupRef
  elbowRef: GroupRef
  wristRef: GroupRef
}

function Arm({ side, resources: { geometries: g, materials: m }, shoulderRef, elbowRef, wristRef }: ArmProps) {
  const name = side === 1 ? 'left' : 'right'
  return <group ref={shoulderRef} name={`${name}-shoulder`} position={[side * 0.53, 0.63, 0]}>
    <Part geometry={g.cylinder} material={m.mechanism} rotation={[0, 0, Math.PI / 2]} scale={[0.13, 0.25, 0.13]} />
    <Part geometry={g.armor} material={m.slate} position={[side * 0.035, -0.035, 0]} rotation={[0, 0, side * 0.1]} scale={[0.35, 0.29, 0.35]} />
    <Part geometry={g.armor} material={m.silver} position={[side * 0.035, 0.035, 0.125]} rotation={[0.11, 0, side * 0.1]} scale={[0.31, 0.13, 0.14]} />
    <Part geometry={g.box} material={m.cyan} position={[side * 0.035, 0.078, 0.201]} scale={[0.18, 0.016, 0.008]} />
    <Part geometry={g.cylinder} material={m.mechanism} position={[0, -0.245, 0]} scale={[0.075, 0.41, 0.075]} />
    <Part geometry={g.armor} material={m.silver} position={[side * 0.012, -0.255, 0.012]} rotation={[0, 0, -side * 0.05]} scale={[0.225, 0.31, 0.255]} />
    <Part geometry={g.cylinder} material={m.steel} position={[-side * 0.081, -0.27, -0.057]} scale={[0.022, 0.3, 0.022]} />
    <group ref={elbowRef} name={`${name}-elbow`} position={[0, -0.47, 0]}>
      <Part geometry={g.cylinder} material={m.mechanism} rotation={[0, 0, Math.PI / 2]} scale={[0.105, 0.24, 0.105]} />
      <Part geometry={g.cylinder} material={m.steel} position={[side * 0.125, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.078, 0.018, 0.078]} />
      <Part geometry={g.cylinder} material={m.mechanism} position={[0, -0.215, 0]} scale={[0.073, 0.37, 0.073]} />
      <Part geometry={g.armor} material={m.slate} position={[0, -0.21, 0.01]} rotation={[-0.04, 0, 0]} scale={[0.25, 0.32, 0.29]} />
      <Part geometry={g.plate} material={m.silver} position={[0, -0.20, 0.158]} scale={[side * 0.22, 0.28, 0.34]} />
      <Part geometry={g.box} material={m.orange} position={[side * 0.072, -0.18, 0.198]} scale={[0.022, 0.11, 0.008]} />
      <group ref={wristRef} name={`${name}-wrist`} position={[0, -0.43, 0]}>
        <Part geometry={g.cylinder} material={m.mechanism} scale={[0.077, 0.105, 0.077]} />
        <Part geometry={g.armor} material={m.slate} position={[0, -0.12, 0.015]} scale={[0.19, 0.2, 0.23]} />
        <Part geometry={g.armor} material={m.silver} position={[0, -0.105, 0.144]} scale={[0.213, 0.085, 0.074]} />
        <Part geometry={g.armor} material={m.graphite} position={[-side * 0.112, -0.104, 0.055]} rotation={[0, 0, -side * 0.22]} scale={[0.072, 0.13, 0.12]} />
      </group>
    </group>
  </group>
}

interface LegProps {
  side: 1 | -1
  resources: RobotResources
  hipRef: GroupRef
  kneeRef: GroupRef
}

function Leg({ side, resources: { geometries: g, materials: m }, hipRef, kneeRef }: LegProps) {
  const name = side === 1 ? 'left' : 'right'
  return <group ref={hipRef} name={`${name}-hip`} position={[side * 0.22, 1.05, 0]}>
    <Part geometry={g.sphere} material={m.mechanism} scale={[0.13, 0.125, 0.13]} />
    <Part geometry={g.cylinder} material={m.mechanism} position={[0, -0.235, 0]} scale={[0.085, 0.4, 0.085]} />
    <Part geometry={g.armor} material={m.slate} position={[0, -0.22, 0]} rotation={[0, 0, side * 0.025]} scale={[0.275, 0.35, 0.3]} />
    <Part geometry={g.plate} material={m.silver} position={[0, -0.215, 0.171]} scale={[side * 0.24, 0.32, 0.4]} />
    <group ref={kneeRef} name={`${name}-knee`} position={[0, -0.47, 0]}>
      <Part geometry={g.cylinder} material={m.mechanism} rotation={[0, 0, Math.PI / 2]} scale={[0.105, 0.255, 0.105]} />
      <Part geometry={g.armor} material={m.graphite} position={[0, 0, 0.133]} scale={[0.235, 0.17, 0.14]} />
      <Part geometry={g.cylinder} material={m.mechanism} position={[0, -0.22, 0]} scale={[0.075, 0.36, 0.075]} />
      <Part geometry={g.armor} material={m.slate} position={[0, -0.225, 0.005]} scale={[0.24, 0.335, 0.285]} />
      <Part geometry={g.plate} material={m.silver} position={[0, -0.22, 0.167]} scale={[side * 0.20, 0.315, 0.36]} />
      <Part geometry={g.box} material={m.cyan} position={[side * 0.061, -0.23, 0.198]} scale={[0.016, 0.16, 0.007]} />
      <Part geometry={g.armor} material={m.graphite} position={[0, -0.22, -0.135]} scale={[0.18, 0.25, 0.105]} />
      <Part geometry={g.cylinder} material={m.steel} position={[0, -0.4, 0]} scale={[0.078, 0.1, 0.078]} />
      <Part geometry={g.armor} material={m.slate} position={[0, -0.48, 0.078]} scale={[0.285, 0.18, 0.43]} />
      <Part geometry={g.armor} material={m.rubber} position={[0, -0.555, 0.081]} scale={[0.292, 0.05, 0.445]} />
      <Part geometry={g.armor} material={m.silver} position={[0, -0.493, 0.245]} scale={[0.28, 0.13, 0.14]} />
    </group>
  </group>
}

/** A replaceable, original procedural rig. Root at floor 0; torso pivot at y=1.20. */
export function RobotModel({ rigRef }: { rigRef: RefObject<RobotRig | null> }) {
  const resources = useMemo(createRobotResources, [])
  const { geometries: g, materials: m } = resources
  const pendingDisposal = useRef<ReturnType<typeof setTimeout> | null>(null)
  const root = useRef<Group>(null)
  const torso = useRef<Group>(null)
  const head = useRef<Group>(null)
  const leftShoulder = useRef<Group>(null)
  const leftElbow = useRef<Group>(null)
  const leftWrist = useRef<Group>(null)
  const rightShoulder = useRef<Group>(null)
  const rightElbow = useRef<Group>(null)
  const rightWrist = useRef<Group>(null)
  const leftHip = useRef<Group>(null)
  const leftKnee = useRef<Group>(null)
  const rightHip = useRef<Group>(null)
  const rightKnee = useRef<Group>(null)

  useLayoutEffect(() => {
    if (!root.current || !torso.current || !head.current
      || !leftShoulder.current || !leftElbow.current || !leftWrist.current
      || !rightShoulder.current || !rightElbow.current || !rightWrist.current
      || !leftHip.current || !leftKnee.current || !rightHip.current || !rightKnee.current) return
    const rig: RobotRig = {
      root: root.current, torso: torso.current, head: head.current,
      leftShoulder: leftShoulder.current, leftElbow: leftElbow.current, leftWrist: leftWrist.current,
      rightShoulder: rightShoulder.current, rightElbow: rightElbow.current, rightWrist: rightWrist.current,
      leftHip: leftHip.current, leftKnee: leftKnee.current, rightHip: rightHip.current, rightKnee: rightKnee.current,
    }
    rigRef.current = rig
    return () => { if (rigRef.current === rig) rigRef.current = null }
  }, [rigRef])

  useEffect(() => {
    // React StrictMode replays effect setup/cleanup. Cancel the provisional disposal on replay.
    if (pendingDisposal.current !== null) clearTimeout(pendingDisposal.current)
    return () => {
      pendingDisposal.current = setTimeout(() => {
        resources.dispose()
        pendingDisposal.current = null
      }, 0)
    }
  }, [resources])

  return <group ref={root} name="steel-sync-root" dispose={null}>
    <group name="pelvis" position={[0, 1.07, 0]}>
      <Part geometry={g.armor} material={m.graphite} scale={[0.64, 0.25, 0.37]} />
      <Part geometry={g.armor} material={m.slate} position={[0.19, -0.025, 0.164]} rotation={[0, -0.1, -0.1]} scale={[0.25, 0.21, 0.13]} />
      <Part geometry={g.armor} material={m.slate} position={[-0.19, -0.025, 0.164]} rotation={[0, 0.1, 0.1]} scale={[0.25, 0.21, 0.13]} />
      <Part geometry={g.armor} material={m.steel} position={[0, 0.025, 0.205]} scale={[0.135, 0.105, 0.06]} />
    </group>
    <Leg side={1} resources={resources} hipRef={leftHip} kneeRef={leftKnee} />
    <Leg side={-1} resources={resources} hipRef={rightHip} kneeRef={rightKnee} />

    <group ref={torso} name="torso" position={[0, 1.2, 0]}>
      <Part geometry={g.cylinder} material={m.mechanism} position={[0, 0.11, 0]} scale={[0.19, 0.25, 0.19]} />
      <Part geometry={g.armor} material={m.steel} position={[0, 0.115, 0.132]} scale={[0.37, 0.075, 0.14]} />
      <Part geometry={g.armor} material={m.slate} position={[0, 0.215, 0.15]} scale={[0.43, 0.09, 0.145]} />
      <Part geometry={g.armor} material={m.graphite} position={[0, 0.46, 0]} scale={[0.65, 0.49, 0.35]} />
      <Part geometry={g.plate} material={m.silver} position={[0.207, 0.50, 0.227]} rotation={[-0.04, 0.1, -0.075]} scale={[0.37, 0.43, 0.62]} />
      <Part geometry={g.plate} material={m.silver} position={[-0.207, 0.50, 0.227]} rotation={[-0.04, -0.1, 0.075]} scale={[-0.37, 0.43, 0.62]} />
      <Part geometry={g.armor} material={m.slate} position={[0, 0.73, -0.025]} scale={[0.48, 0.12, 0.31]} />
      <Part geometry={g.armor} material={m.graphite} position={[0, 0.48, 0.279]} scale={[0.14, 0.25, 0.075]} />
      <Part geometry={g.cylinder} material={m.mechanism} position={[0, 0.52, 0.335]} rotation={[Math.PI / 2, 0, 0]} scale={[0.074, 0.025, 0.074]} />
      <Part geometry={g.ring} material={m.steel} position={[0, 0.52, 0.353]} scale={[0.058, 0.058, 0.058]} />
      <Part geometry={g.cylinder} material={m.cyan} position={[0, 0.52, 0.354]} rotation={[Math.PI / 2, 0, 0]} scale={[0.038, 0.009, 0.038]} />
      <Part geometry={g.box} material={m.orange} position={[0.243, 0.588, 0.291]} rotation={[0, 0.1, -0.075]} scale={[0.105, 0.019, 0.01]} />
      <Part geometry={g.armor} material={m.slate} position={[0, 0.49, -0.204]} scale={[0.57, 0.41, 0.12]} />
      <Part geometry={g.box} material={m.mechanism} position={[0, 0.40, -0.272]} scale={[0.30, 0.026, 0.014]} />
      <Part geometry={g.box} material={m.mechanism} position={[0, 0.47, -0.272]} scale={[0.30, 0.026, 0.014]} />
      <Part geometry={g.box} material={m.mechanism} position={[0, 0.54, -0.272]} scale={[0.30, 0.026, 0.014]} />
      <Part geometry={g.cylinder} material={m.mechanism} position={[0, 0.83, 0]} scale={[0.075, 0.18, 0.075]} />

      <group ref={head} name="head" position={[0, 0.96, 0]}>
        <Part geometry={g.armor} material={m.slate} position={[0, 0.1, 0]} scale={[0.38, 0.34, 0.3]} />
        <Part geometry={g.armor} material={m.silver} position={[0, 0.265, 0.005]} rotation={[-0.06, 0, 0]} scale={[0.39, 0.09, 0.31]} />
        <Part geometry={g.armor} material={m.mechanism} position={[0, 0.125, 0.157]} scale={[0.335, 0.096, 0.045]} />
        <Part geometry={g.armor} material={m.cyan} position={[0, 0.129, 0.183]} scale={[0.286, 0.036, 0.016]} />
        <Part geometry={g.armor} material={m.silver} position={[0, -0.008, 0.112]} rotation={[-0.12, 0, 0]} scale={[0.283, 0.12, 0.14]} />
        <Part geometry={g.cylinder} material={m.steel} position={[0.207, 0.095, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.075, 0.055, 0.075]} />
        <Part geometry={g.cylinder} material={m.steel} position={[-0.207, 0.095, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.075, 0.055, 0.075]} />
      </group>
      <Arm side={1} resources={resources} shoulderRef={leftShoulder} elbowRef={leftElbow} wristRef={leftWrist} />
      <Arm side={-1} resources={resources} shoulderRef={rightShoulder} elbowRef={rightElbow} wristRef={rightWrist} />
    </group>
  </group>
}
