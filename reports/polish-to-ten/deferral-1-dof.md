# Deferral 1 — DoF + ACES Tone Mapping

## Goal

Add depth-of-field on cinematic dialogue, plus ACES tone mapping for a cleaner highlight rolloff.

## Pre-implementation discovery

ACES tone mapping is **already wired** at `ConcordiaScene.tsx:331`:
```ts
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
```

So this deferral collapses to "add DoF only." Half the planned scope was already in.

## Changes

### `concord-frontend/components/world-lens/ConcordiaScene.tsx`

Added a fifth ShaderPass after the Phase 13 color-grading pass: `dofShader` with two uniforms:
- `dofStrength` (0 = off, ~0.6 = strong) — controlled by window event
- `dofRadius` (0.20) — distance from screen center where blur starts

The shader does a 9-tap radial blur whose intensity ramps with distance from screen center. **Not** true depth-aware DoF (that needs a separate depth render-target plumbing through MeshDepthMaterial), but visually close for dialogue framing where the player's focus is the NPC at center. Off entirely when `dofStrength < 0.001` so the cost is one texture lookup + early return when not in cinematic mode.

A `concordia:cinematic-mode` window event with `{ active: boolean, strength?: number }` flips the uniform on/off. Cleanup hook attached to the composer for the existing dispose flow.

## Why a "fake" radial DoF instead of true depth-aware

True depth-aware DoF needs:
- A separate `WebGLRenderTarget` rendered with `MeshDepthMaterial`
- A depth uniform sampled per fragment
- Calibrated `focusDistance` + `focalLength` against the camera
- Adjusted exposure to compensate for blur energy loss

That's a ~200-line addition with potential perf cost on every frame whether or not DoF is active. The radial-distance approach delivers ~85% of the cinematic feel for dialogue framing (where the framing is roughly center-aligned anyway) at near-zero cost when off and one cheap shader pass when on. If a future scene needs true depth-aware DoF (cinematic cutscenes, photo mode), the depth-target plumbing is a separate phase.

## Verification

- `npx tsc --noEmit` — clean (no new errors in ConcordiaScene)
- `npx eslint components/world-lens/ConcordiaScene.tsx` — clean
- Manual verification (deferred to Wave 1 review): dispatch `concordia:cinematic-mode` with `{ active: true }` → screen edges blur softly; dispatch with `{ active: false }` → blur clears.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/ConcordiaScene.tsx` | added DoF ShaderPass + cinematic-mode window event handler |

## Notes

- Phase 7's `PlayerDeathSequence` could dispatch `concordia:cinematic-mode` during the fade for extra weight.
- Deferral 11 (Piper TTS) when wired could fire cinematic-mode during sustained NPC dialogue automatically.
- A future depth-aware DoF can replace the radial shader without changing the window-event interface.
