# Concord Cognitive Engine — Wiring-Integrity Audit

Date: 2026-06-26 · Working dir: `/home/user/concord-cognitive-engine`

---

## Prioritized summary (fix-order)

| Pri | Finding | Where | Status |
|---|---|---|---|
| **P0** | **Unknown-macro silently answered by LLM (HTTP 200).** `/api/lens/run` falls through to the utility brain on any unregistered `(domain,name)`. When the brain answers it returns **200 `{source:"utility-brain"}`** — a typo'd / never-registered macro looks like a real result instead of an error. Only on brain failure/timeout does it return the honest `unknown_macro`. | `server/server.js:39008-39041` | **OPEN** (documented #3 in PLAYTEST_FINDINGS_PLAN; the honest path is half-wired) |
| **P1** | **9 backend socket emits with ZERO frontend listeners** (orphan emitters): `world:npc-spared`, `world:node-update`, `mount:behavior`, `world:npc-bark`, `world:npc-attack`, `world:loot-node`, `world:broadcast`, `world:racing-started`, `world:basketball-started`. | see §3 table | OPEN |
| **P1** | **1 phantom subscribed socket event** (listener with no emitter): `player:low-health` subscribed in the world page SR-bridge but never emitted by the backend. | `concord-frontend/app/lenses/world/page.tsx:3620` | OPEN |
| **P1** | **12 dead `concordia:*` CustomEvent dispatches** (detector-confirmed): dispatched in mounted components, no `addEventListener` subscribes → no-op ghost events. | see §3b | OPEN |
| **P1** | **1 CRITICAL detector finding** `maintenance-gates` returns a malformed `undefined/undefined` critical — the gate itself is emitting a broken finding object (cannot tell which gate failed). | `server/lib/detectors/*maintenance-gates*` | OPEN |
| **P2** | **Placeholder data in a MOUNTED component.** `CharacterCustomizer` fabricates all cosmetic slot options client-side (`generateSlotOptions`, placeholder colors/prices); no backend fetch. Mounted in onboarding + HUD panel. | `concord-frontend/components/world/CharacterCustomizer.tsx:49-65,104` | OPEN |
| info | Lens wiring clean: 258 WIRED / 2 by-design NO-BACKEND-CALL / 0 PARTIAL / 0 broken. | — | OK |
| info | Frontend→macro callers: only 11 unmatched pairs, all `personas.*`, all **false positives** (aliased at runtime). No caller points at a truly nonexistent macro. | §4 | OK |
| — | Large preexisting backlog in PLAYTEST_FINDINGS_PLAN + POLISH_AUDIT — enumerated in §6. | §6 | mixed |

The macro/lens *coverage* layer is healthy (every lens reaches a backend; no caller hits a missing domain). The real wiring rot is in (a) the unknown-macro LLM-fallthrough masking dead macros, and (b) socket/CustomEvent name drift (orphan emits + phantom listeners + dead dispatches).

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
| 🛑 critical | `maintenance-gates` | `undefined` | The finding object is malformed — title and message both render as `undefined` (`server/server.js`-level report shows `🛑 **critical** `undefined` — undefined`). The gate is firing a critical but not populating it; either a verify-*.mjs gate is failing and the finding builder is dropping its fields, or the gate's own output shape regressed. Needs investigation — a real critical is hiding behind a broken finding. |
| (high) | — | _none_ | 0 high findings. |

### Notable non-critical findings relevant to wiring

- `dead-event-listener` (12 medium) — see §3b. Independently confirms the dead-CustomEvent class.
- `lens-health` (info): `lens world calls domain "mainland" — no dedicated handler; routes via utility-brain AI catch-all` at `concord-frontend/app/lenses/world/page.tsx:5544`. **Verified FALSE POSITIVE** — `domain: 'mainland'` there is a data field on a quest object, not a `lensRun` macro call. (Heuristic misfire; not a dead wire.)
- `macro-usage` (info): `839 macros · 0 dead · ... Open dispatcher detected — all macros reachable via server/routes/domain.js:225`. The open-dispatcher (`mainland`/utility-brain catch-all) is exactly what makes dead-macro detection hard and is the root of the P0 finding.
- `command-injection` (1 medium): `execSync()` on a non-literal command at `scripts/repair-surgeon.js:113` (tooling script, not server runtime).
- `ux-route-empty-render` (6 medium): pages returning `null` with no loading/empty guard — `quantum/page.tsx:147,151`, `reasoning/traces/page.tsx:164`, `social/post/[postId]/page.tsx:31`, `spectate/[worldId]/page.tsx:85`, `ux-suite/page.tsx:136`.
- `resource-leak` (11 medium), `env-config-drift` (9 medium), `performance-hotspot` (15 low), `secret-leak` (1), `fake-data` (5 info) — none wiring-critical.

---

## 3. Dead socket events (caller-without-receiver / receiver-without-caller)

