# Concordia — 3D Runtime Health Capability Map

**Scope**: lifecycle bugs, memory leaks, event ordering, and synchronization issues in Concordia's Three.js/React rendering layer — the failure classes a content-quality or wiring audit systematically misses. All findings [STATIC] (source-code analysis; a full-stack runtime session was not tractable given live-Ollama-brain + auth + world-state dependencies, so this is rigorous static analysis, not instrumented profiling — labeled honestly per the task's own instructions).

This audit self-organized into 4 sub-agents covering: (1) Three.js resource disposal + object pools, (2) Rapier3D physics-body lifecycle + Web Audio node lifecycle, (3) socket lifecycle/event ordering/client-server sync, (4) React `useEffect`/lifecycle leaks. Their reports are synthesized below, worst-first.

## Status update (2026-07-12)

**All 15 numbered findings below are now CLOSED.** This audit's own
Summary originally said "no code changes were made... given the scale and
shared/high-traffic nature of the files involved" — a follow-up pass
(mix of dedicated Wave 4 units and standalone fixes, commits below)
subsequently fixed every one of them, including the two the Summary
flagged as highest-risk (#1 effect-thrash, #6/#8 ragdoll leak + dead
player-position global). Verified via `git log`/`git merge-base
--is-ancestor` against this branch before writing this note — each
commit hash below is a real ancestor of HEAD, not a doc claim taken on
faith. Findings are left in place for historical record; only the triage
line under each is updated.

