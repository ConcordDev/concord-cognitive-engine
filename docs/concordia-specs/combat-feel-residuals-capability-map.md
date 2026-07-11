# Combat/Movement/Game-Feel Residuals — Capability Map (2026-07-11)

Re-verification pass against `docs/POLISH_AUDIT.md`'s remaining open Tier-2/Tier-4
items and the mahjong legacy-route finding, for the 7-part parallel audit. Every
claim below was checked against the working tree at commit `dd988863` (clean,
except one unrelated pre-existing uncommitted edit to
`server/lib/kingdom-decrees.js` that is not part of this pass and was left
untouched), not against doc prose. **No code changes were made in this pass —
every item was already fixed and test-pinned before this audit started.**

---

## Summary table

| Item | Status | Evidence |
|---|---|---|
| T2.4 `CombatMotorBridge` | confirmed-fixed-already | file deleted; doc comment at `page.tsx:454-462` |
| T2.5 `ReflexBridge` | confirmed-fixed-already | file deleted; same comment block |
| T2.6 `AnimationManager.tsx` | confirmed-fixed-already | file deleted; pinned by `feel-consolidation.test.ts` |
| T2.9 shared 250ms cooldown | confirmed-fixed-already | replaced by `lib/combat/attack-cooldown.js`; pinned by `combat-cooldown-per-action.test.js` |
| T2.11 transparent shake div | confirmed-fixed-already | `GameJuice.tsx:288-297` radial-gradient vignette; pinned by `feel-consolidation.test.ts` |
| Tier-4 balance constants | re-verified, one reference stale | see below |
| Mahjong legacy `resolve` route | confirmed-dead-to-UI, documented not deleted | see below |

---

## 1. T2.4 — `CombatMotorBridge` dead code

**Status: confirmed-fixed-already.**

`concord-frontend/components/world/CombatMotorBridge.tsx` no longer exists
(`find` across the repo, excluding `node_modules`, returns nothing; `git log
--diff-filter=D` shows no tracked deletion event under that path either,
consistent with it having been removed before this git history's earliest
retained log for the file — the removal predates the currently-reachable log
window but the file is verifiably gone).

CLAUDE.md's "Convergence sprint invariants" claim ("the two bridges were
RETIRED/removed") is **true and matches code**. `concord-frontend/app/lenses/world/page.tsx:454-462`
carries the removal rationale inline:

```
// (Depth/balance plan D1, 2026-05-29) CombatMotorBridge + ReflexBridge were
// retired here. Both were superseded by ImpactMomentumBridge (mounted in
// CombatBridges/CombatPolishLayer), which runs the live momentum model on
// combat:hit and dispatches the momentum-graded concordia:hit-pause /
// :knockback / :hit-reaction the avatar loop already honours. CombatMotorBridge
// emitted concordia:combat-pose-targets with zero consumers; ReflexBridge
// computed reflexes it never emitted and subscribed the wrong combat:stagger
// (terrain) event. The momentum FUNCTION (computeImpactMomentum) is still live
// via impact-resolver; only the two dead per-frame rAF bridges were removed.
```

No remaining reference to `CombatMotorBridge` anywhere in `concord-frontend/`
except that one explanatory comment. Nothing to fix. POLISH_AUDIT.md's T2.4 row
is itself stale and should be marked done.

## 2. T2.5 — `ReflexBridge` dead code

**Status: confirmed-fixed-already.** Same removal, same comment block, same
verification method as T2.4 — `concord-frontend/components/world/ReflexBridge.tsx`
does not exist; zero remaining references outside the explanatory comment at
`page.tsx:454-462` above.

## 3. T2.6 — `AnimationManager.tsx` (444 LOC) animates nothing

**Status: confirmed-fixed-already — and the CLAUDE.md cross-reference
discrepancy is resolved.**

`concord-frontend/components/world-lens/AnimationManager.tsx` does not exist
(`find` returns nothing outside `node_modules`; the only matches for
"AnimationManager" anywhere in the repo are inside `node_modules/recharts`,
an unrelated charting library file with the same class name).