Method: collected backend emitters (`realtimeEmit` / `io.emit` / `.to(...).emit` / `emitFn` / `globalThis._concordRealtimeEmit`) and frontend listeners (`socket.on` + the world-page socket→window bridge). Verified there is **no catch-all** (`onAny`) listener on the frontend, so a zero-reference event is genuinely unconsumed.

### 3a. Orphan EMITS — backend emits, NO frontend listener (anywhere, incl. tests)

| Event | Emitter (file:line) | Frontend listener |
|---|---|---|
| `world:npc-spared` | `server/routes/worlds.js:961` | **NONE** |
| `world:node-update` | `server/routes/worlds.js:1704` | **NONE** |
| `mount:behavior` | `server/emergent/mount-behavior-cycle.js:169` | **NONE** |
| `world:npc-bark` | `server/lib/npc-simulator.js:325` | **NONE** |
| `world:npc-attack` | `server/lib/npc-simulator.js:522` | **NONE** |
| `world:loot-node` | `server/server.js:9122` | **NONE** |
| `world:broadcast` | `server/server.js:63014` | **NONE** |
| `world:racing-started` | `server/domains/racing.js:17` | **NONE** |
| `world:basketball-started` | `server/domains/basketball.js:19` | **NONE** |

(`world:npc-alert` at `npc-simulator.js:343` HAS exactly one consumer — not orphaned. The sports/racing "started" events fire but nothing in the world scene reacts to them.)

### 3b. Phantom LISTENS — frontend subscribes, NO backend emitter

| Event | Listener (file:line) | Backend emitter |
|---|---|---|
| `player:low-health` | `concord-frontend/app/lenses/world/page.tsx:3620` (in `SR_BRIDGE_EVENTS`) | **NONE** — never emitted server-side. The screen-reader low-health announce + `concordia:player-low-health` window event never fire. |

Context worth keeping: the same `SR_BRIDGE` block (`page.tsx:3611-3621`) carries an in-code comment documenting a *previously-fixed* phantom (`faction-war:declared` → corrected to the real `faction:war-declared`). `player:low-health` is the remaining un-fixed phantom in that list. The other SR-bridge names (`combat:impact`, `combat:telegraph`, `world:plague-declared`, `faction:war-declared`, `world:event:scheduled`, `world:crisis`, `world:crisis-resolved`) all have real emitters (verified).

### 3b-detector. Dead CustomEvent dispatches (detector `dead-event-listener`, 12 medium)

These are `window.dispatchEvent(CustomEvent(...))` in **mounted** components with no `addEventListener` subscriber — pure no-ops:

| Event | Dispatch site |
|---|---|
| `concordia:open-fishing` | `app/lenses/fishing/page.tsx:69` |
| `concordia:reduce-motion` | `components/accessibility/AccessibilityDOMApplier.tsx:54` |
| `concordia:photo-mode-end` | `components/concordia/PhotoMode.tsx:67` |
| `concordia:awakening-offered` | `components/world/AwakeningToast.tsx:35` |
| `concordia:perfect-defense` | `components/world/CombatVFXBridge.tsx:212` |
| `concordia:visibility-shader` | `components/world/HorrorRoleHUDs.tsx:57` |
| `concordia:freecam` | `components/world/PhotoMode.tsx:66` |
| `concordia:power-cluster-claimed` | `components/world/PowerClusterLayer.tsx:167` |
| `concordia:wheel-action` | `components/world/concordia-hud/ActionWheel.tsx:85` |
| `concordia:hud-settings-changed` | `components/world/concordia-hud/panels/HUDSettingsPanel.tsx:52` |
| `concordia:nudges-reset` | `components/world/concordia-hud/panels/HUDSettingsPanel.tsx:59` |
| `concordia:active-world-changed` | `hooks/useWorldTravel.ts:122` |

Several of these are feel/UX wires (`perfect-defense` combat juice, `visibility-shader` horror, `freecam`/`photo-mode-end` photo mode, `wheel-action` action wheel) where the intended consumer was never wired — the dispatch silently does nothing.

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

