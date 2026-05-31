# Playtest Findings Plan — Vael's Expedition I & II (2026-05-31)

Folds Round 1 (30 genuine of 32; #4/#5 self-retracted) and **Round 2 (30 more,
distinct)** into a prioritized, code-verified fix plan. Spot-checks confirmed both
rounds against the working tree — credible; treat each as real unless re-audit
says otherwise. Tiers are by blast radius, not report order.

**Round 2's headline (Wave 13): the column-drift class is mechanically gateable.**
~26 findings (#30 + #R9–#R35) are `db.prepare` queries referencing columns the
live table lacks → `no such column` at runtime. The playtester's method (PRAGMA
all tables × scan every query) IS the spec for **Gate C** in
`docs/CONTRACT_ENFORCEMENT_STRATEGY.md` — one static gate retires the whole class.
This is the single highest-yield thing to build next.

**Systemic root (read first):** several findings share ONE masking mechanism —
`/api/lens/run` dispatches `LENS_ACTIONS → MACROS → LLM-fallthrough`, and an
unknown `(domain,name)` falls through to the utility brain, returning **HTTP 200**
`{ok:true, result:{ok:false, output:"fetch failed", source:"utility-brain"}}`.
That turns "macro not wired" (#2, #11) into a fake transient LLM outage (#3),
which then **hangs ~96s** on LLM backoff (#27) and reports 200 for failures (#25).
**Fix #3 first** (return `unknown_macro`, fail fast, non-200) and #2/#11/#27/#25
become visible/benign in one stroke.

---

## P0 — silent data loss / headline substrate broken

| # | Finding | Status / fix |
|---|---|---|
| **19/20** | `runMacro(ctx,"dtu","cluster"/"gapPromote",…)` passes `ctx` as `domain` (sig is `(domain,name,input,ctx)`) → DTU MEGA→HYPER self-consolidation never runs; circular-JSON throw (#15). | ✅ **FIXED this commit** — both calls reordered at `server.js:21085`/`:25420`; matches the correct sibling at `:33181`. Syntax-verified; runtime-verify on next boot. |
| **15/16** | `dtu.gapPromote` throws "circular structure to JSON" (#15) and the Chicken2 valence guard THROWS `c2_guard_reject` instead of returning `{ok:false}` and skipping (#16). | #15 is downstream of #19/#20 (the circular `ctx` was the payload) — re-verify after the reorder. #16: make the Chicken2 guard return a structured skip, not throw, so one "harm"-scored DTU can't abort the whole pass. Contract test on the guard. |
| **32** | `dtu.create` returns `{ok:true, dtu:{id}}` but the row never lands in `STATE.dtus`/SQLite — immediate `dtu.get` says "not found". **SEVERE** — the substrate's headline "create a thought" verb silently loses data. | Investigate the ~410-line create path for an early/caught return before the `STATE.dtus.set`/persist step (cf. #16 guard-throw). Add an e2e test: create → get → assert persisted. **Highest-priority investigation.** |

---

## P1 — whole macro surfaces dead, masked as LLM outage

| # | Finding | Status / fix |
|---|---|---|
| **3/25** | Unknown macro → LLM fallthrough, HTTP 200, `"fetch failed"`. | Return `{ok:false, error:"unknown_macro", domain, name}` with a non-200 for unknown/validation-fail/not-found at the `/api/lens/run` dispatcher. The high-leverage systemic fix. |
| **27** | A dead-macro call hangs ~96s on LLM backoff (DoS-adjacent). | Resolved by #3 (fail fast before the brain call). |
| **11** | ~36 ghost-fleet macros (`agents.*`, `quest.*`, `religion.*`, `research.*`, `city.*`, …) log "loaded" but aren't in `MACROS` at dispatch → every action LLM-fallthroughs. **HIGH.** | Run the report's probe: `globalThis.__CARTOGRAPHER__.MACROS.has('agents')` at steady state. Likely `initGhostFleet().catch()` registers in async microtasks landing after a consumer snapshots/rebuilds the per-domain Map. Make ghost-fleet registration synchronous (or await it before serving). |
| **2** | `domains/minigames.js#registerMinigameMacros` exported but never imported by `server.js` → `fishing.resolve_cast`, `karaoke.resolve_performance`, `mahjong.resolve_hand`, `photography.resolve_shot`, `minigames.constants` all unregistered. | ✅ **FIXED** — imported + invoked `registerMinigameMacros(register)` at boot (`server.js`, after `registerElementMacros`). Test in `tests/playtest-fixes.test.js`. |

---

## P1 — hard crashes / wrong-world on real user paths

| # | Finding | Status / fix |
|---|---|---|
| **30** | `glyph_spells.cast` license check queries `dtu_citations` for `creator_id/parent_id/kind` — **none exist** (table is `dtu_id, citation_count, …`) → casting a licensed spell hard-throws `no such column`. | 🟡 **CRASH-GUARDED** — wrapped the query so a non-owner cast returns a clean `not_owner_or_licensed` instead of a 500 (test in `playtest-fixes.test.js`). **Proper fix still pending:** the genuine "did this user purchase a license" check needs a real grant ledger (consent/marketplace-purchase), not the citation-aggregate table. |
| **31** | `POST /api/vehicles/spawn` defaults `world="concordia"` (canonical is `"concordia-hub"`) and reads `world/type`, ignoring platform-standard `worldId/vehicleType` → orphaned, world-invisible vehicles. | ✅ **FIXED** — default `concordia-hub`; accept `worldId`/`vehicleType` aliases (`routes/vehicles.js`). |
| **1** | `/dialogue/respond` has no deterministic fallback — LLM-off returns the flat `"<name> responds to your choice."` (POLISH_AUDIT T1.1 opener fix didn't cover the respond path). | Route `respond` through `npc-dialogue-fallback.js#composeDeterministicDialogue` before the LLM, same as the opener. `routes/worlds.js:1236`. |

---

## P2 — invariant / correctness

| # | Finding | Fix |
|---|---|---|
| **12** | `glyph_spells.cast` of a FIRE spell in `concordia-hub` succeeds + writes thermal feedback into the no-violence hub (combat route 403s, spell-cast doesn't). | Apply the `world-zones.js` sanctuary/no-combat gate to the spell-cast macro (the same check the combat route uses). |
| **13** | Pillar-3 cross-world potency unimplemented for spells: `mintSpell` never stamps `native_world`; native cast returns 0.85 not 1.0. | Stamp `native_world` at mint; pass spell origin into `effectivenessMultiplier`. |
| **14** | `effectivenessMultiplier` reads `rule_modulators.skill_affinity[domain]`, but worlds define `skill_effectiveness_rules`/`skill_resistance` → magic world (1.5×) nerfs magic to 0.70. | Read the real `skill_effectiveness_rules.<domain>.multiplier` + `skill_resistance` keys; fall back to neutral only when absent. |
| **23/24** | `/api/reasoning/run` rejects `mode=constraint_check` (breaks the DC7 DriftAlertToast flow) and advertises UPPERCASE modes but validates lowercase; returns 200 on validation fail. | Add `constraint_check` to allowed modes (it's the documented HLR bridge mode); normalize case; 400 on invalid. |
| **29** | DTU injection detector fires 100% false-positive (71/71 with `patterns:[]`) → quarantines legitimate internal autogen DTUs (`system.dream`, `system.evolution`). | Treat an empty matched-patterns set as CLEAN; only quarantine on ≥1 real match. |
| **17** | Duplicate macro registrations `chat.summary`, `ingest.queue` — second silently shadows first (order-dependent). | De-dup the registrations; keep one canonical each. |

---

## P2 — boot / runtime health

| # | Finding | Fix |
|---|---|---|
| **7** | Seed-pack loader: `Cannot read properties of null (reading 'slice')`. | Null-guard the loader input. |
| **8** | `breakthrough_clusters` heartbeat: "clusters is not iterable" (zero work every cycle). | Guard the iterated value (`Array.isArray` / default `[]`) in the breakthrough-pass path. |
| **9** | `[REPAIR] Lattice audit error: object is not iterable`. | Same class as #8 — guard the repair-cortex lattice audit iterable. |
| **10** | `achievement-engine catalog_persist_failed` ×4 at boot. | Investigate the 4 failing catalog entries (schema/constraint); persist or skip cleanly. |
| **18** | `/api/feeds` 503 `feed_manager_not_initialized` for every caller. | Initialize the feed manager empty on boot (don't refuse reads when external RSS 403s). |
| **26/28** | 6.25s event-loop stall at boot (2001-DTU bootstrap sync block) → root `/` 43s during boot. | Chunk/defer the bootstrap-ingestion store migration off the main sync path (yield to the loop). |

---

## P3 — contract / polish

| # | Finding | Fix |
|---|---|---|
| **21** | `/api/combat/frame-data/:skillId` returns `no_skill` for every default skill (no DTU-derived seed data) + 404/body contract mix. | Seed default frame-data for the core moves, or derive a deterministic default; align status/body. |
| **22** | Leaderboards expose only sparks/skills/crafts/nemesis — no combat/wealth/global. | Add the missing categories; 400 list for unknown. |
| **6** | `creatures.taxonomy` reads camelCase `speciesId` while the codebase uses `species_id`. | ✅ **FIXED** — accepts `species_id` (and legacy `speciesId`); test in `playtest-fixes.test.js`. |

---

## Recommended execution order (headless-first)
1. **#3** systemic fail-fast (unblocks/benigns #2, #11, #25, #27) + **#2** minigames import — high leverage, small.
2. **#32** dtu.create persistence investigation (SEVERE) + **#16** Chicken2-guard skip-not-throw; re-verify #15 after the ✅ #19/#20 reorder.
3. **#30/#31/#1** the hard-crash / wrong-world / dialogue-cliff user paths.
4. **#29/#23/#12/#13/#14/#17** invariant + correctness.
5. **#7/#8/#9/#10/#18** boot-health guards; **#26/#28** the boot sync-stall.
6. **#21/#22/#6** contract polish.

Each fix ships with a contract/e2e test and the same kill-switch-where-risky
discipline. Most are server-side and headless-verifiable; the boot-timing ones
(#26/#28) and `#11`'s steady-state probe want a local boot to confirm.

---

# Round 2 — Vael's Expedition II (30 more, distinct)

## R-P0/P1 — schema-drift cluster (the Gate-C class)

~26 `db.prepare` queries reference columns the live table doesn't have → each
throws `no such column` when its path runs. **✅ Gate C is now built**
(`scripts/audit/gates/schema-drift.mjs`) — it runs the migrations on an in-memory
DB, PRAGMAs the real schema, and flags every offender (currently **49** frozen at
the floor, covering all of #R9–#R35 + #30 + extras). **Do NOT hand-fix blind** —
work the gate's list and ratchet the floor to 0. The `dtus` table is the hottest
offender (it has `type`/`metadata_json`/`data`, NOT
`kind`/`meta`/`meta_json`/`lineage`/`owner_id`/`content_hash`). Each fix needs the
correct column determined (e.g. `kind`→`type`, `meta`→`metadata_json`); the table
below is the work queue.

| # | File:line | Table ✗ column(s) | Notes |
|---|---|---|---|
| **R9** | `lib/skill-effectiveness.js:144` | `dtus ✗ lineage` | cross-world skill adaptation mint |
| **R10** | `routes/worlds.js:600` | `dtus ✗ meta` | skill prestige `UPDATE … SET meta` |
| **R11** | `server.js:74859` | `skill_revisions ✗ npc_id` | |
| **R12** | `domains/chronicle.js:42` | `dtus ✗ kind` | (has `type`) |
| **R13** | `domains/dx.js:266` | `economy_ledger ✗ user_id` | (has from/to_user_id) |
| **R14** | `domains/faction-strategy.js:79` | `faction_strategy_log ✗ created_at` | |
| **R15** | `lib/archetype-needs.js:49` | `economy_flows ✗ faction, ts` | |
| **R16** | `lib/archetype-needs.js:64` | `npc_conversations ✗ started_at` | |
| **R17** | `lib/archetype-needs.js:77` | `npc_schemes ✗ world_id, status` | |
| **R18** | `lib/chronicle/chronicle.js:105` | `realm_citizens ✗ realm_id` | |
| **R19** | `lib/code-substrate/code-dtu-emitter.js:256` | `dtus ✗ kind` | |
| **R20** | `lib/creator-dashboard.js:235/243/254/266` | `economy_ledger ✗ user_id` | creator $ dashboard broken |
| **R21** | `lib/cross-world-economy.js:98` | `economy_flows ✗ created_at` | |
| **R22** | `lib/dtu-portability.js:78` | `dtu_citations ✗ creator_id, parent_creator_id` | |
| **R23** | `lib/dtu-portability.js:89` | `economy_ledger ✗ buyer_id, seller_id, creator_id` | DTU export economics |
| **R24** | `lib/emergents/quality/deterministic-gates.js:39` | `dtus ✗ content_hash` | |
| **R25** | `lib/kingdoms.js:45` | `procgen_regions ✗ faction_id` | |
| **R26** | `lib/npc-skill-author.js:294` | `dtus ✗ meta_json` | |
| **R27** | `lib/stealth-perception.js:111` | `dtus ✗ owner_id, owner_type` | |
| **R28** | `routes/analytics.js:72` | `world_buildings ✗ created_by` | |
| **R29** | `routes/player-inventory.js:137` | `dtus ✗ owner_id` | |
| **R30** | `economy/chargeback-handler.js:74/83` | `purchases ✗ stripe_payment_intent_id, metadata_json` | Stripe chargebacks |
| **R31** | `emergent/forward-sim-cycle.js:32` | `player_inventory ✗ recorded_at` | |
| **R32** | `emergent/nemesis-cycle.js:125` | `character_opinions ✗ from_npc_id, to_npc_id` | hand-verified; NEMESIS heartbeat |
| **R33** | `emergent/npc-vs-npc-combat-cycle.js:100-101` | `npc_grudges ✗ owner_npc_id, target_npc_id` | hand-verified |
| **R34** | `lib/npc-legacy.js:228` | `dtus ✗ kind` | hand-verified; recipe inheritance |
| **R35** | `emergent/mount-behavior-cycle.js:62` | `world_resource_nodes ✗ kind` (has node_type) | hand-verified |

*(Excluded false positive, honestly reported: `lib/secrets.js:219` — the `user_id`
belongs to a `secret_discoveries` subquery, not `secrets`. Gate C must replicate
this subquery-stripping to stay trustworthy.)*

## R-P1 — uncaught throws (validation-by-throw)

| # | Finding | Fix |
|---|---|---|
| **R1** | `goals.propose` throws `…reading 'push'` — pushes to an uninitialised goals store. | Initialise the store / guard before push; return structured error. |
| **R2** | `skill.create` raises "title required" as `macro_uncaught_throw`. | `return {ok:false,error}` instead of `throw` (validation-by-throw). |
| **R3** | `explore.run` throws `Cannot convert undefined or null to object` — `Object.keys` before guarding. | Guard the input shape before `Object.keys/entries`. |
| **R5** | `/api/evo-asset/interaction` 500s on a present-but-invalid `assetId` (only null guarded). | Validate the id → 404, don't let `recordInteraction` throw into a 500. |
| **R7** | `/api/world/workstations/start` 500 — destructures `districtId` of `undefined`. | Guard the nested object before destructuring. |

These share the **validation-by-throw** anti-pattern — a `runMacro`/route-level
`try/catch → {ok:false}` wrapper (the Chicken2 #16 fix shape) handles the class.

## R-P1 — auth-mount bugs (whole features dead)

| # | Finding | Fix |
|---|---|---|
| **R4** | `/api/film-studio` mounted without `requireAuth` → the router's auth shim 401s EVERY route. **Whole feature dead.** `server.js:30508`. | Pass `requireAuth` into `createFilmStudioRouter`. |
| **R6** | `/api/billing/*` write paths same class — `createAPIBillingRouter` mounted without `requireAuth` → `auth_not_configured` 401 on every write. `server.js:30516`. | Pass `requireAuth`. Audit the shared shim's other mounts (storage/lens-culture/legal/dtu-format/lens-compliance). |
| **R8** | `/api/cdn/purge-all` crashes on `cdnManager: null` (mounted null) + the error surfaces as an LLM chat reply (fell through to catch-all). | Guard null `cdnManager`; don't let CDN routes reach the chat fallthrough. |

A **mount-arg audit gate** (assert routers that declare a `requireAuth`/manager
param are mounted with one) would catch the #R4/#R6/#R8 class — a Gate-B sibling.

## Round-2 execution order
1. **Build Gate C** (schema-drift scanner) → fix the ~26-item cluster to floor 0.
2. **R1/R2/R3/R5/R7** validation-by-throw → the `try/catch→{ok:false}` wrapper.
3. **R4/R6/R8** auth/null mount bugs → fix + a mount-arg audit gate.
