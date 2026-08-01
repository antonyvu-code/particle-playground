import * as THREE from 'three'
import gsap from 'gsap'
import { buildShapes, type ShapeName } from './shapes'

export interface Palette {
  a: string // base particle color
  b: string // secondary tint mixed per particle
  c: string // "touched by cursor" tint
}

export const PALETTES: Record<string, Palette> = {
  ember: { a: '#f2f0eb', b: '#f5901e', c: '#ffd9a8' },
  ion: { a: '#e8f4f8', b: '#4fd1e8', c: '#b7f4ff' },
  mono: { a: '#f2f0eb', b: '#6f6c66', c: '#ffffff' },
}

const vertexShader = /* glsl */ `
  attribute vec3 aTarget;
  attribute vec4 aRandom; // x: stagger, y: size, z: color mix, w: seed

  uniform float uTime;
  uniform float uProgress;
  uniform float uStagger;
  uniform vec3 uMouse;
  uniform float uRepRadius;
  uniform float uRepStrength;
  uniform float uWaveAmp;
  uniform float uNoiseAmp;
  uniform float uScatter;
  uniform float uSize;
  uniform float uDpr;

  varying float vMix;
  varying float vPush;

  void main() {
    // per-particle staggered progress: edges of the window ease smoothly
    float p = clamp(uProgress * (1.0 + uStagger) - aRandom.x * uStagger, 0.0, 1.0);
    p = p * p * (3.0 - 2.0 * p);
    vec3 pos = mix(position, aTarget, p);

    // mid-morph scatter: particles burst outward, peaking at p = 0.5
    float burst = sin(p * 3.14159265);
    pos += normalize(pos + vec3(0.0001, 0.0002, 0.0001)) * burst * uScatter * aRandom.w;

    // ambient drift — each particle breathes on its own phase
    float ph = aRandom.w * 43.7;
    pos.x += sin(uTime * 0.62 + ph) * uNoiseAmp;
    pos.y += cos(uTime * 0.74 + ph * 1.3) * uNoiseAmp;
    pos.z += sin(uTime * 0.51 + ph * 0.7) * uNoiseAmp;

    // live swell, only audible in the ocean state (uWaveAmp tweened by GSAP)
    pos.y += sin(pos.x * 1.15 + uTime * 1.35) * cos(pos.z * 0.9 + uTime * 0.9) * uWaveAmp;

    // cursor repulsion with smooth falloff
    vec3 away = pos - uMouse;
    float dist = length(away);
    float force = smoothstep(uRepRadius, 0.0, dist);
    pos += (away / max(dist, 0.0001)) * force * force * uRepStrength;
    vPush = force;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uDpr * aRandom.y * (22.0 / -mv.z);
    vMix = aRandom.z;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;

  varying float vMix;
  varying float vPush;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.08, d);
    vec3 col = mix(uColorA, uColorB, vMix);
    col = mix(col, uColorC, vPush); // pushed particles flare toward the accent
    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`

/**
 * GPU particle field. CPU owns two position buffers (where particles are /
 * where they go); the vertex shader blends them with uProgress, which GSAP
 * tweens. Everything else — swell, drift, repulsion — is computed per-frame
 * on the GPU.
 */
export class ParticleField {
  readonly points: THREE.Points
  count: number
  current: ShapeName = 'sphere'

  private geometry!: THREE.BufferGeometry
  private material: THREE.ShaderMaterial
  private shapes!: Record<ShapeName, Float32Array>
  private randoms!: Float32Array
  private morphTween: gsap.core.Tween | null = null
  private stagger = 0.9
  private reduced: boolean

