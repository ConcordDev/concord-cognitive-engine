# Deferrals 2 & 3 — Mesh Collider + Level-Up Juice

Two half-day deferrals batched into one commit since both are pure wiring of existing infrastructure.

---

## Deferral 2 — Mesh-collider profile

### What changed

`physicsWorld.syncFromScene` previously fell back to AABB box for `colliderProfile: 'mesh'`. Added `_registerTrimeshFromObject(obj, entityId)` that:

1. Traverses the subtree, finds the first child with a `BufferGeometry`
2. Bakes vertex positions to world space (multiplies by `child.matrixWorld`) so the trimesh is correctly placed
3. Extracts indices (or fabricates sequential indices for non-indexed geometry)
4. **Caps at 5000 triangles per collider** — meshes larger than that fall back to AABB box and log a warning, since trimesh is the heaviest shape Rapier supports
5. Creates a fixed Rapier rigidbody at world origin (positions are pre-baked) with `ColliderDesc.trimesh(positions, indices)`

Static-only (Rapier doesn't support trimesh on dynamic bodies). Idempotent via the existing `userData.physicsKey` guard.

### Usage

```ts
treeMesh.userData.colliderProfile = 'mesh'; // exact mesh shape
scene.add(treeMesh);
physicsWorld.syncFromScene(scene); // registers trimesh
```

For meshes the player can interact with at close range (statues, complex terrain features, large detailed walls) — exact-shape collision matters. For most props, the cheaper `'box'` or `'capsule'` profiles are still the right call.

### Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/world-lens/physics-world.ts` | added `_registerTrimeshFromObject` and wired it to the `'mesh'` case in `syncFromScene` |

---

## Deferral 3 — Level-up + DTU-validated GameJuice

### Pre-implementation discovery

`'quality:approved'` is **already in the SocketEvent union** at `lib/realtime/socket.ts:172`. Server already emits it from the existing quality-promotion flow. So that half is just adding a frontend listener.

`awardXP` already returns `rankUp: true` when crossing a tier — but it never emits anywhere. Server-side fix needed: a thin emit hook that lets server.js wire `emitToUser` after auth.

### What changed

**Server-side (`server/lib/world-progression.js`):**
- New `attachXPEmitter(emitToUser)` export sets a module-local `_xpEmitter`
- `awardXP` fires `level:up` with `{ newRank, title, totalXP, xpAwarded, action }` to the user room when `rankUp` is true
- Wrapped in try/catch — realtime push never blocks the XP write

**Server bootstrapping (`server/server.js`):**
- After mounting the parties router, dynamically imports `world-progression.js` and calls `attachXPEmitter(emitToUser)`. ESM top-level await; best-effort.

**Frontend (`concord-frontend/components/world-lens/LevelUpJuiceBridge.tsx` — new):**
- Subscribes to `'level:up'` and `'quality:approved'`
- On `level:up`: toast (`Level up! ${title} (rank ${newRank})`) + `concordia:game-juice` with `trigger: 'milestone'` (fanfare-short SFX + visual)
- On `quality:approved`: `concordia:game-juice` with `trigger: 'validate-pass'` (ascending-chime SFX)
- Returns null. Mounted next to GameJuice in `world/page.tsx`.

### Files touched

| File | Action |
|---|---|
| `server/lib/world-progression.js` | new `attachXPEmitter` + `level:up` emit on rankUp |
| `server/server.js` | wires `attachXPEmitter(emitToUser)` after parties mount |
| `concord-frontend/lib/realtime/socket.ts` | extended SocketEvent union with `'level:up'` |
| `concord-frontend/components/world-lens/LevelUpJuiceBridge.tsx` | created — bridges 2 socket events to GameJuice triggers |
| `concord-frontend/app/lenses/world/page.tsx` | mounts `<LevelUpJuiceBridge />` next to `<GameJuice>` |

### Why a separate component instead of subscribing inside GameJuice

GameJuice is a context provider — putting socket subscriptions inside it would tangle realtime concerns with the visual/audio dispatch contract. The bridge component composes cleanly: GameJuice stays focused on rendering overlays, the bridge is a one-purpose adapter from socket → window event.

### Verification

- `node --check server.js lib/world-progression.js` — clean
- `npx tsc --noEmit` — no new errors
- `npx eslint components/world-lens/LevelUpJuiceBridge.tsx lib/realtime/socket.ts` — clean
- Manual (Wave 1 review): cross a rank threshold via test data → toast appears + fanfare-short SFX + milestone overlay; trigger `quality:approved` from the existing quality flow → ascending-chime SFX.
