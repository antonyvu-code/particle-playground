// Shape generators — each returns count*3 positions in world units.
// The stage is framed for a camera at z=5, fov 50: keep shapes within
// roughly x ∈ [-3, 3], y ∈ [-1.8, 1.8].

export type ShapeName = 'sphere' | 'ocean' | 'glyph' | 'vortex'

export const SHAPE_ORDER: ShapeName[] = ['sphere', 'ocean', 'glyph', 'vortex']

const TAU = Math.PI * 2

export function buildShapes(count: number): Record<ShapeName, Float32Array> {
  return {
    sphere: sphere(count),
    ocean: ocean(count),
    glyph: glyph(count),
    vortex: vortex(count),
  }
}

/** Fibonacci sphere with slight radial breathing so the surface feels alive. */
function sphere(count: number): Float32Array {
  const out = new Float32Array(count * 3)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const R = 1.55
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const jitter = 1 + (Math.random() - 0.5) * 0.06
    out[i * 3] = Math.cos(theta) * r * R * jitter
    out[i * 3 + 1] = y * R * jitter
    out[i * 3 + 2] = Math.sin(theta) * r * R * jitter
  }
  return out
}

/** A tilted ocean plane; the live swell is added in the vertex shader. */
function ocean(count: number): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 7
    const z = (Math.random() - 0.5) * 4.6
    // baked ground-swell so the surface has relief even when frozen
    const y =
      Math.sin(x * 1.1) * 0.18 +
      Math.cos(z * 1.7 + x * 0.4) * 0.12 -
      0.35
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  return out
}

/** The word ROSI, sampled from a 2D canvas raster. */
function glyph(count: number): Float32Array {
  const W = 640
  const H = 200
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 150px 'Bricolage Grotesque Variable', 'Arial Black', sans-serif`
  ctx.fillText('ROSI', W / 2, H / 2 + 8)

  const data = ctx.getImageData(0, 0, W, H).data
  const px: number[] = []
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (data[(y * W + x) * 4 + 3] > 128) px.push(x, y)
    }
  }

  const out = new Float32Array(count * 3)
  const scale = 5.4 / W
  for (let i = 0; i < count; i++) {
    const p = (Math.random() * (px.length / 2)) | 0
    const gx = px[p * 2] + (Math.random() - 0.5) * 2
    const gy = px[p * 2 + 1] + (Math.random() - 0.5) * 2
    out[i * 3] = (gx - W / 2) * scale
    out[i * 3 + 1] = -(gy - H / 2) * scale
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.22
  }
  return out
}

/** Three-armed vortex — logarithmic spiral, tilted so the camera sees the disc. */
function vortex(count: number): Float32Array {
  const out = new Float32Array(count * 3)
  const ARMS = 3
  const tilt = 1.05 // rotate the disc toward the camera
  const cosT = Math.cos(tilt)
  const sinT = Math.sin(tilt)
  for (let i = 0; i < count; i++) {
    const arm = i % ARMS
    const t = Math.pow(Math.random(), 0.62)
    const r = t * 2.1 + 0.15
    const spin = t * 3.1
    const angle = (arm / ARMS) * TAU + spin + (Math.random() - 0.5) * (0.7 - t * 0.45)
    const x = Math.cos(angle) * r
    const y = (Math.random() + Math.random() + Math.random() - 1.5) * ((1 - t) * 0.5 + 0.05) * 0.8
    const z = Math.sin(angle) * r
    out[i * 3] = x
    out[i * 3 + 1] = y * cosT - z * sinT
    out[i * 3 + 2] = y * sinT + z * cosT
  }
  return out
}