**Verdict:** The dispatcher does NOT fail-fast with a non-200 `unknown_macro`. It only surfaces `unknown_macro` when the brain *fails* — and even then it returns **HTTP 200** (deliberately, to avoid axios retry-storms on 502/503/504). When the brain succeeds, an unregistered macro is indistinguishable from a real result. This is the systemic masking mechanism described as the root cause in `docs/PLAYTEST_FINDINGS_PLAN.md` (#3/#11/#25/#27). The honest path was partially built (`error:"unknown_macro"` strings exist) but it still (a) attempts the LLM first rather than rejecting an unknown pair up front, and (b) never returns a non-200. **Still OPEN.**

---

## 6. Preexisting defects — OPEN items from PLAYTEST_FINDINGS_PLAN.md + POLISH_AUDIT.md

Only items NOT marked ✅/done are listed.

### docs/PLAYTEST_FINDINGS_PLAN.md — OPEN

**P0 / P1 substrate:**
- **#3/#25/#27** — unknown-macro LLM fallthrough, HTTP 200, ~96s hang on brain backoff. (`server/server.js:39008-39041`.) — the §5 finding. **OPEN.**
- **#11** — ~36 ghost-fleet macros (`agents.*`, `quest.*`, `religion.*`, `research.*`, `city.*`, …) log "loaded" but aren't in `MACROS` at dispatch → every action LLM-fallthroughs. `initGhostFleet()` async registration race. **OPEN.**
- **#32** — `dtu.create` returns `{ok:true, dtu:{id}}` but the row never lands in `STATE.dtus`/SQLite → immediate `dtu.get` says "not found". Headline "create a thought" verb silently loses data. **OPEN — flagged highest-priority investigation.**
- **#15/#16** — `dtu.gapPromote` circular-JSON throw (downstream of the now-fixed #19/#20) + Chicken2 valence guard THROWS `c2_guard_reject` instead of returning `{ok:false}`/skipping. **#16 OPEN** (guard should return a structured skip).

**P1 user paths:**
- **#30** — `glyph_spells.cast` license check is only CRASH-GUARDED; the genuine "did this user purchase a license" check still needs a real grant ledger (not the `dtu_citations` aggregate). **Partially open.**
- **#1** — `/dialogue/respond` has no deterministic fallback (LLM-off returns flat `"<name> responds to your choice."`); the opener was fixed but the respond path wasn't. `routes/worlds.js:1236`. **OPEN.**

**P2 correctness:**
- **#12** — `glyph_spells.cast` of a FIRE spell succeeds in the no-violence `concordia-hub` (combat route 403s; spell-cast doesn't). Needs the `world-zones.js` sanctuary gate on the spell macro. **OPEN.**
- **#13** — Pillar-3 cross-world spell potency unimplemented: `mintSpell` never stamps `native_world`; native cast returns 0.85 not 1.0. **OPEN.**
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
- **T2.1** No hitstop on light attacks (`GameJuice.tsx:162`). **OPEN.**
- **T2.2** No whiff/swing SFX (`CombatInputController.tsx`). **OPEN.**
- **T2.3** Lock-on doesn't move the camera; reticle is a yaw approximation that drifts (`LockOnController.tsx:152-165`). **OPEN.**
- **T2.4** `CombatMotorBridge` dead (wrong event source, empty poses, unbound skeleton) — *(CLAUDE.md says this bridge was retired/removed 2026-05-29; re-verify whether the mount at `page.tsx` is gone).* 
- **T2.5** `ReflexBridge` dead — *(same retirement note; re-verify).* 
- **T2.6** `AnimationManager.tsx` (444 LOC) animates nothing — `setTimeout` flips a boolean, never touches the mixer (`AnimationManager.tsx:195-199`). **OPEN.**
- **T2.9** Shared 250ms attack cooldown drops chained inputs (kick within 250ms silently dropped server-side → desync) (`server.js:8188`). **OPEN.**
- **T2.11** GameJuice 2D "screen shake" shakes an empty transparent div; no visible vignette (`GameJuice.tsx:277-287,347-354`). **OPEN.**
- **T2.12** No recorded audio assets — 0 `.mp3/.wav/.ogg` in `public/`, 100% oscillator synthesis. **OPEN.**
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
| `components/world/CharacterCustomizer.tsx:49-65,104` | All cosmetic slot options are **client-fabricated placeholder data** via `generateSlotOptions()` (placeholder hex colors, synthetic names `Body 1..N`, fake prices `(i+1)*50`). No backend fetch (`grep` shows zero `fetch`/`lensRun`/`apiClient`/`/api/`). The customizer renders fake wardrobe inventory. | `app/onboarding/character/page.tsx`, `components/world/concordia-hud/PanelHost.tsx` → `panels/CharacterCustomizerPanel.tsx` |

Honest-empty-state references (NOT defects, listed so they aren't re-flagged): `AgentBuilder.tsx:130`, `CombatSystem.tsx:84`, `MarketplacePalette.tsx:32`, `StandardsLibrary.tsx:161`, `DistrictTimeline.tsx:24`, `PlayerPresence.tsx:29,115` — all explicitly "never fabricate / honest empty on error".

---

## Appendix — reproduction commands

- Lens wiring: `node scripts/verify-lens-backends.mjs`
- Detectors: `cd server && node scripts/run-detectors.js` (run from repo root to exercise db-detectors)
- Macro diff: extract `lensRun`/`runMacro` literal pairs from `concord-frontend`, diff vs `register`/`registerLensAction` literal pairs in `server/`.
- Socket diff: emitters `realtimeEmit|io.emit|.to(...).emit|emitFn|_concordRealtimeEmit` in `server/`; listeners `socket.on`/`.on(` + the world-page socket→window bridge in `concord-frontend/`.
- Unknown-macro path: `server/server.js:38992-39048`.