  constructor(count: number, dpr: number, reducedMotion: boolean) {
    this.count = count
    this.reduced = reducedMotion
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uStagger: { value: this.stagger },
        uMouse: { value: new THREE.Vector3(999, 999, 0) },
        uRepRadius: { value: 0.8 },
        uRepStrength: { value: 0.55 },
        uWaveAmp: { value: 0.0 },
        uNoiseAmp: { value: reducedMotion ? 0 : 0.02 },
        uScatter: { value: reducedMotion ? 0.1 : 0.55 },
        uSize: { value: 1.0 },
        uDpr: { value: dpr },
        uColorA: { value: new THREE.Color(PALETTES.ember.a) },
        uColorB: { value: new THREE.Color(PALETTES.ember.b) },
        uColorC: { value: new THREE.Color(PALETTES.ember.c) },
        uOpacity: { value: 0.48 },
      },
    })
    this.geometry = new THREE.BufferGeometry()
    this.rebuild(count)
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
  }

  /** (Re)generate all shape targets + attributes for a new particle count. */
  rebuild(count: number): void {
    this.morphTween?.kill()
    this.count = count
    this.shapes = buildShapes(count)

    this.randoms = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      this.randoms[i * 4] = Math.random() // stagger slot
      this.randoms[i * 4 + 1] = 0.4 + Math.random() * 0.9 // size
      this.randoms[i * 4 + 2] = Math.random() * Math.random() // color mix, biased to base
      this.randoms[i * 4 + 3] = Math.random() // seed
    }

    // birth: particles condense from a wide random shell into the shape
    const cloud = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 3.2 + Math.random() * 2.5
      const phi = Math.acos(2 * Math.random() - 1)
      const theta = Math.random() * Math.PI * 2
      cloud[i * 3] = Math.sin(phi) * Math.cos(theta) * r
      cloud[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.7
      cloud[i * 3 + 2] = Math.cos(phi) * r
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(cloud, 3))
    this.geometry.setAttribute(
      'aTarget',
      new THREE.BufferAttribute(this.shapes[this.current].slice(), 3),
    )
    this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(this.randoms, 4))

    this.material.uniforms.uProgress.value = 0
    this.morphTween = gsap.to(this.material.uniforms.uProgress, {
      value: 1,
      duration: this.reduced ? 0.5 : 2.8,
      ease: 'power2.inOut',
      overwrite: true,
    })
  }

  /** Tween the field into a new shape. Safe to call mid-morph. */
  morphTo(shape: ShapeName, duration: number, reducedMotion: boolean): void {
    if (shape === this.current && !this.morphTween?.isActive()) return
    const u = this.material.uniforms

    // If interrupted mid-flight, freeze current blended positions as the
    // new starting point (same math as the vertex shader, minus FX).
    if (this.morphTween?.isActive()) {
      this.morphTween.kill()
      const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute
      const tgt = this.geometry.getAttribute('aTarget') as THREE.BufferAttribute
      const progress = u.uProgress.value as number
      for (let i = 0; i < this.count; i++) {
        let p = Math.min(
          Math.max(progress * (1 + this.stagger) - this.randoms[i * 4] * this.stagger, 0),
          1,
        )
        p = p * p * (3 - 2 * p)
        pos.setXYZ(
          i,
          pos.getX(i) + (tgt.getX(i) - pos.getX(i)) * p,
          pos.getY(i) + (tgt.getY(i) - pos.getY(i)) * p,
          pos.getZ(i) + (tgt.getZ(i) - pos.getZ(i)) * p,
        )
      }
      pos.needsUpdate = true
    } else {
      // completed morph: last target becomes the resting position
      const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute
      ;(pos.array as Float32Array).set(this.shapes[this.current])
      pos.needsUpdate = true
    }

    const tgt = this.geometry.getAttribute('aTarget') as THREE.BufferAttribute
    ;(tgt.array as Float32Array).set(this.shapes[shape])
    tgt.needsUpdate = true

    this.current = shape
    u.uProgress.value = 0

    this.morphTween = gsap.to(u.uProgress, {
      value: 1,
      duration: reducedMotion ? 0.4 : duration,
      ease: 'power2.inOut',
      overwrite: true,
    })

    // the ocean's live swell fades in only for that state
    gsap.to(u.uWaveAmp, {
      value: shape === 'ocean' && !reducedMotion ? 0.26 : 0,
      duration: reducedMotion ? 0.4 : duration,
      ease: 'power2.inOut',
    })
  }

  setPalette(p: Palette, instant = false): void {
    const u = this.material.uniforms
    const to = {
      a: new THREE.Color(p.a),
      b: new THREE.Color(p.b),
      c: new THREE.Color(p.c),
    }
    if (instant) {
      ;(u.uColorA.value as THREE.Color).copy(to.a)
      ;(u.uColorB.value as THREE.Color).copy(to.b)
      ;(u.uColorC.value as THREE.Color).copy(to.c)
      return
    }
    for (const [uni, col] of [
      [u.uColorA, to.a],
      [u.uColorB, to.b],
      [u.uColorC, to.c],
    ] as const) {
      const c = uni.value as THREE.Color
      gsap.to(c, { r: col.r, g: col.g, b: col.b, duration: 1.2, ease: 'power2.out' })
    }
  }

  set repulsionStrength(v: number) {
    this.material.uniforms.uRepStrength.value = v
  }

  set repulsionRadius(v: number) {
    this.material.uniforms.uRepRadius.value = v
  }

  update(elapsed: number, mouse: THREE.Vector3): void {
    this.material.uniforms.uTime.value = elapsed
    ;(this.material.uniforms.uMouse.value as THREE.Vector3).copy(mouse)
  }

  dispose(): void {
    this.morphTween?.kill()
    this.geometry.dispose()
    this.material.dispose()
  }
}
