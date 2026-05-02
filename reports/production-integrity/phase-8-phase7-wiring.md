# Phase 8 — Phase 7 Module Wiring Report

Date: 2026-04-29
Branch: claude/competitive-parity-master-spec-XAYJ9

---

## Summary

This report documents the Phase 8 wiring pass that connects Phase 7 Concordia
modules to their per-frame/scene-init loops.

---

## Task A — FacialController & SecondaryPhysicsManager (AvatarSystem3D.tsx)

**File:** `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

**Finding:** Both modules were already wired into the per-frame update closure
(`avatarGroup.userData.update`).

- `SecondaryPhysicsManager.update()` is called at line 924 inside the block
  beginning at line 907 ("Secondary physics: hair chain (runs AFTER FABRIK IK)").
- `FacialController.update()` for the player is called at line 942; for NPCs at
  line 952 — both inside the block beginning at line 931 ("Facial blend shapes").

**Result:** Already wired. No changes made.

---

## Task B — SSGI and PCSS Initialization (ConcordiaScene.tsx)

**File:** `concord-frontend/components/world-lens/ConcordiaScene.tsx`

**Finding:** Both effects were already initialized during scene setup.

- **PCSS** (`pcss-shadows`): initialized at lines 362–370 for `quality !== 'low'`.
  Calls `upgradeShadowMap`, `configurePCSSLight`, and `applyPCSSToScene`.
- **SSGI** (`ssgi.ts` / `SSGIPass`): initialized at lines 384–393 for
  `quality === 'ultra'`. Stores the pass in `ssgiPassRef` and calls
  `ssgiPassRef.current.render(null)` in the game loop at lines 444–446.

**Result:** Already wired. No changes made.

---

## Task C — CombatMusicSystem per-frame update (spatial-audio.ts / world page)

**File:** `concord-frontend/app/lenses/world/page.tsx`

**Finding:**
- `CombatMusicSystem` was correctly instantiated on first pointer gesture
  (lines 1261–1278) and `onCombatEvent(1.0)` was called on confirmed hits
  (line 1035).
- **Missing:** `CombatMusicSystem.update(delta, inCombat)` was never called
  per-frame. Without this call the intensity never decays back to 0 and stem
  gains are never adjusted, so the layered music system produced no audible
  output beyond the initial spike.

**Change made:** Added a `useEffect` rAF loop immediately after the init
effect (lines 1281–1301) that calls `combatMusicRef.current.update(delta, inCombat)`
every frame with the live `combatStateRef` as the `inCombat` source.

```
// concord-frontend/app/lenses/world/page.tsx : 1281-1301
useEffect(() => {
  let rafId: number;
  let lastT = performance.now();
  function musicFrame(now: number) {
    const delta = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    const cms = combatMusicRef.current;
    if (cms) {
      const inCombat = !!(combatStateRef.current.target && !combatStateRef.current.isDead);
      cms.update(delta, inCombat);
    }
    rafId = requestAnimationFrame(musicFrame);
  }
  rafId = requestAnimationFrame(musicFrame);
  return () => cancelAnimationFrame(rafId);
}, []);
```

**Verification:** `CombatMusicSystem.update()` now called every frame at
`page.tsx:1293`. Intensity decays to 0 when `inCombat` is false; stems fade
accordingly per `STEM_CURVES`.

---

## Task D — computeWeatherModifiers → character movement speed

**File:** `concord-frontend/lib/world-lens/world-deformation.ts`,
         `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

**Finding:** The pipeline was already complete end-to-end:

1. `WeatherTransitionSystem.update()` is called each frame in `ConcordiaScene.tsx`
   game loop (line 427). It internally calls `computeWeatherModifiers()` and stores
   the result.
2. `getModifiers()` is called immediately after (line 428) and passed to
   `onWeatherModifiers` callback.
3. In `world/page.tsx` line 1473, `onWeatherModifiers={(mods) => setWeatherModifiers(mods)}`
   stores modifiers in React state.
