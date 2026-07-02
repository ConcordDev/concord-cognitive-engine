# Concord Cognitive Engine — Wiring-Integrity Audit

Date: 2026-06-26 · Working dir: `/home/user/concord-cognitive-engine`

---

## ⚠ ROOT-CAUSE NOTE — static grep cannot adjudicate event wiring in this codebase (read first)

**Every "OPEN" event-wiring finding that survived to the 2026-07-02 truth pass was STALE — the grep method, not the code, was broken.** Two abstraction patterns defeat naive raw-string search:

1. **Socket events are subscribed via a data array + a `subscribe(evt.name, …)` loop**, not via literal `socket.on('event-name', …)` at each site. `concord-frontend/components/world/EmergentEventFeed.tsx` holds a `TRACKED_EVENTS` array (~lines 106-114) and subscribes each entry through `subscribe(evt.name, …)` (~line 204). The event names ARE raw strings — but in the array, not at the subscribe call. A grep of the `subscribe(` call site finds a *variable* and wrongly concludes "0 references."
2. **CustomEvents dispatch/listen through a shared `const` name.** e.g. `concordia:hud-settings-changed` flows through `HUD_SETTINGS_CHANGED_EVENT` in `lib/concordia/hud-settings.ts`, so neither `dispatchEvent('concordia:hud-settings-changed')` nor `addEventListener('concordia:hud-settings-changed')` appears as a literal — the string exists once, in the const definition.

**Consequence that nearly caused a regression:** the prior remediation for the "9 orphan emits" was *"candidate to remove the emit."* Executing it would have **blanked live rows of the Emergent Feed HUD** (a player-visible gameplay surface) — a real regression born entirely from a grep false-negative. **The correct action was always a doc fix, never a code change.**

**Rule for future audits:** do NOT adjudicate event wiring by raw-string grep. Either (a) trace the abstraction (find the data array / shared const and follow it), or (b) run the runtime detector `server/lib/detectors/dead-event-listener-detector.js` (`node server/scripts/run-detectors.js` from repo root) which understands the dispatch/listen graph. As of this pass that detector reports **0** dead listeners for all 12 `concordia:*` events below.

---

## Reconciliation pass — 2026-07-02

The MMO/RPG fixed-defect ledger (CLAUDE.md) claims several items below were
closed. Re-verified each against the current tree (grep + read). Ground-truth
verdicts (statuses in the tables/sections that follow updated to match):

