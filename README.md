# Particle Field — EXP.01 · ROSI Lab

Interactive WebGL particle experiment: 30k–100k particles morphing between
four states (sphere → ocean → glyph → vortex), with cursor repulsion and a
hand-rolled control panel.

## Run

```bash
npm install
npm run dev   # http://localhost:5611
```

## Architecture

| File | Role |
| --- | --- |
| `src/main.ts` | Delta-time render loop, pointer raycasting, auto-cycle, UI wiring |
| `src/gl/ParticleField.ts` | BufferGeometry + custom shaders; GSAP tweens `uProgress` |
| `src/gl/shapes.ts` | Shape generators (fibonacci sphere, ocean plane, text raster, spiral) |

Key ideas:

- **Morphing is GPU-side.** Each particle has `position` (where it is) and
  `aTarget` (where it goes). The vertex shader mixes them with a per-particle
  stagger; GSAP animates a single `uProgress` uniform.
- **Everything is delta-time based.** Damping uses `1 − e^(−k·dt)` so the feel
  is identical at 60 Hz and 144 Hz.
- **Interrupted morphs are frozen on the CPU** using the same easing math as
  the shader, then re-targeted — you can spam the state buttons safely.
- **Adaptive:** coarse pointers start at 30k particles, DPR capped at 2,
  `prefers-reduced-motion` disables auto-cycle/drift and snaps morphs.
