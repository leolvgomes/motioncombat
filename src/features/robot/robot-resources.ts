import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export type RobotVariant = 'player' | 'opponent'

/** Geometry is authored once and scaled by each armor or mechanism instance. */
export function createRobotResources(variant: RobotVariant = 'player') {
  const outline = new Shape()
  outline.moveTo(-0.46, -0.28)
  outline.lineTo(-0.18, -0.5)
  outline.lineTo(0.42, -0.36)
  outline.lineTo(0.5, 0.23)
  outline.lineTo(0.26, 0.5)
  outline.lineTo(-0.5, 0.39)
  outline.closePath()
  const plate = new ExtrudeGeometry(outline, {
    depth: 0.14, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025,
    bevelSegments: 2, steps: 1, curveSegments: 1,
  })
  plate.center()

  const geometries = {
    armor: new RoundedBoxGeometry(1, 1, 1, 2, 0.09),
    box: new BoxGeometry(1, 1, 1),
    cylinder: new CylinderGeometry(1, 1, 1, 16, 1),
    sphere: new SphereGeometry(1, 16, 10),
    ring: new TorusGeometry(1, 0.14, 8, 24),
    plate,
  }
  const opponent = variant === 'opponent'
  const materials = {
    silver: new MeshStandardMaterial({ color: opponent ? '#af7955' : '#a9b9c3', metalness: 0.82, roughness: 0.32 }),
    slate: new MeshStandardMaterial({ color: opponent ? '#493c37' : '#415363', metalness: 0.78, roughness: 0.39 }),
    graphite: new MeshStandardMaterial({ color: '#151f28', metalness: 0.68, roughness: 0.48 }),
    mechanism: new MeshStandardMaterial({ color: '#090f15', metalness: 0.63, roughness: 0.44 }),
    steel: new MeshStandardMaterial({ color: '#758994', metalness: 0.91, roughness: 0.25 }),
    cyan: new MeshStandardMaterial({ color: opponent ? '#ffb76b' : '#60dbe3', emissive: opponent ? '#e57c30' : '#26bfce', emissiveIntensity: 1.25, metalness: 0.35, roughness: 0.27 }),
    orange: new MeshStandardMaterial({ color: opponent ? '#d1bda1' : '#ed7b46', metalness: 0.35, roughness: 0.41 }),
    rubber: new MeshStandardMaterial({ color: '#080d12', metalness: 0.12, roughness: 0.88 }),
  }
  let disposed = false

  return {
    geometries,
    materials,
    dispose() {
      if (disposed) return
      disposed = true
      for (const geometry of Object.values(geometries)) geometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
    },
  }
}

export type RobotResources = ReturnType<typeof createRobotResources>