| Item | Verdict | Evidence |
|---|---|---|
| Unknown-macro LLM fallthrough (P0 / §5 / #3/#25/#27) | ✅ **CONFIRMED-FIXED** | `server/server.js:39341-39365` — dispatcher now FAILS FAST with `{ok:false,error:"unknown_macro"}` by default; the utility-brain path is behind an EXPLICIT opt-in (`input.__ai===true` / `ai:true`). A plain game-macro call can no longer be masked as a brain success. |
| Phantom `player:low-health` listener (P1 / §3b) | ✅ **CONFIRMED-FIXED** | Now emitted server-side: `server/routes/worlds.js:3216` (`io.to('user:'+userId).emit("player:low-health", …)`). The listener is no longer phantom. |
| `maintenance-gates` malformed critical (P1 / §2) | ✅ **CONFIRMED-FIXED** | `server/lib/detectors/maintenance-gates-detector.js:32-46` — `gateFinding` now emits the canonical `{id,severity,kind,message,location}` shape (was `{title,detail,file}` → rendered `undefined — undefined`). |
| CharacterCustomizer fabricated wardrobe (P2 / §7) | ✅ **CONFIRMED-FIXED** | Real backend catalog macro `appearance.options` at `server/domains/appearance.js:265` (no fabricated prices); the component fetches it via `lensRun('appearance','options',…)` at `concord-frontend/components/world/CharacterCustomizer.tsx:88` with real loading/error states. |
| Combat-feel *consolidation* seams | ✅ **CONFIRMED-FIXED (partial bundle)** | T2.7 single trauma authority + T2.10 cancel window + #8 motion tokens are pinned by `concord-frontend/tests/feel-consolidation.test.ts`; PvP `combat:impact` is emitted at `server/server.js:8948`. |
| Combat-feel *micro-seams* T2.2/T2.3/T2.6/T2.11 | ✅ **CONFIRMED-FIXED + PINNED (2026-07-02)** — the prior "NOT covered / remain OPEN" line was FALSE | `concord-frontend/tests/feel-consolidation.test.ts:78-111` has a describe block literally titled `'Chunk-1 combat polish (T2.2/T2.3/T2.6/T2.11)'` pinning all four. T2.1 fixed-in-code (light-hit hitstop 35ms, `GameJuice.tsx:168-176`), lightly pinned. T2.9 per-action cooldown fixed + pinned by `server/tests/combat-cooldown-per-action.test.js`. T2.12 (0 recorded audio, 100% oscillator synth) is a **design choice** (procedural audio), not a wiring defect. See §6. |
| 9 orphan socket EMITS (P1 / §3a) | ✅ **CONSUMED-VIA-ABSTRACTION (2026-07-02)** — NOT orphaned; **do NOT remove the emits** | All 9 are subscribed by `EmergentEventFeed.tsx` (`TRACKED_EVENTS` ~106-114 → `subscribe(evt.name,…)` ~204), which is MOUNTED in `app/lenses/world/page.tsx` + `app/hud/[name]/page.tsx`. The "0 raw-string references" verdict was a grep false-negative (names live in a data array, subscribed via a variable). `emit-subscribe-pairing.test.js` records `world:broadcast` + `world:loot-node` were removed from the dead-emit baseline 2026-06-26 with the note they now have real subscribers. **⚠ Removing any emit would blank a live Emergent Feed HUD row — a gameplay-visible regression.** |
| 12 dead `concordia:*` CustomEvents (P1 / §3b-detector) | ✅ **ALL RESOLVED (2026-07-02)** | 6 are CONSUMED (real dispatch→listener pairs); the other 6 had their dead dispatch **already DELETED** (only explanatory comments remain). Runtime detector `dead-event-listener-detector.js` reports **0**. See §3b-detector for the per-event file:line breakdown. |

---

## Prioritized summary (fix-order)

| Pri | Finding | Where | Status |
|---|---|---|---|
| **P0** | **Unknown-macro silently answered by LLM (HTTP 200).** `/api/lens/run` falls through to the utility brain on any unregistered `(domain,name)`. When the brain answers it returns **200 `{source:"utility-brain"}`** — a typo'd / never-registered macro looks like a real result instead of an error. Only on brain failure/timeout does it return the honest `unknown_macro`. | `server/server.js:39341-39365` | ✅ **CONFIRMED-FIXED (2026-07-02)** — now fails fast with `unknown_macro`; brain only on explicit `__ai` opt-in |
| **P1** | ~~**9 backend socket emits with ZERO frontend listeners**~~ (all 9 are CONSUMED-VIA-ABSTRACTION): `world:npc-spared`, `world:node-update`, `mount:behavior`, `world:npc-bark`, `world:npc-attack`, `world:loot-node`, `world:broadcast`, `world:racing-started`, `world:basketball-started`. | see §3 table | ✅ **CONSUMED-VIA-ABSTRACTION (2026-07-02)** — subscribed by `EmergentEventFeed.tsx` (`TRACKED_EVENTS` array → `subscribe(evt.name,…)`), mounted in world + HUD pages. ⚠ **Do NOT remove the emits** — the old "candidate to remove" remediation would blank a live HUD feed row. |
| **P1** | **1 phantom subscribed socket event** (listener with no emitter): `player:low-health` subscribed in the world page SR-bridge but never emitted by the backend. | listener `world/page.tsx:3620`; emitter now `server/routes/worlds.js:3216` | ✅ **CONFIRMED-FIXED (2026-07-02)** — backend now emits `player:low-health` |
| **P1** | ~~**12 dead `concordia:*` CustomEvent dispatches**~~ — all RESOLVED: 6 have real listeners (dispatch→listener pairs, several via a shared `const` name), 6 had their dead dispatch already DELETED (comment-only). | see §3b-detector | ✅ **ALL RESOLVED (2026-07-02)** — runtime `dead-event-listener-detector` reports 0 |
| **P1** | **1 CRITICAL detector finding** `maintenance-gates` returns a malformed `undefined/undefined` critical — the gate itself is emitting a broken finding object (cannot tell which gate failed). | `server/lib/detectors/maintenance-gates-detector.js:32-46` | ✅ **CONFIRMED-FIXED (2026-07-02)** — canonical `{id,message,location}` finding shape |
| **P2** | **Placeholder data in a MOUNTED component.** `CharacterCustomizer` fabricates all cosmetic slot options client-side (`generateSlotOptions`, placeholder colors/prices); no backend fetch. Mounted in onboarding + HUD panel. | catalog `server/domains/appearance.js:265`; fetch `CharacterCustomizer.tsx:88` | ✅ **CONFIRMED-FIXED (2026-07-02)** — real `appearance.options` catalog, fetched via `lensRun` |
| info | Lens wiring clean: 258 WIRED / 2 by-design NO-BACKEND-CALL / 0 PARTIAL / 0 broken. | — | OK |
| info | Frontend→macro callers: only 11 unmatched pairs, all `personas.*`, all **false positives** (aliased at runtime). No caller points at a truly nonexistent macro. | §4 | OK |
| — | Large preexisting backlog in PLAYTEST_FINDINGS_PLAN + POLISH_AUDIT — enumerated in §6. | §6 | mixed |

The macro/lens *coverage* layer is healthy (every lens reaches a backend; no caller hits a missing domain). **Update 2026-07-02:** the two items that once read as "the real wiring rot" both closed — (a) the unknown-macro LLM-fallthrough is FIXED (fail-fast `unknown_macro`, brain behind explicit `__ai` opt-in), and (b) the socket/CustomEvent "name drift" was largely a **grep artifact**: the 9 "orphan emits" are consumed via an abstraction and the 12 "dead dispatches" are all resolved (6 consumed, 6 deleted). The one genuine phantom (`player:low-health`) was given a real emitter. Net: no live wiring defect remains from this audit — see the ROOT-CAUSE NOTE above for why the stale verdicts survived so long.

---

## 1. Lens wiring — `node scripts/verify-lens-backends.mjs`

```
macro domains registered: 512  route prefixes: 2976
verdicts: {"WIRED":258,"NO-BACKEND-CALL":2} total 260

NO-BACKEND-CALL  narrative-walk
NO-BACKEND-CALL  ux-suite
```

- **258 WIRED**, **0 PARTIAL**, **0 broken**.
- The 2 NO-BACKEND-CALL lenses are by-design: `ux-suite` (navigation directory page) and `narrative-walk` (self-contained authored-narrative reader). Both have no API surface of their own. (Matches CLAUDE.md, modulo the doc still listing only `ux-suite` in one spot — minor doc drift, see PLAYTEST #S2.)

---

## 2. Detectors — `cd server && node scripts/run-detectors.js`

Total findings: **85** — critical **1**, high **0**, medium **40**, low **15**, info **29**.

> Note: run from `server/` cwd, `better-sqlite3` did not resolve, so the two db-backed detectors (`dtu-lineage`, `concordia-substrate`) reported `no_db` and contributed 0. Run from repo root to exercise them.

### Critical / high findings

| Sev | Consumer | Title | Detail |
|---|---|---|---|
| 🛑 critical | `maintenance-gates` | `undefined` | **✅ CONFIRMED-FIXED (2026-07-02).** The malformed shape was the bug itself: `gateFinding` emitted `{title,detail,file}` which the renderer read as `undefined — undefined`. It now emits the canonical `{id,severity,kind,message,location}` (`server/lib/detectors/maintenance-gates-detector.js:32-46`), so a failing gate names itself (`"<gate> gate failed — <message>"`). A malformed critical can no longer hide a real one. |
| (high) | — | _none_ | 0 high findings. |

### Notable non-critical findings relevant to wiring

- `dead-event-listener` — see §3b-detector. **Note (2026-07-02):** the 12 `concordia:*` events this once flagged are all RESOLVED (6 consumed, 6 dispatch-deleted); a current repo-root run of the runtime detector reports **0** for this class. The 12-medium count above is from the stale 2026-06-26 run.
- `lens-health` (info): `lens world calls domain "mainland" — no dedicated handler; routes via utility-brain AI catch-all` at `concord-frontend/app/lenses/world/page.tsx:5544`. **Verified FALSE POSITIVE** — `domain: 'mainland'` there is a data field on a quest object, not a `lensRun` macro call. (Heuristic misfire; not a dead wire.)
- `macro-usage` (info): `839 macros · 0 dead · ... Open dispatcher detected — all macros reachable via server/routes/domain.js:225`. The open-dispatcher (`mainland`/utility-brain catch-all) is exactly what makes dead-macro detection hard and is the root of the P0 finding.
- `command-injection` (1 medium): `execSync()` on a non-literal command at `scripts/repair-surgeon.js:113` (tooling script, not server runtime).
- `ux-route-empty-render` (6 medium): pages returning `null` with no loading/empty guard — `quantum/page.tsx:147,151`, `reasoning/traces/page.tsx:164`, `social/post/[postId]/page.tsx:31`, `spectate/[worldId]/page.tsx:85`, `ux-suite/page.tsx:136`.
- `resource-leak` (11 medium), `env-config-drift` (9 medium), `performance-hotspot` (15 low), `secret-leak` (1), `fake-data` (5 info) — none wiring-critical.

---

## 3. Dead socket events (caller-without-receiver / receiver-without-caller)

Method (2026-06-26, since SUPERSEDED): collected backend emitters (`realtimeEmit` / `io.emit` / `.to(...).emit` / `emitFn` / `globalThis._concordRealtimeEmit`) and frontend listeners (`socket.on` + the world-page socket→window bridge). **⚠ This raw-string method is unsound for this codebase** — it misses events subscribed via a data array + `subscribe(evt.name,…)` loop (see ROOT-CAUSE NOTE), which is exactly how §3a's "orphans" turned out to be consumed. Treat the §3a verdicts below as corrected; use the abstraction-aware trace or the runtime detector instead.

### 3a. "Orphan" EMITS — RESOLVED: all 9 are CONSUMED-VIA-ABSTRACTION (2026-07-02)

**Superseding the 2026-06-26 "NONE" verdicts below — those were grep false-negatives (see ROOT-CAUSE NOTE).** All 9 events are subscribed by `concord-frontend/components/world/EmergentEventFeed.tsx`: they are entries in the `TRACKED_EVENTS` array (~lines 106-114), each subscribed through a `subscribe(evt.name, …)` loop (~line 204). The event names ARE raw strings — in the array, not at the subscribe call site the earlier grep inspected. `EmergentEventFeed` is MOUNTED in `app/lenses/world/page.tsx` and `app/hud/[name]/page.tsx`, so every emit lands in a live player-facing feed row.

| Event | Emitter (file:line, refreshed) | Frontend consumer |
|---|---|---|
| `world:npc-spared` | `server/routes/worlds.js:962` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:node-update` | `server/routes/worlds.js:1727` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `mount:behavior` | `server/emergent/mount-behavior-cycle.js:169` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:npc-bark` | `server/lib/npc-simulator.js:325` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:npc-attack` | `server/lib/npc-simulator.js:522` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:loot-node` | `server/server.js:9154` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:broadcast` | `server/server.js:63370` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:racing-started` | `server/domains/racing.js:17` | `EmergentEventFeed` `TRACKED_EVENTS` |
| `world:basketball-started` | `server/domains/basketball.js:19` | `EmergentEventFeed` `TRACKED_EVENTS` |

**Corroboration:** `server/tests/invariants/emit-subscribe-pairing.test.js` records that `world:broadcast` + `world:loot-node` were removed from the dead-emit baseline on 2026-06-26 with the note that they now have real subscribers.

**⚠ BREAKING-CHANGE WARNING — do NOT act on the prior remediation.** The 2026-06-26 pass suggested these emits were "candidates to remove." Removing any of them would **blank a live row of the Emergent Feed HUD**, a gameplay-visible regression. The correct action here was always a documentation fix, never a code change.

(`world:npc-alert` at `npc-simulator.js:343` also has a consumer — not orphaned.)

### 3b. Phantom LISTENS — frontend subscribes, NO backend emitter

| Event | Listener (file:line) | Backend emitter |
|---|---|---|
| `player:low-health` | `concord-frontend/app/lenses/world/page.tsx:3620` (in `SR_BRIDGE_EVENTS`) | ✅ **CONFIRMED-FIXED (2026-07-02)** — now emitted at `server/routes/worlds.js:3216` (`io.to('user:'+userId).emit("player:low-health", …)`). No longer phantom. |

Context worth keeping: the same `SR_BRIDGE` block (`page.tsx:3611-3621`) carries an in-code comment documenting a *previously-fixed* phantom (`faction-war:declared` → corrected to the real `faction:war-declared`). `player:low-health` is the remaining un-fixed phantom in that list. The other SR-bridge names (`combat:impact`, `combat:telegraph`, `world:plague-declared`, `faction:war-declared`, `world:event:scheduled`, `world:crisis`, `world:crisis-resolved`) all have real emitters (verified).

### 3b-detector. 12 `concordia:*` CustomEvents — ALL RESOLVED (2026-07-02)

**Superseding the 2026-06-26 "dead dispatch / no-op" verdict.** Re-adjudicated with the abstraction-aware method (and cross-checked against the runtime `dead-event-listener-detector.js`, which reports **0**). Result: **6 are CONSUMED** (real dispatch→listener pairs — some via a shared `const` event name that literal grep can't see), and **6 had their dead dispatch already DELETED** (only an explanatory comment survives — no `dispatchEvent` remains, so there is nothing to be a no-op).

**CONSUMED — dispatch → listener (file:line):**

| Event | Dispatch | Listener |
|---|---|---|
| `concordia:open-fishing` | `app/lenses/fishing/page.tsx:102` | `app/lenses/fishing/page.tsx:60` |
| `concordia:perfect-defense` | `components/world/CombatVFXBridge.tsx:230` | `components/world/CombatVFXBridge.tsx:146` |
| `concordia:freecam` | `components/concordia/PhotoMode.tsx:66,71` | `components/world/ConcordiaScene.tsx:1611` |
| `concordia:hud-settings-changed` | `components/world/concordia-hud/panels/HUDSettingsPanel.tsx:34` | `lib/concordia/hud-settings.ts:64` (both via the shared `const HUD_SETTINGS_CHANGED_EVENT` — why naive grep missed it) |
| `concordia:nudges-reset` | `components/world/concordia-hud/panels/HUDSettingsPanel.tsx:41` | `components/world/HiddenAssistance.tsx:317` |
| `concordia:active-world-changed` | `hooks/useWorldTravel.ts:122` | `components/world/CrossWorldPotencyHUD.tsx:95` |

**DISPATCH-DELETED — no `dispatchEvent` survives, comment-only (nothing to wire, nothing to no-op):**

`concordia:reduce-motion` · `concordia:photo-mode-end` · `concordia:awakening-offered` · `concordia:visibility-shader` · `concordia:power-cluster-claimed` · `concordia:wheel-action`.

The runtime detector `server/lib/detectors/dead-event-listener-detector.js` (`node server/scripts/run-detectors.js` from repo root) reports **0** dead listeners across all 12 — the authoritative check for this class, per the ROOT-CAUSE NOTE.

---

## 4. Unregistered macros (frontend caller → nonexistent backend macro)

Method: extracted 2,821 unique `(domain.name)` pairs from `lensRun(...)` / `runMacro(...)` literals in the frontend; diffed against 9,781 backend `register(...)` / `registerLensAction(...)` literal pairs and 520 registered domains.

- **0 callers point at an unregistered domain.**
- Only **11 frontend pairs** lack an *exact* literal backend registration, and **all 11 are `personas.*`** (`browse`, `chat_open`, `chat_send`, `create`, `delete`, `facets`, `mine`, `rate`, `regenerate_portrait`, `revise`, `update`).
- **All 11 are FALSE POSITIVES** — `personas` is registered at runtime by a copy-loop from the singular `persona` domain: `server/server.js:35415-35422` (`for (const [name, entry] of personaDomain) register("personas", name, ...)`), plus explicit Z4 stubs at `server.js:35432-35466` (`get`/`stats`/`versions`/`publish`/`install`). The static grep can't see the loop-registered names. They resolve correctly at dispatch.

Conclusion: no frontend macro caller is genuinely pointed at a missing receiver.

---

## 5. Unknown-macro handling in the `runMacro` / `/api/lens/run` dispatcher

Dispatcher: `runMacro(domain, name, input, ctx)` defined at **`server/server.js:10891`**. The HTTP entrypoint `/api/lens/run` resolves in this order (`server/server.js:38992-39041`):

1. `LENS_ACTIONS.get(\`${domain}.${action}\`)` — legacy lens-action path (`:38993`).
2. `MACROS.get(domain)?.get(action)` → `runMacro(...)` — canonical macro path (`:39003`).
3. **AI catch-all** — if neither matches, the call is routed to the **utility brain** (`:39019-39022`):

```js
// server/server.js:39019
aiResult = await Promise.race([
  utilityCall(action, domain, rest),
  new Promise((_, rej) => { _catchallTimer = setTimeout(() => rej(new Error("catchall_timeout")), CATCHALL_TIMEOUT_MS); }),
]);
```

Outcomes:

- **Brain answers** → `server/server.js:39040-39041`:
  ```js
  return res.json({ ok: true, result: { ok: true, output: aiResult.content || aiResult.error, source: "utility-brain", ... } });
  ```
  → **HTTP 200, `ok:true`.** A typo'd or never-registered `(domain,name)` is masked as a successful LLM-generated result.

- **Brain times out** → `:39030`: `return res.status(200).json({ ok:false, error:"unknown_macro", reason:"brain_catchall_timeout", ... })`.
- **Brain unavailable / `!aiResult.ok`** → `:39038`: `return res.status(200).json({ ok:false, error:"unknown_macro", reason:"macro_unavailable", ... })`.

**Verdict (2026-07-02): ✅ CONFIRMED-FIXED.** The dispatcher (now at `server/server.js:39341-39365`) FAILS FAST: any unregistered `(domain,action)` returns `{ok:false, error:"unknown_macro"}` **without invoking the brain**. The utility-brain escape hatch is preserved only behind an EXPLICIT opt-in (`input.__ai===true` or top-level `ai:true`), so a plain game-macro call can never again be masked as a `{source:"utility-brain"}` success. HTTP 200 + `ok:false` is retained deliberately (keeps `unknown_macro` out of the axios `RETRY_STATUS_CODES {502,503,504}` so a dead macro degrades cleanly without a retry-storm). The systemic masking mechanism (#3/#11/#25/#27) is closed. *(Superseded — was OPEN in the 2026-06-26 pass.)*

---

## 6. Preexisting defects — OPEN items from PLAYTEST_FINDINGS_PLAN.md + POLISH_AUDIT.md

Only items NOT marked ✅/done are listed.

### docs/PLAYTEST_FINDINGS_PLAN.md — OPEN

**P0 / P1 substrate:**
- **#3/#25/#27** — unknown-macro LLM fallthrough, HTTP 200, ~96s hang on brain backoff. (`server/server.js:39341-39365`.) — the §5 finding. ✅ **CONFIRMED-FIXED (2026-07-02)** — fail-fast `unknown_macro`; brain behind explicit `__ai` opt-in; catch-all bounded by `CONCORD_LENS_CATCHALL_TIMEOUT_MS`.
- **#11** — ~36 ghost-fleet macros (`agents.*`, `quest.*`, `religion.*`, `research.*`, `city.*`, …) log "loaded" but aren't in `MACROS` at dispatch → every action LLM-fallthroughs. `initGhostFleet()` async registration race. ✅ **CONFIRMED-SAFE-BY-DESIGN (2026-07-02)** — `initGhostFleet` registers all ~246 bus macros SYNCHRONOUSLY as each module imports (0 `register()` deferred behind a timer); `validateRegistry(MACROS)` runs in the post-init `.then()`. Once init resolves every macro is present; the only absence window is the intentional T+20s boot delay (`CONCORD_GHOST_FLEET_DELAY_MS`). Pinned by `server/tests/ghost-fleet-registration-sync.test.js`.
- **#32** — `dtu.create` returns `{ok:true, dtu:{id}}` but the row never lands in `STATE.dtus`/SQLite → immediate `dtu.get` says "not found". Headline "create a thought" verb silently loses data. **OPEN — flagged highest-priority investigation.**
- **#15/#16** — `dtu.gapPromote` circular-JSON throw (downstream of the now-fixed #19/#20) + Chicken2 valence guard THROWS `c2_guard_reject` instead of returning `{ok:false}`/skipping. **#16 OPEN** (guard should return a structured skip).

**P1 user paths:**
- **#30** — `glyph_spells.cast` license check is only CRASH-GUARDED; the genuine "did this user purchase a license" check still needs a real grant ledger (not the `dtu_citations` aggregate). ✅ **CONFIRMED-FIXED (2026-07-02)** — cast reads the real `dtu_licenses` grant ledger (mig 034, `domains/glyph-spells.js:85-90`), the same ledger the marketplace purchase path writes via `grantLicense`. Pinned by `server/tests/glyph-spells-license-cast.test.js` + `glyph-spells-license-ledger.test.js`.
- **#1** — `/dialogue/respond` has no deterministic fallback (LLM-off returns flat `"<name> responds to your choice."`); the opener was fixed but the respond path wasn't. `routes/worlds.js:1236`. **OPEN.**

**P2 correctness:**
- **#12** — `glyph_spells.cast` of a FIRE spell succeeds in the no-violence `concordia-hub` (combat route 403s; spell-cast doesn't). Needs the `world-zones.js` sanctuary gate on the spell macro. ✅ **CONFIRMED-FIXED (2026-07-02)** — the cast now consults `combatRuleFor` and returns `{ok:false,reason:"zone_combat_refusal"}` in a safe/sanctuary zone (`domains/glyph-spells.js`). Pinned by `server/tests/glyph-spells-sanctuary-gate.test.js`.
- **#13** — Pillar-3 cross-world spell potency: `mintSpell` never stamps `native_world`; native cast returns 0.85 not 1.0. **PARTIAL (re-verified 2026-07-02).** `mintSpell` *does* stamp `meta.nativeWorld` (via `stampMoveMeta`), and the cast now couples potency to the destination world's live env signals via `elementalEnvBoost` (`domains/glyph-spells.js`; `glyph-spells-env-coupling.test.js`). The remaining gap: the cast's cross-world multiplier still uses `effectivenessMultiplier` (affinity/level), not the `nativeWorld===targetWorld → 1.0` semantics of `crossWorldPotency`; a native cast can still read < 1.0. **Native=1.0 potency remains OPEN.**
- **#14** — `effectivenessMultiplier` reads the wrong world-rules key (`skill_affinity` vs real `skill_effectiveness_rules`/`skill_resistance`) → magic world nerfs magic to 0.70. **OPEN.**
- **#23/24** — `/api/reasoning/run` rejects `mode=constraint_check` (breaks DC7 DriftAlertToast), advertises UPPERCASE but validates lowercase, returns 200 on validation fail. **OPEN.**
- **#29** — DTU injection detector fires 100% false-positive (empty `patterns:[]` treated as a match) → quarantines legit autogen DTUs. **OPEN.**
- **#17** — duplicate macro registrations `chat.summary`, `ingest.queue` (second silently shadows first). **OPEN.**

**P2 boot/runtime health:**
- **#7** seed-pack loader `Cannot read properties of null (reading 'slice')`; **#8** `breakthrough_clusters` heartbeat "clusters is not iterable"; **#9** `[REPAIR] Lattice audit error: object is not iterable`; **#10** `achievement-engine catalog_persist_failed` ×4 at boot; **#18** `/api/feeds` 503 `feed_manager_not_initialized` for every caller; **#26/28** 6.25s event-loop stall at boot (2001-DTU bootstrap). **ALL OPEN.**

**P3 contract/polish:**
- **#21** `/api/combat/frame-data/:skillId` returns `no_skill` for every default skill + 404/body contract mix; **#22** leaderboards missing combat/wealth/global categories. **OPEN.**

**Round 2/3 — schema-drift (Gate C):** enumerated, exact count **105 sites** (43 wrong-column + 62 ghost-table), tracked by `scripts/audit/gates/schema-drift.mjs`. Floor is to be ratcheted to 0; the queue (R9–R35, V2–V32) is the work list. **OPEN as a batch** (most swallowed by try/catch → silent degrade). Hand-verified hotspots still live: `dtus` table column drift (`kind`→`type`, `meta`/`meta_json`→`metadata_json`), `user_wallets`→`users` (14 sites), `economy_transactions`→`economy_ledger`.

**Round 2 validation-by-throw (OPEN):** R1 `goals.propose` (push to uninit store), R2 `skill.create` ("title required" thrown), R3 `explore.run` (`Object.keys` before guard), R5 `/api/evo-asset/interaction` 500 on invalid id, R7 `/api/world/workstations/start` 500 (destructure undefined).

**Round 2 auth-mount (OPEN):** R4 `/api/film-studio` mounted without `requireAuth` → 401s every route (`server.js:30508`); R6 `/api/billing/*` same (`server.js:30516`); R8 `/api/cdn/purge-all` crashes on null `cdnManager` + error surfaces as an LLM chat reply.

**Other OPEN:** F1 ~24-50 runtime-only `CREATE TABLE IF NOT EXISTS` tables (fresh-install read-before-create hazard; `agents`/`social_*`/`spell_cast_log`/… — needs a boot-time `ensureRuntimeTables()`); S1 ~99 NPCs reference faction ids never defined in any `factions.json`; T3 `quality-pipeline.test.js` 60s timeout (manifestation of #27/the LLM-fallthrough hang); T4 stale `reports/emergent-wiring-audit.json` in git.

### docs/POLISH_AUDIT.md — OPEN (re-verify against code; doc dated 2026-05-29)

- **T1.1** Primary NPC dialogue LLM-or-nothing — *the opener was fixed* (`composeDeterministicDialogue`), but per PLAYTEST #1 the **`respond` path** still lacks the deterministic fallback. (`routes/worlds.js:1097/:1220` for opener; respond at `:1236`.)
- **T1.2** Trivia unplayable — correctness is exact `citedDtuId === answer_dtu_id` and the UI asks the player to type a raw DTU id (`server/lib/trivia.js:64`, `TriviaKioskPanel.tsx:115-121`). *(Note: PLAYTEST claims a multiple-choice `getAnswerChoices` fix shipped — re-verify which is current.)*
- **T1.3** healthcare/telehealth poses as video with no in-UI disclosure when no provider key set (`server/domains/healthcare.js:1790-1833`). **OPEN.**
- **T1.4** "Real-time multiplayer" seams: `code/Live Share` last-write-wins polled snapshots (`code.js:2153-2208`); `whiteboard` mounts a "Live" badge but `whiteboard:update` is never emitted (`whiteboard/page.tsx:157,163`; `event-shapes.js:464` only lists it). **OPEN** (disclose or ship real CRDT).
- **T1.5** Hacking terminal tree cosmetic — `attemptCommand` is full-command-line string equality, server never parses the tree (`server/lib/hacking.js:63-64`). **OPEN.**
- **T2.1** Light-attack hitstop — ✅ **FIXED-IN-CODE, lightly pinned.** A light landed hit now gets a 35ms freeze (was 0): `targetMs = … : 35` at `GameJuice.tsx:168-176`, dispatched through the deduped hit-pause authority. Not directly unit-pinned (the 35ms constant lives in `GameJuice.tsx`; the `hit-pause.test.ts` suite pins the `requestHitPause` dedup helper, T2.7, not this constant — a bolt-on assertion there would only re-assert the value it passes in, so it was intentionally skipped as a non-meaningful pin).
- **T2.2** Swing/whiff SFX — ✅ **FIXED + PINNED.** `SoundscapeEngine.tsx:129-130` plays the swing voice on the event dispatched by `CombatInputController.tsx:337-339`. Pinned by the `'Chunk-1 combat polish (T2.2/T2.3/T2.6/T2.11)'` block at `concord-frontend/tests/feel-consolidation.test.ts:78-111`.
- **T2.3** Lock-on reticle — ✅ **FIXED + PINNED.** `LockOnController.tsx:142-179` uses a real projector (not the old drifting yaw approximation). Pinned by the same `feel-consolidation.test.ts:78-111` block.
- **T2.4** `CombatMotorBridge` — retired/removed 2026-05-29 (dead-wired bridge). Not a live seam.
- **T2.5** `ReflexBridge` — retired/removed 2026-05-29 (same retirement). Not a live seam.
- **T2.6** `AnimationManager.tsx` — ✅ **RESOLVED (file DELETED).** The 444-LOC no-op animator is gone. Pinned (its absence asserted) by the `feel-consolidation.test.ts:78-111` block.
- **T2.9** Per-action attack cooldown — ✅ **FIXED + PINNED.** Cooldown is now per-action (not a shared 250ms that dropped chained inputs) via `server.js:8629-8645` + `server/lib/combat/attack-cooldown.js`; pinned by `server/tests/combat-cooldown-per-action.test.js`. *(The doc's old `server.js:8188` cite is stale — that offset is now CORS handling.)*
- **T2.11** Screen-shake vignette — ✅ **FIXED + PINNED.** A visible radial-gradient vignette renders at `GameJuice.tsx:299` (no longer an empty transparent div). Pinned by the `feel-consolidation.test.ts:78-111` block.
- **T2.12** No recorded audio assets (0 `.mp3/.wav/.ogg` in `public/`, 100% oscillator synthesis) — ✅ **NOT A DEFECT — DESIGN CHOICE.** This is factually true but is deliberate procedural/synthesized audio, not a wiring gap. Reclassified from "OPEN" to a design decision; no action.
- **T2.13** PARTIAL — NPC positions ARE interpolated but the poll is 10s-stale (`page.tsx:2621`, `AvatarSystem3D.tsx:2730`). Latency, not stepped motion.
- **T3.1** Faction-strategy (CK3 stances) fully dark — macros exist, *(PLAYTEST/T3.1 later claims `StrategicWarBanner`/`EmergentEventFeed` now consume `faction:war-declared` — re-verify; the §3 orphan list shows the war event IS consumed, so this is likely now partially surfaced).*
- **T3.3** Scarcity economy: NPC↔NPC pricing only; no price the player pays ever moves; `WalkerArbitrageMap` read-only (`npc-marketplace.js:88`). **OPEN.**
- **Minigame depth:** Karaoke scores consistency not melody (no target contour, `KaraokeMicrophone.tsx:120-122`); Hidden-object has no juice/SFX/found-markers (`HiddenObjectScenePanel.tsx`); Farming `watered_at` written but never read — watering is dead (`farming.js:65`); Mahjong stale legacy checkbox route still exposed (`minigame-resolvers.js:140-161`, `/api/mahjong/resolve`, `mahjong.resolve_hand` macro) — should be retired. **OPEN.**
- **Tier 4** untuned constants — large enumerated set (combat damage/poise, poll intervals, etc.). Playtest fodder, not bugs.

*(POLISH_AUDIT items already ✅ in the doc — code puzzles `_normalizeInstr`, SFX `resolveSfxId`, PvP `combat:impact`, screen-trauma unification, strike-fx dedup, T2.8 camera-punch, T2.10 cancel window, T3.2 scheme barge-in — are excluded as fixed.)*

---

## 7. Placeholders in MOUNTED world-lens components

Grepped `app/lenses/world/`, `components/world/`, `components/concordia/`, `components/world-lens/` for `mock`/`placeholder`/`coming soon`/`TODO`/`roadmap`/`fake-data`. Most hits are (a) legitimate HTML `placeholder=` input attributes or (b) honest-empty-state comments ("never fabricate" — the opposite of a defect). One genuine finding:

| Component | Issue | Mounted at |
|---|---|---|
| `components/world/CharacterCustomizer.tsx:88` | ✅ **CONFIRMED-FIXED (2026-07-02).** No longer fabricated — the component now fetches the real backend catalog via `lensRun('appearance','options',{})` (with genuine loading/error states) against the `appearance.options` macro (`server/domains/appearance.js:265`), a per-slot renderable-enum catalog with no fabricated prices (base options free/owned). `generateSlotOptions()` is gone. | `app/onboarding/character/page.tsx`, `components/world/concordia-hud/PanelHost.tsx` → `panels/CharacterCustomizerPanel.tsx` |

Honest-empty-state references (NOT defects, listed so they aren't re-flagged): `AgentBuilder.tsx:130`, `CombatSystem.tsx:84`, `MarketplacePalette.tsx:32`, `StandardsLibrary.tsx:161`, `DistrictTimeline.tsx:24`, `PlayerPresence.tsx:29,115` — all explicitly "never fabricate / honest empty on error".

---

## Appendix — reproduction commands

- Lens wiring: `node scripts/verify-lens-backends.mjs`
- Detectors: `cd server && node scripts/run-detectors.js` (run from repo root to exercise db-detectors)
- Macro diff: extract `lensRun`/`runMacro` literal pairs from `concord-frontend`, diff vs `register`/`registerLensAction` literal pairs in `server/`.
- Socket diff: emitters `realtimeEmit|io.emit|.to(...).emit|emitFn|_concordRealtimeEmit` in `server/`; listeners `socket.on`/`.on(` + the world-page socket→window bridge in `concord-frontend/`.
- Unknown-macro path: `server/server.js:38992-39048`.