The CLAUDE.md "Previously-shipped follow-ons" paragraph cites a *different*
file — `concord-frontend/components/world-lens/AnimationManager.tsx` (444 LOC
state machine) — as part of the emote system alongside `EmoteWheel.tsx` (×2)
and mentions it was "mounted in `app/lenses/world/page.tsx`." That claim is
now **stale**: the file was deleted as part of the same T2.6 cleanup, and its
removal is explicitly pinned by a live test:

`concord-frontend/tests/feel-consolidation.test.ts:100-105`:
```js
it('T2.6 — dead AnimationManager is deleted + unmounted', () => {
  expect(() => read('components/world-lens/AnimationManager.tsx')).toThrow();
  const page = read('app/lenses/world/page.tsx');
  expect(page).not.toMatch(/<AnimationManager>/);
  expect(page).not.toMatch(/import\('@\/components\/world-lens\/AnimationManager'\)/);
});
```

Ran `npx vitest run tests/feel-consolidation.test.ts` — **15/15 passing**,
including this assertion. There is no discrepancy left to resolve in code;
CLAUDE.md's emote-system paragraph should be corrected in a docs-only follow-up
(out of scope for this pass — flagged for the orchestrator) to drop the
`AnimationManager.tsx` mention since the animation the emote wheels drive now
flows through the baked-clip / `ImpactMomentumBridge` path, not a standalone
per-frame `setTimeout` state machine.

## 4. T2.9 — shared 250ms attack cooldown drops chained inputs

**Status: confirmed-fixed-already**, and fixed well — this is exactly the
"per-action-type cooldowns / combo window" fix POLISH_AUDIT recommended.

`server/server.js:8712-8728` now imports and uses
`server/lib/combat/attack-cooldown.js` (`newCooldownState` / `checkAttackCooldown`)
instead of a single shared timestamp gate:

```js
// T2.9 — per-action-class cooldown (was a single shared 250ms gate that
// dropped a kick chained after a light, desyncing the client's predicted
// swing). Independent class tracks + a global anti-spam floor.
const _attackCd = _newAttackCooldownState();
socket.on("combat:attack", async (data) => {
  ...
  if (!_checkAttackCooldown(_attackCd, now, data.style || data.actionOverride).allowed) return;
```

`server/lib/combat/attack-cooldown.js` implements independent per-class
cooldowns (`attack-light` 250ms, `attack-heavy` 420ms, `kick` 300ms, `grab`
320ms, all env-overridable — `CONCORD_COMBAT_CD_LIGHT/HEAVY/KICK/GRAB`) plus a
120ms global anti-spam floor (`CONCORD_COMBAT_CD_FLOOR`) so a light→kick combo
lands (separate tracks) while a same-frame dump across every class is still
capped. Pure + total, unit-tested in isolation from the socket layer.

Ran `node --test server/tests/combat-cooldown-per-action.test.js` —
**5/5 passing**, including the exact regression case named in the audit:
"a kick chained after a light LANDS (independent class tracks)." Also ran
`combat-anti-cheat.test.js` (15/15) and `combat-impact-pvp-feel.test.js`
(4/4) alongside it to confirm no regression in the surrounding combat-attack
socket path — all green, 24/24 total.

The old flat `server.js:8188` 250ms reference from POLISH_AUDIT Tier 4 is now
stale (see item 6 below) — the literal no longer exists at that line; the
250ms *default* for the light-attack class survives as
`ATTACK_COOLDOWN_MS["attack-light"]` in the new file.

## 5. T2.11 — GameJuice 2D HUD shake is a transparent div

**Status: confirmed-fixed-already**, with a visible vignette exactly as the
audit's suggested fix specified.

`concord-frontend/components/world-lens/GameJuice.tsx:277-297`:
```jsx
{/* Screen shake overlay. T2.11 — the shaking div used to be fully
    transparent (shaking an invisible element reads as nothing on the 2D
    HUD / reduced-motion path). A red-edge radial vignette scaled by
    opacity makes the impact actually visible while the div shakes. */}
{overlays
  .filter((o) => o.type === 'shake')
  .map((o) => (
    <div
      key={o.id}
      className="pointer-events-none fixed inset-0 z-[9998]"
      style={{
        animation: `shake ${300 * o.opacity}ms ease-in-out`,
        background: `radial-gradient(ellipse at center, transparent 55%, rgba(220,40,40,${(o.opacity * 0.35).toFixed(3)}) 100%)`,
      }}
    />
  ))}
```

