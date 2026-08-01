import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { ParticleField, PALETTES } from './gl/ParticleField'
import { SHAPE_ORDER, type ShapeName } from './gl/shapes'

const CYCLE_PERIOD = 9 // seconds per state when auto-cycling
const BASE_MORPH_DURATION = 2.4

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const coarsePointer = window.matchMedia('(pointer: coarse)').matches

async function boot() {
  // the glyph shape rasterises text — wait for the display font (with a
  // timeout so a slow font never blocks the experience)
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])

  const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
  const dpr = Math.min(window.devicePixelRatio, 2)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
  renderer.setPixelRatio(dpr)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor('#050505')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    50,
  )
  camera.position.set(0, 0, 5)

  // ── field ──────────────────────────────────────────────────────
  const initialCount = coarsePointer ? 30_000 : 60_000
  const field = new ParticleField(initialCount, dpr, reducedMotion)
  scene.add(field.points)

  // ── pointer → world-space cursor on the z=0 plane ─────────────
  const raycaster = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const ndc = new THREE.Vector2()
  const cursorTarget = new THREE.Vector3(999, 999, 0)
  const cursor = new THREE.Vector3(999, 999, 0)
  let pointerActive = 0 // eased toward 1 while the pointer is on screen
  let pointerActivity = 0

  function onPointerMove(e: PointerEvent) {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, hit)) {
      if (pointerActivity === 0) cursor.copy(hit) // first contact: no fly-in
      cursorTarget.copy(hit)
      pointerActivity = 1
      hideHint()
    }
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerleave', () => (pointerActivity = 0))
  window.addEventListener('blur', () => (pointerActivity = 0))

  // ── UI references ──────────────────────────────────────────────
  const stateButtons = [...document.querySelectorAll<HTMLButtonElement>('.state')]
  const scrubber = document.querySelector<HTMLElement>('.scrubber')!
  const hint = document.getElementById('hint')!
  const statFps = document.getElementById('statFps')!
  const statPts = document.getElementById('statPts')!
  const statDpr = document.getElementById('statDpr')!
  statDpr.textContent = dpr.toFixed(1)

  let hintHidden = false
  function hideHint() {
    if (hintHidden) return
    hintHidden = true
    hint.classList.add('is-hidden')
  }
  setTimeout(hideHint, 7000)

  // ── state handling ─────────────────────────────────────────────
  let morphSpeed = 1
  let cycleT = 0
  let rotationFrozen = false

  function setState(shape: ShapeName) {
    cycleT = 0
    for (const b of stateButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.shape === shape))
    }
    field.morphTo(shape, BASE_MORPH_DURATION / morphSpeed, reducedMotion)

    // the glyph must stay readable: glide rotation back to zero and hold
    rotationFrozen = shape === 'glyph'
    if (rotationFrozen) {
      const tau = Math.PI * 2
      gsap.to(field.points.rotation, {
        y: Math.round(field.points.rotation.y / tau) * tau,
        duration: reducedMotion ? 0.3 : 1.6,
        ease: 'power2.inOut',
        overwrite: 'auto',
      })
    } else {
      gsap.killTweensOf(field.points.rotation)
    }
  }

  for (const b of stateButtons) {
    b.addEventListener('click', () => setState(b.dataset.shape as ShapeName))
  }

  // ── control panel ──────────────────────────────────────────────
  const panel = document.getElementById('panel')!
  const panelToggle = document.getElementById('panelToggle')!
  panelToggle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open')
    panelToggle.setAttribute('aria-expanded', String(open))
  })

  const ctlStrength = document.getElementById('ctlStrength') as HTMLInputElement
  const ctlRadius = document.getElementById('ctlRadius') as HTMLInputElement
  const ctlSpeed = document.getElementById('ctlSpeed') as HTMLInputElement
  const ctlCycle = document.getElementById('ctlCycle') as HTMLInputElement
  const outStrength = document.getElementById('outStrength')!
  const outRadius = document.getElementById('outRadius')!
  const outSpeed = document.getElementById('outSpeed')!

  let userStrength = parseFloat(ctlStrength.value)
  ctlStrength.addEventListener('input', () => {
    userStrength = parseFloat(ctlStrength.value)
    outStrength.textContent = userStrength.toFixed(2)
  })
  ctlRadius.addEventListener('input', () => {
    field.repulsionRadius = parseFloat(ctlRadius.value)
    outRadius.textContent = parseFloat(ctlRadius.value).toFixed(2)
  })
  ctlSpeed.addEventListener('input', () => {
    morphSpeed = parseFloat(ctlSpeed.value)
    outSpeed.textContent = morphSpeed.toFixed(2)
  })

  let cycleEnabled = !reducedMotion
  ctlCycle.checked = cycleEnabled
  ctlCycle.addEventListener('change', () => {
    cycleEnabled = ctlCycle.checked
    cycleT = 0
  })

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="density"]')) {
    if (coarsePointer) input.checked = input.value === '30000'
    input.addEventListener('change', () => {
      field.rebuild(parseInt(input.value, 10))
      statPts.textContent = `${parseInt(input.value, 10) / 1000}k`
    })
  }
  statPts.textContent = `${initialCount / 1000}k`

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    input.addEventListener('change', () => field.setPalette(PALETTES[input.value]))
  }

  // ── resize ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  // ── render loop — everything advances by real elapsed time ────
  const timer = new THREE.Timer()
  let fpsFrames = 0
  let fpsAcc = 0

  function tick() {
    // clamp so a background tab doesn't produce one giant leap forward
    timer.update()
    const dt = Math.min(timer.getDelta(), 1 / 30)
    const elapsed = timer.getElapsed()

    // framerate-independent damping: same feel at 60 Hz and 144 Hz
    const ease = 1 - Math.exp(-7 * dt)
    cursor.lerp(cursorTarget, ease)
    pointerActive += (pointerActivity - pointerActive) * (1 - Math.exp(-4 * dt))
    field.repulsionStrength = userStrength * pointerActive

    // gentle orbit, frozen while the glyph is on stage
    if (!rotationFrozen && !reducedMotion) {
      field.points.rotation.y += dt * 0.055
    }

    // camera parallax toward the pointer
    if (!reducedMotion) {
      camera.position.x += (ndc.x * 0.35 * pointerActive - camera.position.x) * ease
      camera.position.y += (ndc.y * 0.22 * pointerActive - camera.position.y) * ease
      camera.lookAt(0, 0, 0)
    }

    // auto-cycle countdown drives the scrubber's progress bar
    if (cycleEnabled) {
      cycleT += dt
      if (cycleT >= CYCLE_PERIOD) {
        const next =
          SHAPE_ORDER[(SHAPE_ORDER.indexOf(field.current) + 1) % SHAPE_ORDER.length]
        setState(next)
      }
      scrubber.style.setProperty('--cycle', (cycleT / CYCLE_PERIOD).toFixed(4))
    } else {
      scrubber.style.setProperty('--cycle', '1')
    }

    // fps meter, refreshed twice a second
    fpsFrames++
    fpsAcc += dt
    if (fpsAcc >= 0.5) {
      statFps.textContent = String(Math.round(fpsFrames / fpsAcc))
      fpsFrames = 0
      fpsAcc = 0
    }

    field.update(elapsed, cursor)
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }

  tick()
}

boot()