4. `weatherModifiers` is passed as a prop to `AvatarSystem3D` at line 1559.
5. In `AvatarSystem3D.tsx` line 752, `wMods.moveSpeedScale` is applied:
   `const physicsSpeed = baseSpeed * staminaScale * weatherSpeedScale`.

**Result:** Already wired. No changes made.

---

## Task E — ReconciliationBuffer netcode (AvatarSystem3D / world page)

**File:** `concord-frontend/app/lenses/world/page.tsx`

**Finding:**
- `ReconciliationBuffer` was defined in `concord-frontend/lib/concordia/netcode.ts`
  (line 179) and exported, but never instantiated anywhere in the world page.
- The `onMove` handler in the JSX used `seq: 0` (hardcoded) for all delta
  frames — no per-frame sequence tracking.
- `handleMoveNack` did a hard position snap only, with no attempt at re-simulation
  from server-authoritative state.

**Changes made:**

### 1. Import update (line 33)
Added `ReconciliationBuffer` and `ServerStateMsg` to the netcode import:
```ts
import { encodeDelta, ReconciliationBuffer, type CharState, type ServerStateMsg }
  from '@/lib/concordia/netcode';
```

### 2. Refs and lazy factory (lines 787–808)
Added `inputSeqRef` (monotonic sequence counter), `reconRef` (the buffer
instance), and `getRecon()` factory that lazily creates the buffer with a
minimal KCC simulation matching AvatarSystem3D's movement constants:
```ts
const inputSeqRef = useRef(0);
const reconRef = useRef<ReconciliationBuffer | null>(null);
function getRecon(): ReconciliationBuffer { ... }
```

### 3. onMove handler — prediction (lines 1660–1690)
Each `onMove` call now increments `inputSeqRef`, builds a typed `InputFrame`
from the position delta, and calls `getRecon().predict(currentState, inputFrame)`.
The resulting predicted state is used for the delta-compressed `player:move:delta`
emit. Old path (plain `player:move` JSON emit) is preserved unchanged as the
primary transport.

### 4. handleMoveNack — reconciliation (lines 989–1044)
When the server rejects a move, the handler now:
1. Builds a `ServerStateMsg` from `data.prev` and `data.seq`.
2. Calls `reconRef.current.reconcile(serverMsg)` to re-simulate from the
   server-authoritative state using all unacknowledged inputs.
3. Measures the position error. If it is below `ReconciliationBuffer.SNAP_THRESHOLD`
   (5 world units), applies the reconciled position (smooth correction).
4. If the error exceeds the threshold, calls `clearHistory()` and falls back to
   the original hard snap — the old path is preserved as fallback.

**Verification:**
- `ReconciliationBuffer` now instantiated at `page.tsx:788` (lazily via `getRecon()`).
- `predict()` called on every `onMove` at `page.tsx:1683`.
- `reconcile()` called on `player:move:nack` at `page.tsx:1021`.
- `clearHistory()` snap fallback at `page.tsx:1031`.

---

## File Change Summary

| File | Lines changed | Description |
|------|--------------|-------------|
| `concord-frontend/app/lenses/world/page.tsx` | 33 | Added `ReconciliationBuffer`, `ServerStateMsg` to import |
| `concord-frontend/app/lenses/world/page.tsx` | 787–808 | Added `inputSeqRef`, `reconRef`, `getRecon()` factory |
| `concord-frontend/app/lenses/world/page.tsx` | 989–1044 | Rewrote `handleMoveNack` to use `reconcile()` with snap fallback |
| `concord-frontend/app/lenses/world/page.tsx` | 1281–1301 | Added `CombatMusicSystem` per-frame rAF update loop |
| `concord-frontend/app/lenses/world/page.tsx` | 1660–1690 | Updated `onMove` to call `predict()` each move frame |

No changes to `AvatarSystem3D.tsx`, `ConcordiaScene.tsx`, `ssgi.ts`,
`spatial-audio.ts`, or `world-deformation.ts` — those modules were already
wired correctly.