| # | Fix commit(s) |
|---|---|
| 1 (effect-thrash) | `3563714b` |
| 2 (ambient noise leak) | `f7e86bec` |
| 3 (`AudioContext.close()`) | `f7e86bec` |
| 4 (window listeners + EffectComposer) | `1492b380` |
| 5 (procedural building materials) | `a0122dd1` |
| 6 (ragdoll never freed) | `fa16331e`, `1492b380` |
| 7 (building collapse → physics) | `49783550` |
| 8 (`window.__concordiaPlayerPos`) | `f7e86bec` |
| 9 (character-controller race) | `fa16331e` |
| 10 (`GameModesHotbarGroup` leak) | `e2978af9` |
| 11 (6 polling HUDs stale `activeWorldId`) | `6e362f7e` |
| 12 (crafting-minigame cancel-doesn't-cancel) | `ed445e3e` |
| 13 (vehicle-renderer dispose) | `3890d2b9` |
| 14 (`WaterRenderer` texture leak) | `de0980ec` |
| 15 (duplicate `socket.io-client`) | `d7896339` |

The "Lower severity" bullets (TreeLayer instance-pool dispose,
uprising-crowd pole material, horror-tension stem oscillators, procedural
music-layer intervals, `AvatarSystem3D`'s orphan-able subscribe,
un-cleared toast timeouts, `CombatPolishHUD`'s churn, `LegendaryAnnouncement`
key-uniqueness glitch) were **not** re-verified in this pass — no
matching commits were found for them and they remain open, genuinely
lower-priority residuals.

## Critical / High severity — real, confirmed bugs

### 1. AvatarSystem3D + ConcordiaScene: effect-thrash — the two heaviest 3D components fully tear down and rebuild on nearly every render during ordinary movement/combat

The single most consequential finding of this audit. `AvatarSystem3D.tsx`'s ~1,740-line setup effect (mesh/mixer construction, physics character registration, 8 combat/death/knockback listener registrations) depends on `otherPlayers`/`npcs`/`onMove`/`onEmote` — all fresh, non-memoized references on every render of `app/lenses/world/page.tsx` (`npcs={[...worldNPCs,...walkerNpcs,...procgenNpcs]}` is a new array literal every render; `onMove`/`onEmote` are inline closures). `onMove` fires from *inside the effect's own per-frame movement closure* — so: player moves → `onMove` → `setPlayerAvatar` → page re-render → new prop references → effect dependency check fails → full teardown/rebuild — potentially dozens of times per second during sustained movement. No `React.memo` anywhere in the chain.

`ConcordiaScene.tsx` has the same shape, compounded by a feedback loop: its effect depends on `quality`, but the render loop's own FPS auto-downgrade *writes* `quality` from inside that same effect — so sustained low FPS triggers the exact full-teardown "fix" (new WebGLRenderer, new physics world, 5 window listeners re-registered) that itself risks causing another FPS dip.

This is the load-bearing explanation for any reported jank/stutter/flicker in the world lens, and it's a distinct class from "forgot to unmount": it's an unmemoized-props problem at the **parent page's** call site, not inside the 3D components themselves.

Also defeats the correctly-implemented other-player/NPC position interpolation (`INTERPOLATION_RATE=10`) — meshes are newly constructed on every rebuild with `targetPos` initialized to the current value, so the lerp only gets to run in the short window between rebuilds.

**Triage: ENGINEERING.** Fix is memoizing `npcs`/`otherPlayers`/`onMove`/`onEmote` at the page level (`useMemo`/`useCallback`) and decoupling `ConcordiaScene`'s quality-downgrade write from its own effect's read dependency. The codebase already has the correct pattern to copy: `vehicle-renderer.ts#reconcile()` mutates in place for existing entities instead of rebuilding, and `hooks/useRealtimeRefresh.ts` explicitly engineers around this exact footgun via ref-stored callbacks + stabilized dependency arrays.

### 2. `SoundscapeEngine.tsx`: ambient district-noise layer leaks a new infinite looping audio node on every district/time-of-day/interior change — directly audible

In the same effect, the drone oscillator is correctly torn down on every re-run (captures prev refs, ramps to 0, stops) — but the noise layer built a few lines later has no equivalent teardown. Its `AudioBufferSourceNode` (`loop = true`) is a function-local `const`, never stored in any ref/Map, so once the effect finishes there's no handle to stop it — and per the Web Audio spec, a still-looping source with no references is *not* GC-eligible, so it keeps running and audibly layering forever. The effect fires on every district change, every time-of-day tick, and every interior/exterior toggle — all but one of the district audio configs have `noise > 0`. In ordinary play this means the ambient hiss gets progressively louder and grainier over a session — a directly perceptible bug, not just a hidden leak.

**Triage: ENGINEERING.** Store `noiseSource` in a ref alongside the existing `droneOscRef`/`droneGainRef` pattern and apply the identical stop-and-ramp teardown already used for the drone a few lines above.

### 3. `SoundscapeEngine.tsx`: `AudioContext.close()` is never called on unmount

Confirmed by full-file grep — no `.close()` call anywhere, despite a comment claiming a listener "is GC'd when ctx.close() runs on unmount." `SoundscapeEngine` mounts once at the `/lenses/world` route; navigating away unmounts the component but the AudioContext (and everything still connected to it) keeps running silently in the background. Re-entering the world lens creates a fresh `useRef`, so a *second* AudioContext stacks on top of the first — repeated navigation eventually hits the browser's concurrent-context cap (Safari in particular).

**Triage: ENGINEERING.** Add `audioCtxRef.current?.close()` to the existing unmount-cleanup effect, and extend that effect's coverage to the horror-tension stem oscillators (finding 6) and music-layer intervals (finding 7) it currently misses.

### 4. `ConcordiaScene.tsx`: 5 `window` listeners + an entire undisposed WebGL EffectComposer leak on every re-fire of finding #1's churn

4 scene-lifecycle listeners (`terrain-ready`, `buildings-ready`, `avatars-ready`, `scene-request-ready`) carry a `@resource-leak-ok` comment asserting "unmounts the whole canvas, not the listener individually" — contradicted by the effect's own dependency array (inline `onBuildingClick`/`onTerrainClick` props + the `quality` write-back from finding #1), meaning the assumed "rare unmount" is actually a frequent re-fire. A 5th listener's cleanup function (`_dofCleanup`) is stashed on the composer object but never called anywhere (grep-confirmed). Independently: `composerRef.current` — the EffectComposer holding WebGL render targets — is never `.dispose()`'d in cleanup at all, a second compounding GPU-memory leak on the same trigger.

**Triage: ENGINEERING.** Remove all 5 listeners (and dispose the composer) in the cleanup path; the suppression comment's premise needs correcting, not the listener registration itself.

### 5. Procedural building materials/textures — the path most real buildings render through — leak unbounded, permanently, at module scope

`procedural-buildings.ts#getMaterial()` caches by a key that includes `hashSeed('pbr:' + dtu.id)` — unique per building, despite the file's own header comment claiming "shared materials per archetype." Each cache miss mints ~8 CanvasTextures (albedo/normal/roughness/ao per wall+roof slot) that live in a **module-level** Map — surviving page navigation and world-unmount. Both the intended teardown functions (`disposeBuildingArchetype()`, `clearProceduralCache()`) are fully implemented and explicitly documented as needing to be called on world unmount — grep confirms neither is ever called anywhere outside its own tests. Every unique building ever rendered across the session's lifetime permanently retains its textures.

**Triage: ENGINEERING.** Wire `disposeBuildingArchetype()`/`clearProceduralCache()` into `ConcordiaScene`'s existing (already-thorough) unmount cleanup path.

### 6. Ragdoll physics bodies are never freed — a method-name drift bug, not a design gap

`ragdoll-bridge.ts` calls `physicsWorld.despawnRagdoll(id)` at both its 10s decay timeout and its 32-ragdoll-cap eviction — but `physics-world.ts` has no method by that name; the real method is `removeRagdoll`. Because the call is optional-chained (`?.()`, silent no-op on undefined), this never throws and never surfaces. Every lethal hit spawns 7 dynamic RigidBodies + 6 joints that are never freed. Compounded by two amplifiers: (a) `spawnRagdoll` unconditionally overwrites the tracking Map entry for a reused id, so a second call for the same target orphans the first 7 bodies completely untracked; (b) `ConcordiaScene`'s `attachRagdollBridge` detach function is stashed but never invoked in the scene's teardown, so each world/district switch re-attaches a duplicate `window` listener for the kill event — after a few switches, a single kill can leak a multiple of 7 bodies in one event. Worth noting as a positive contrast: a *separate*, correctly-implemented 16-bone ragdoll system exists in the same codebase (`lib/combat/ragdoll.ts`) with a working eviction-that-actually-disposes pattern — proving this is a regression, not a missing capability.

**Triage: ENGINEERING.** Rename the call site to `removeRagdoll` (or add the missing method), guard `spawnRagdoll` against overwriting a live entry, and wire the ragdoll-bridge detach into `ConcordiaScene`'s teardown.

### 7. Building collapse has full visual/audio wiring but zero physics-side consumer — a real, player-visible client/server desync

The backend correctly transitions building state (`applyStructuralStress`: standing→damaged→collapsed) and broadcasts `world:building-state`. Client-side, `removeBuildingCollider`/`removeBuilding` exist and are implemented correctly — but a repo-wide grep confirms `removeBuilding` has no caller anywhere. The only real consumers of the collapse event are purely presentational (`BuildingWearLayer`'s scar decals, `BuildingCollapseVFX`'s screen-space dust burst) — neither touches the actual building mesh or its physics collider. Net effect: a player can see a building visually collapse into rubble VFX and then walk into an invisible wall exactly where it stood, for the rest of the session.

**Triage: ENGINEERING.** Wire the `world:building-state`→`collapsed` handler to call the already-correct `removeBuilding`.

### 8. `window.__concordiaPlayerPos` is read by 9+ production files, written by none — a permanently dead global with real gameplay consequences

Grep across all files and full git history: assignment exists only in test stubs. The component every comment credits as "the writer" (`AvatarSystem3D`) keeps position purely in an internal ref, never publishes to `window`. This isn't a startup race (the value never becomes available at any point) — every consumer's code is written as if tolerating a brief mount-time race, but it never resolves. Consequences split three ways: **fails closed** — `DangerBandHUD` always computes from world origin, `ExtractionRunHUD`'s nearest-zone computation never runs so **the Extract button can never become enabled through this HUD**, `PowerClusterLayer` proximity pickups never fire, `LensStationPrompt` (confirmed live-mounted) never surfaces its building-approach prompt, `vehicle-renderer.ts`'s mount prompt never appears; **fails open** — `NPCSchemeOverhearTip` explicitly bypasses its own 30m earshot gate when position is null (the file's own comment acknowledges the tradeoff), so scheme-overhear toasts fire regardless of distance; **degrades silently** — `WorldMarkers` distance-fade can't discriminate near/far, `ChatSystem` proximity chat always queries world origin. A parallel channel (`HUDContextProvider`'s Zustand `setPlayerPosition` action) is *also* never called anywhere — confirming AvatarSystem3D's real position is never published through either mechanism other components were built to consume it from.

**Triage: ENGINEERING.** Publish `playerPositionRef`'s value to `window.__concordiaPlayerPos` (or better, the Zustand `setPlayerPosition` action) on each frame update from `AvatarSystem3D`.

### 9. Player physics character-controller registration is a one-shot, unretried race against async Rapier WASM init

`createCharacterController('player')` is called exactly once anywhere in the codebase, gated only by a synchronous non-null check, no retry, no ready-event listener. If the race is lost, `moveCharacter` silently returns the uncollided translation forever for that session — the player falls through terrain/buildings with zero physics resolution and no self-heal. `ConcordiaScene` has a genuinely good request/response ready-event pattern (`concordia:scene-request-ready`) elsewhere in the same file that this code path doesn't reuse.

**Triage: ENGINEERING.** Adopt the existing ready-event pattern for physics-controller registration instead of a one-shot synchronous check.

### 10. `GameModesHotbarGroup.tsx`: permanent unbounded `window` listener leak via `useState`-as-`useEffect` misuse

`useState(() => { addEventListener(...); return () => removeEventListener(...); })` — this is `useState`, not `useEffect`; the initializer's return value becomes component state, and the cleanup function is silently discarded, never invoked. Every remount of this persistent hotbar component (world-lens re-entry, key change, parent churn) permanently adds one more `window` listener that accumulates for the rest of the session.

**Triage: ENGINEERING.** Trivial fix — change `useState` to `useEffect`.

### 11. Six polling HUDs cache `activeWorldId` once at mount, never react to same-tab world travel

`DangerBandHUD`, `ExtractionRunHUD`, `TimeLoopHUD`, `DriftAlertToast`, `FootprintLayer`, `LensStationPrompt` all read `localStorage.getItem('concordia:activeWorldId')` in a `[]`-dependency effect. This is a known, *already-fixed-elsewhere* bug class in this exact codebase — `hooks/useActiveWorldId.ts` exists specifically for it (its own doc comment names the bug: "HUDs that read it once on mount went stale on world travel inside the SAME tab"), and two sibling components already migrated. These six didn't, and none of their mount points carry `key={worldId}`, so they're not remounted on in-app travel — a live bug affecting anyone who uses portals/Concord Link/fast-travel without leaving `/lenses/world` entirely.

**Triage: ENGINEERING.** Migrate all six to the existing `useActiveWorldId()` hook — a clean, low-risk, mechanical fix since the correct pattern already exists in-repo.

## Medium severity

### 12. Three crafting minigames: cancel doesn't cancel — a stale `setTimeout` still fires a real backend mutation after the player cancels

`GatheringMinigame`, `CraftingMinigame`, `ButcheringMinigame` all schedule `onComplete` (a real backend-mutating callback, e.g. wired to `POST /api/world/creature/:corpseId/butcher`) via a 700–900ms `setTimeout` after the final click — with the cancel/close button remaining clickable throughout that window, not gated on completion state. Cancelling (or otherwise unmounting) in that window doesn't stop the pending timeout, so a real gather/craft/butcher action completes after the player explicitly declined it. The one finding in this whole audit with a genuine economic/gameplay consequence rather than a harmless no-op.

**Triage: ENGINEERING.**

### 13. Vehicle renderer is the one outlier among 7 sibling polling renderers that doesn't dispose per-entity on despawn

`vehicle-renderer.ts#reconcile()` only detaches+drops the map entry on vehicle despawn, never disposing geometry/material — full dispose only happens on renderer teardown. Every sibling (resource-node, crop-field, claim-boundary, construction-progress, corpse-mesh, uprising-crowd, water-grid renderers) calls a `disposeX()` helper on both per-entity-despawn AND full-teardown. Vehicles are multi-mesh (body/hull/wheels/wings) so repeated spawn/despawn churn leaks real GPU memory.

**Triage: ENGINEERING.**

### 14. `WaterRenderer.tsx` leaks a shader-uniform-bound normal-map texture on every rebuild

The 512×512 `DataTexture` is a custom `ShaderMaterial` uniform, not a standard `.map`/`.normalMap` property — the file's generic geometry/material dispose traverse never reaches it. Rebuilds on every `timeOfDay` tick (continuously advancing).

**Triage: ENGINEERING.**

### 15. Duplicate, untyped second `socket.io-client` connection in `HUDContextProvider`

Spun up because `'world:clock'` isn't in the app's typed `SocketEvent` union — a developer bypassed the shared `getSocket()` singleton rather than extending the union. Listener matching and unmount-race handling are both correct within this file, but the second connection doesn't share the primary socket's reconnect backoff/grace-period/dedup logic, and doesn't pass explicit auth (works via same-origin cookie incidentally, would degrade under a genuinely cross-origin deploy). Low blast radius — mounted once at the world-lens root, not per-component.

**Triage: ENGINEERING.**

## Lower severity

- **`TreeLayer.tsx`** — LEAK-LIKELY (not fully confirmed): an `InstancedMesh` pool's own `.dispose()` (which correctly frees the instance-matrix buffer) is never called; the generic geometry/material traverse doesn't reach it.
- **`uprising-crowd-renderer.ts`** — a shared pole material is created per crowd but never disposed (bannerMat is, poleMat isn't) — leaks one `MeshStandardMaterial` per uprising eruption/resolution cycle.
- **`blood-decal.ts`/`footstep-dust.ts`** — a one-time shared texture per driver mount is never disposed; bounded, negligible (mount-time-only, not per-spawn).
- **Horror-tension stem oscillators** (`SoundscapeEngine.tsx`) — correctly torn down on a state-transition back to 'calm', but not on component unmount mid-session — same root cause as finding #3.
- **Procedural music layer's `setInterval` timers** — correctly cleared on district switch, but not on unmount — same root cause as finding #3, lower severity since each individual note-oscillator it spawns is still self-cleaning.
- **`AvatarSystem3D`'s `npc:activity-batch` subscribe** — can be orphaned if the parent effect (finding #1) tears down mid-dynamic-import, before the subscription resolves.
- **~11 un-cleared toast-dismissal `setTimeout`s** across various world/concordia HUD components — harmless in React 19, which silently no-ops a post-unmount `setState`.
- **`CombatPolishHUD.tsx`** — a smaller instance of the finding-1-3 churn family (its rocked-countdown interval includes its own setter's target in the effect's dependency array, so it tears down/rebuilds every ~100ms while the player is rocked). Worth a look if pursuing a broader churn cleanup, not urgent on its own.
- **`LegendaryAnnouncement.tsx`** — a render-scope counter reset every render breaks `AnimationPresence` key uniqueness for back-to-back announcements; cosmetic glitch only.

## Positive findings (checked, not assumed clean)

Object-pool reuse correctness was specifically checked and found sound: `instanced-mesh-pool.ts#add()` always fully recomposes the transform matrix on reuse (no partial-field staleness), and `blood-decal.ts`/`footstep-dust.ts` build fresh objects per spawn rather than reusing stale fields. `physicsWorld.destroy()` on world/district switch correctly frees the entire Rapier world via `world.free()` — no cross-world body accumulation. NPCs have zero client-side Rapier presence by design (server-authoritative collision), which is a legitimate architecture choice, not a gap. `lib/realtime/socket.ts#subscribe()` uses the correct closure-reference pattern for on/off matching. `CombatBridges.tsx` (802 LOC, all 9 subscribe/off pairs) is a clean reference implementation. `SkyWeatherRenderer.tsx` correctly disposes `.map` on cleanup — the reference pattern the buggy building/water renderers should copy. The weather-hiss audio loop is created once (guarded), muted rather than recreated on weather change, and correctly stopped on unmount. `CombatMotorBridge.tsx`/`ReflexBridge.tsx`/`AnimationManager.tsx` are confirmed genuinely deleted (not merely orphaned) — CLAUDE.md's "retired in D1" claim is verified true by two independent Glob searches.

## Summary

~~No code changes were made during this audit — findings are documented,
not fixed...~~ **Superseded — see "Status update (2026-07-12)" at the top
of this doc.** All 15 numbered findings are now closed by a follow-up fix
pass across `AvatarSystem3D.tsx`, `ConcordiaScene.tsx`,
`SoundscapeEngine.tsx`, and `physics-world.ts`, in the priority order this
Summary originally recommended (effect-thrash first, then the ragdoll/
player-position pair, then the mechanical fixes). Only the "Lower
severity" bullets remain open. All findings were triaged ENGINEERING —
this failure class was entirely internal-engineering, no external data
dependency, which is exactly why a mechanical fix-pass was tractable
without new research.