Pinned by `feel-consolidation.test.ts` ("T2.11 — GameJuice 2D shake renders a
visible vignette (not a transparent div)"), part of the 15/15 passing run
above. Nothing further to do.

**Bonus finding — T2.2 and T2.3 (adjacent Tier-2 rows, not in the original 7-item
list but covered by the same `feel-consolidation.test.ts` file) are also
already fixed and pinned**, worth noting since they were bundled in the same
consolidation commit:
- T2.2 (no whiff/swing SFX) — `SoundscapeEngine.tsx` has `'combat-swing'` /
  `'combat-swing-heavy'` voices, dispatched from `CombatInputController.tsx`.
- T2.3 (lock-on doesn't move the camera) — `LockOnController.tsx` now uses the
  real `concordia:projector-ready` / `__concordiaProject` pipeline instead of
  the yaw approximation; `ConcordiaScene.tsx` biases `lookAt` toward
  `cameraLookState.lockedTargetPos`.

## 6. Balance constants (Tier 4) — spot-check re-verification

**Status: re-verified, list is accurate with one stale reference.** These are
correctly documented as *intentional* playtest fodder, not bugs — no attempt
was made to "fix" them by guessing better numbers (would be fabricating tuning
data, against the honest-by-construction invariant).

Spot-checked against current code:

| Doc reference | Current reality | Drift |
|---|---|---|
| `CombatInputController.tsx:63` HOLD_THRESHOLD 220ms | `:64` `HOLD_THRESHOLD_MS = 220` | line +1, value unchanged |
| `CombatInputController.tsx:193` DOUBLE_TAP 280ms | `:194` `DOUBLE_TAP_WINDOW_MS = 280` | line +1, value unchanged |
| `CombatInputController.tsx:308-310` baseDamage 18/10 | `:350` `heavy ? 18 : 10`, `:362` `handMul * finisherMul` | lines shifted ~+40 (file grew), values unchanged |
| `combat-impact.js:101` BASE_POISE 13 | `:101` `const BASE_POISE = 13` | exact match |
| `combat-impact.js:50` SWING_ARC 2.4 | `:50` `const SWING_ARC_RAD = 2.4` | exact match |
| `impact-feel.js:33-36` SEVERITY_FEEL table | `:32` `export const SEVERITY_FEEL = Object.freeze({...` | exact match (still "tuned against the old heuristic," not playtested — untouched) |
| `LockOnController.tsx:38-39` radius 25 / cone 60° | `:38` `DEFAULT_LOCK_RADIUS = 25`, `:39` `DEFAULT_CONE_HALF_ANGLE = Math.PI / 3 // 60°` | exact match |
| `server.js:8188` 250ms attack / `:8634` 400ms dodge | **attack literal is gone — superseded by item 4 above** (`attack-cooldown.js` `ATTACK_COOLDOWN_MS["attack-light"]` default 250, env-overridable); dodge cooldown literal still present, now at `server.js:9266` `if (now - _lastDodgeAt < 400) return; // 2.5 dodges/sec cap` | **stale — needs a docs-only correction**, not a code fix |

Triage: **CURATION** (docs-only). The Tier-4 table's `server.js:8188` line
reference should be updated to point at `lib/combat/attack-cooldown.js`
(the attack-cooldown constants moved there and became a richer per-class
table, which is a strict improvement over the flat literal the doc still
describes) and the dodge-cooldown line number bumped to `9266`. No tuning
values were guessed or changed. Left for the orchestrator to fold into a
docs-only edit of `docs/POLISH_AUDIT.md` if desired — out of scope to edit a
PROTECTed-adjacent audit doc unilaterally in this pass.

## 7. Mahjong legacy checkbox route

**Status: confirmed-dead-to-UI, documented but NOT deleted this pass** (per
the task's own guidance: "Only do this if you're fully confident it's
unreachable; if uncertain, just document it" — the evidence below is mixed
enough to warrant documentation over deletion).

**What's confirmed dead:**
- `concord-frontend/components/world/MahjongTable.tsx` (the live, mounted
  mahjong UI — reached via `StationInteractionRouter.tsx`'s `mahjong_table`
  entry) calls only `/api/mahjong/start`, `/api/mahjong/:id/state`,
  `/api/mahjong/:id/discard`, `/api/mahjong/:id/tsumo` — the real 136-tile
  session engine (`server/lib/mahjong/session.js`). It never calls
  `/api/mahjong/resolve`.
- Grepped `concord-frontend/`, `concord-mobile/` for `resolve_hand` /
  `mahjong/resolve` — zero matches outside `server/`. No frontend or mobile
  caller anywhere.

**What's NOT simply dead code, complicating a clean deletion:**
- `server/server.js:51498-51512` (the real, verified tsumo path) itself calls
  `resolveMahjongHand` (via `lib/minigame-resolvers.js`) as the **scoring**
  step, after computing the real yaku list from `detectYaku` (genuine 14-tile
  decomposition against the actual dealt hand) — so the underlying function is
  legitimately load-bearing, not itself fake. Only the *standalone,
  unverified-input* entry points are the residual risk:
  `POST /api/mahjong/resolve` (`server.js:51539-51542`, accepts a
  client-declared `winningHand` array with zero verification against a real
  session) and the `mahjong.resolve_hand` macro
  (`server/domains/minigames.js:28-30`, same unverified pass-through).
- `resolveMahjongHand` is a **pure function with no side effects** — no DB
  write, no XP grant, no currency mint (`server/lib/minigame-resolvers.js:140-161`
  returns only a computed `{score, xpGained, payload}`, never persisted by the
  route itself). Calling the "fake" endpoint directly does not actually credit
  anything real to a player's wallet or profile — it's an inert calculator,
  not an exploitable reward-fabrication path. This meaningfully lowers the
  honesty-invariant risk versus e.g. a fabricated-success write path.
- `server/tests/minigame-resolvers.test.js:114-121` **actively pins**
  `mahjong.resolve_hand` as "wired" (asserts the macro is registered and
  returns `ok:true`) — deleting the macro registration would break this
  intentional, currently-green test, which is a different action than
  removing dead code with no test depending on its continued existence.

Ran `node --test server/tests/minigame-resolvers.test.js` — **confirmed
green** at current HEAD (16 tests covering fishing/photography/karaoke/mahjong
resolvers + macro wiring), so nothing here is currently broken; it's a
reachable-but-UI-unused surface with a test that wants it to keep existing.

**Triage: CURATION / ENGINEERING (deferred, not urgent).** Recommended
follow-up for a future pass (not done here, to stay conservative per
instructions): retire only the two *unverified entry points*
(`POST /api/mahjong/resolve` route + `mahjong.resolve_hand` macro
registration) while keeping `resolveMahjongHand` itself as an internal-only
export consumed by the real tsumo path — and update
`minigame-resolvers.test.js` to test the function directly instead of via the
macro/route, so the pinning moves from "the unverified surface exists" to
"the scoring math is correct." That's a 2-file, well-scoped change with a
test rewrite, appropriate for a dedicated small PR rather than folding into
this audit pass.

---

## What was NOT changed in this pass

No source files were edited. Every one of the 6 code-level items (T2.4, T2.5,
T2.6, T2.9, T2.11, and the mahjong route) was already resolved and
test-covered at commit `dd988863` before this audit began. The only residuals
are two **documentation** drifts (CLAUDE.md's stale `AnimationManager.tsx`
mention in the emote-system paragraph; POLISH_AUDIT.md's stale `server.js:8188`
line reference) and one **deferred, low-priority cleanup** (mahjong's
unverified-input entry points, non-exploitable, test-anchored) — all flagged
above with explicit triage for the orchestrator to action or assign.

## Test results (all runs this pass, all green)

| Suite | Result |
|---|---|
| `concord-frontend` `vitest run tests/feel-consolidation.test.ts` | 15/15 pass |
| `concord-frontend` `vitest run tests/strike-fx-dedup.test.ts` | 8/8 pass |
| `concord-frontend` `vitest run tests/combat-prediction-camera-punch.test.ts` | 5/5 pass |
| `server` `node --test tests/combat-cooldown-per-action.test.js` | 5/5 pass |
| `server` `node --test tests/combat-anti-cheat.test.js` | 15/15 pass |
| `server` `node --test tests/combat-impact-pvp-feel.test.js` | 4/4 pass |
| `server` `node --test tests/minigame-resolvers.test.js` | 16/16 pass |
