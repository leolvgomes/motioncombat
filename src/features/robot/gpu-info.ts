export interface GpuInfo {
  /** Short display name, or null when the browser hides it. */
  readonly name: string | null
  /** Shares memory and power with the processor. Unknown hardware is never called integrated. */
  readonly integrated: boolean
  readonly software: boolean
}

const INTEGRATED = /intel.*(hd|uhd|iris)|amd radeon\(tm\) graphics|radeon (vega|rx vega) \d+ graphics|adreno|mali|powervr/i
const SOFTWARE = /swiftshader|llvmpipe|microsoft basic render|software/i

export function parseGpu(renderer: string | null): GpuInfo {
  if (!renderer) return { name: null, integrated: false, software: false }
  // ANGLE (Vendor, Device (0xID) Direct3D11 ..., D3D11) → Device
  const device = /^ANGLE \([^,]+, ([^,]+?)(?: \(0x[0-9a-f]+\))?(?: Direct3D.*| OpenGL.*| Vulkan.*)?,/i.exec(renderer)?.[1] ?? renderer
  return { name: device.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 48), integrated: INTEGRATED.test(renderer), software: SOFTWARE.test(renderer) }
}

export function describeGpu(context: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  try {
    const extension = context.getExtension('WEBGL_debug_renderer_info')
    return parseGpu(extension ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null)
  } catch { return parseGpu(null) }
}
