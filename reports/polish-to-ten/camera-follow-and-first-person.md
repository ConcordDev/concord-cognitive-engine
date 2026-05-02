# Camera Follow + First-Person — Closing the Skyrim Loop

## What was wrong before

The codebase had:
- WASD free-locomotion through Rapier kinematic capsule (decisively Skyrim-style movement)
- A `CameraMode` type with 5 modes (`isometric | follow | free | interior | cinematic`)
- A `CameraControls` UI to switch between them
- A default `cameraMode` state of `'follow'`

But the actual rendered camera in ConcordiaScene was hardcoded:

```ts
// Before
camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 5000);
camera.position.set(200, 150, 200);  // FIXED
camera.lookAt(0, 0, 0);              // FIXED
```

So no matter what mode the player picked, the camera stayed at an isometric overview. The combat / hit reactions / ragdoll / EvoAsset interactions all worked, but the player saw them from a Diablo-like fixed overhead — half-Skyrim, half-Diablo by accident.

## What changed

### `CameraControls.tsx`

`'first-person'` added to the `CameraMode` union. Six modes total now (`isometric | follow | first-person | free | interior | cinematic`). Added a row to the cameraModes UI array with a User-eye icon.

### `app/lenses/world/page.tsx`

- `cameraMode` state union extended with `'first-person'`
- `<ConcordiaScene>` now receives `cameraMode` and `getPlayerPose` props (the latter returns the current `{ x, y, z, yaw }` from `playerAvatar` state — same source the existing combat handlers read from)
- `<AvatarSystem3D>` now receives `cameraMode` so it can hide the own-avatar mesh in first-person

### `ConcordiaScene.tsx`

Three additions:

1. **Per-frame camera transform driven by `cameraMode` + pose.** The init effect captures `cameraMode` and `getPlayerPose` into refs (`cameraModeRef`, `getPlayerPoseRef`) updated by tiny mirror effects so mode changes don't re-run the heavy init. The game loop reads them every frame:

   ```ts
   if (mode === 'first-person') {
     // Camera at head height ~1.6m, looking forward + mouse pitch
     camera.position.set(pose.x, pose.y + 1.6, pose.z);
     camera.lookAt(pose.x + sin(yaw)cos(pitch), eyeY + sin(pitch), pose.z + cos(yaw)cos(pitch));
   } else if (mode === 'follow' || mode === 'interior') {
     // Behind + above the player; lerp toward target for smooth follow
     const dist = mode === 'interior' ? 3 : 6;
     const height = mode === 'interior' ? 1.6 : 3.2;
     // ... yaw + pitch orbit ... lerp(0.125 ish) → camera.position
     camera.lookAt(pose.x, pose.y + 1.4, pose.z);
   }
   // 'isometric' / 'cinematic' / 'free' fall through to the existing path
   ```

   Lerp factor `min(1, delta * 8)` gives ~125ms catch-up — feels Skyrim-like (smoothly trailing) rather than rigid.

2. **Mouse-look via pointer lock.** Click in the canvas → `requestPointerLock()` (only when in a player-tracking mode). Mouse movement reads `e.movementX/Y` and accumulates into `lookRef.current.yaw` / `pitch`. Pitch clamped to ±1.2 rad (~±69°) to prevent over-rotation. Sensitivity `0.0025` rad/px feels reasonable on a typical screen.

3. **Cleanup** removes both event listeners and exits pointer lock on unmount.

### `AvatarSystem3D.tsx`

New `cameraMode` prop; small effect that flips `playerMeshRef.current.visible = false` when `cameraMode === 'first-person'`. Other players + NPCs stay visible — only the local player's body gets hidden so the camera doesn't render the back of its own head.

## Result

| Mode | Behavior |
|---|---|
| **Isometric** | Original fixed overview at (200, 150, 200) — unchanged |
| **Follow** *(default)* | Camera ~6m behind + 3.2m above the player, lerps smoothly. Mouse-look orbits yaw + pitch. **This is the Skyrim third-person feel.** |
| **First-Person** | Camera at player's head (~1.6m), faces direction of yaw + pitch. Own body hidden. **This is the Skyrim first-person feel.** |
| **Interior** | Same logic as follow but tighter (3m behind, 1.6m above) — useful inside buildings |
| **Free** | Existing free-camera path (unchanged) |
| **Cinematic** | Existing cinematic path (unchanged), DoF Pass 13 still triggers |

Click in the canvas to enter pointer-lock. Esc releases. WASD movement still works exactly as before — same `keysRef` + character controller. Combat hits, knockback, death ragdoll, spatial audio, EvoAsset signals all now play out from a camera that actually tracks the action.

## Verification

- `npx tsc --noEmit` — clean (only pre-existing `openNPCDialogue` errors remain)
- `npx eslint` on touched files — clean

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/CameraControls.tsx` | added `'first-person'` to `CameraMode` union + UI row |
| `concord-frontend/components/world-lens/ConcordiaScene.tsx` | new `cameraMode` + `getPlayerPose` props; per-frame camera transform; pointer lock + mouse-look |
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | new `cameraMode` prop; hides own avatar in first-person |
| `concord-frontend/app/lenses/world/page.tsx` | extended `cameraMode` state union; passes camera props to ConcordiaScene + AvatarSystem3D |

## Open follow-ups (small)

- **First-person yaw → player rotation**: in first-person mode, mouse yaw should drive the player's facing direction (so movement aligns with where you're looking). Currently it only rotates the camera additively. Would be ~5 lines in the world page's WASD movement code: when `cameraMode === 'first-person'`, set `playerAvatar.rotation = baseYaw + lookRef.current.yaw` before applying movement vector. Skipped here to keep the diff focused on what was actually missing.
- **Camera collision**: in follow mode, the camera can clip into walls. Add a raycast from player to camera target; if hit, use the hit point. Standard third-person camera trick. Not implemented yet.
- **Sensitivity setting**: `0.0025` is hardcoded. Could be a slider in the settings page (Deferral 5).
