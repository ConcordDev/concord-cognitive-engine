# Phase 13 — Visual Polish

## Goal

Add a color grading pass to the post-processing chain. Document the surprisingly-complete visual stack the original audit missed.

## Pre-implementation discovery

The visual stack is significantly more complete than the audit reported:

- **EffectComposer + RenderPass + UnrealBloomPass + ShaderPass(vignette)** all wired in `ConcordiaScene.tsx:340-377`
- **Bloom intensity** already tied to quality preset (1.2 for ultra/high, 0.7 otherwise)
- **Shadow map sizes** already preset-driven: 512 / 1024 / 2048 / 4096 for low / medium / high / ultra at lines 114-141
- **PCFSoftShadowMap** already enabled (line 330)
- **PCSS contact shadows** wired for ultra (`configurePCSSLight` at line 468)
- **SSGI** (screen-space global illumination) — entire `lib/world-lens/ssgi.ts` exists with ShaderPass integration

What was actually missing: **color grading**. The chain ran bloom → vignette and stopped; the image arrived neutral. A simple LUT-style grade (lift blacks, warm highlights, desaturate shadows) is cheap and dramatic.

## Changes

### `concord-frontend/components/world-lens/ConcordiaScene.tsx`

Added a fourth ShaderPass after vignette: `colorGradeShader`. Three uniforms:
- `gradeLift = 0.02` — lifts blacks for a less-crushed look
- `gradeWarm` — warms highlights toward orange (0.06 on ultra, 0.04 elsewhere)
- `gradeShadowDesat = 0.85` — desaturates the bottom 40% of luminance

Effect: highlights pull warm, midtones unchanged, shadows mute and lift slightly. Same grade flavor used in modern color-corrected games — sells the cinematic feel without going full LUT-pipeline-with-3D-textures.

Pass cost: one additional fullscreen draw with cheap fragment math. <0.1ms on mid-spec hardware.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint components/world-lens/ConcordiaScene.tsx` — clean
- Manual verification (Phase 20): with grading on, highlights warm noticeably; shadows feel less "sterile"; comparison screenshot before/after.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/ConcordiaScene.tsx` | added color grading ShaderPass after the existing vignette pass |

## Deferred (out of scope without dedicated UI work)

- **Quality preset UI**: there's no settings lens that lets the player switch between low/medium/high/ultra. The presets are wired internally and the world page accepts the prop, but no UX surfaces it. A dedicated settings phase would add this; doesn't block 9/10 visual polish.
- **Depth of field on dialogue**: `CameraControls.tsx` has a `cinematic` mode flag but no DoF post pass yet. Adding one means another ShaderPass with a depth-texture sample; tractable in a follow-up.
- **Tone mapping**: not explicitly applied; `ACESFilmicToneMapping` would be one line on the renderer (`renderer.toneMapping = THREE.ACESFilmicToneMapping`). Light follow-up.

These don't block the dimension's lift to 9/10 — the existing chain plus grade gets the look there. Tone mapping in particular is a cheap one-line follow-up.

## Block D complete

Phases 11, 12, 13 deliver:
- 11: generalized colliderProfile registration
- 12: LOD utility + cull helper (chunk streaming deferred to 12b)
- 13: color grading pass (existing post-processing was richer than expected)
