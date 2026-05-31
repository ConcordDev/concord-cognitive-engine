# Vael's Expedition — Bug Findings (Sun May 31 20:48:38 UTC 2026)

## Confirmed findings (Wave 1-2)

**#1 — `/dialogue/respond` has no deterministic fallback (LLM-off cliff).**
`routes/worlds.js:1236` — initial `/dialogue` uses the deterministic composer, but the
`respond` branch routes straight to the subconscious brain and, when LLM is down, returns the
flat `"<name> responds to your choice."` Every dialogue follow-up is a dead string without Ollama.
Matches POLISH_AUDIT T1.1 but on the respond path the opener fix didn't cover.

**#2 — Entire `domains/minigames.js` macro set is DEAD (never wired).**
`registerMinigameMacros(register)` is defined + exported but server.js only imports
`routes/minigames.js`, never the domain file. Result: `fishing.resolve_cast`,
`photography.resolve_shot`, `karaoke.resolve_performance`, `mahjong.resolve_hand`,
`minigames.constants` are all unregistered. The real fishing/karaoke resolvers in
`lib/minigame-resolvers.js` are unreachable via the macro bus.

**#3 — Unregistered macros silently fall through to the LLM ("fetch failed" mask).**
runMacro returns HTTP 200 + `{ok:true, result:{ok:false, output:"fetch failed",
source:"utility-brain"}}` for ANY unknown (domain,name). This masks "this macro doesn't
exist / isn't wired" as a transient LLM outage. Should return a clean `unknown_macro`.
Hit by world.list, fishing.*, mahjong.*, karaoke.*, photography.*, minigames.constants.

**#4 — `guns.spread_at` always returns spread 0.**
Profile declares spreadBloom:0.5 but spread_at({archetype:"smg",distanceM:20,shotIndex:5})
returns {spread:0}. Ranged spread bloom never accumulates → pinpoint accuracy at any range/
burst. Undermines the "guns balanced not OP" anti-OP lever.

**#5 — `guns.damage_at_range` silently ignores `distance`, reads only `distanceM`.**
Passing the obvious param `distance:50` yields distanceM:0 → full base damage (no falloff).
No validation/alias. Falloff only fires if caller knows the exact key `distanceM`.

**#6 (minor) — `creatures.taxonomy` param-naming inconsistency.**
Reads camelCase `speciesId` while sibling `creatures.for_world` + the rest of the codebase use
snake_case `species_id`. Passing the conventional `species_id` yields `missing_species_id`.
Works only with `speciesId`. Inconsistent within the same domain file.

## Wave 5 — boot with all features ON (orphan-server saga aside)

**#7 — Seed-pack loader crashes on null.**
Boot log: `[Seed-Pack] Failed to load seed packs: Cannot read properties of null (reading 'slice')`.
A null guard is missing in the seed-pack loader; seed packs silently fail to load.

**#8 — `breakthrough_clusters` heartbeat throws "clusters is not iterable".**
`heartbeat_module_error {"module":"breakthrough_clusters","error":"clusters is not iterable"}`.
The lattice breakthrough-pass heartbeat iterates a value that isn't an array on this path. Caught
by the dispatcher try/catch (so the tick survives) but the module does zero work every cycle.

**#9 — `[REPAIR] Lattice audit error: object is not iterable`.**
A second lattice-side iterability bug (repair-cortex lattice audit). Same class as #8 — something
returns an object/null where an iterable is expected.

**#10 — `achievement-engine catalog_persist_failed` (x4 at boot).**
The achievement catalog fails to persist 4 entries at startup — achievements may not all register.

## Wave 6 — the big one: ghost-fleet macros register but don't dispatch

**#11 — ~36 macros across ~18 ghost-fleet domains are undispatchable despite logging "loaded".**
Domains affected (every action falls through to the LLM via `/api/lens/run`):
`agents.*`, `quest.*` (create/get/list/start/active), `religion.*`, `research.*`, `city.*`,
`autonomy.*`, `teaching.*` (creative/teaching/autonomy profiles), `breakthrough.*`,
`forgetting.status`, `attention_alloc.status`, `repair_network.status`, `skill_tree.catalog`,
`history.search`, `cri.*`, `ingest.stats`, `promotion.get`, `*.constants` (crime/city/politics/
real_estate/religion/romance/survival/sports_careers/minigames).

PROOF: `/api/lens/run` dispatch (server.js:37882) is LENS_ACTIONS → MACROS → LLM-fallthrough.
A "fetch failed / source:utility-brain" response is ONLY reachable when
`MACROS.get(domain)?.get(action)` is falsy — i.e. the macro is NOT in MACROS at request time.
Yet `initGhostFleet()` (server.js:15774, invoked :16684) runs `register("agents",...)` etc. and
each module logs `ghost_fleet_module_loaded {macros:N}` AFTER its register calls. So they register
but don't persist into the dispatched MACROS map. MACROS is declared at :10468 (no TDZ on MACROS
itself). Sibling registrations in the SAME function that DO work (council.understanding_for_proposal
→ "forbidden", chat.compose_thread_understanding → "invalid_args") appear to survive only because
they're also registered synchronously elsewhere — i.e. the ghost-fleet async-registration path is
the broken one. quest-engine logged loaded(macros=10) but quest.list is dead → the entire authored
quest macro surface is unreachable through the lens bus.
Candidate root cause: fire-and-forget `initGhostFleet().catch()` registers in async microtasks that
land after some consumer has already snapshotted/forwarded MACROS, OR a later boot step rebuilds the
per-domain inner Map. Needs a one-line probe of `globalThis.__CARTOGRAPHER__.MACROS.has('agents')`
at steady state to confirm which.

Severity: HIGH — quest/religion/research/city/agents lens surfaces silently 500-equivalent for any
client, masked as a transient "LLM unavailable" instead of a hard wiring error.

## Wave 7 — spell flow (mint→cast works; potency is wrong)

**#12 — Glyph `cast` bypasses the hub's no-violence law.**
`/api/worlds/concordia-hub/combat/attack` correctly 403s with `concordant_law_refusal`, but
`glyph_spells.cast` of a FIRE spell in concordia-hub succeeds AND writes thermal/fire feedback
signals into the neutral ground (`feedbackApplied:2`). The "No violence is possible here" invariant
is enforced on the combat route but not the spell-cast macro. Inconsistent enforcement.

**#13 — Pillar-3 cross-world potency is not implemented for glyph spells (native cast < 1.0).**
`mintSpell` never stamps a `native_world`, and `glyph_spells.cast` calls
`cross-world-effectiveness.js#effectivenessMultiplier({domain,worldId,level})` WITHOUT the spell's
origin world. A hub-native fire spell cast in its OWN hub returns crossWorldMultiplier 0.85, not the
1.0 the design ("full in your native/friendly world") requires. The whole native-vs-foreign axis is
absent for spells.

**#14 — Cross-world effectiveness reads the wrong world modulator key → magic world nerfs magic.**
`effectivenessMultiplier` resolves a world's power via `rule_modulators.skill_affinity[domain]`, but
worlds actually define `skill_effectiveness_rules` + `skill_resistance` (fable-world:
`skill_effectiveness_rules.magic.multiplier = 1.5`). The lib never reads those, falls back to the
0.7 neutral default, so the SAME fire spell casts WEAKER in the 1.5× magic world (0.70) than in the
standard hub (0.85). Fire magic is penalized in the magic realm — the opposite of intent.

## Wave 8 — runtime log harvest (full-feature boot)

**#15 — `dtu.gapPromote` throws "Converting circular structure to JSON" (consolidation broken).**
The DTU gap-promotion macro (part of the every-30-tick MEGA/HYPER auto-consolidation pipeline)
crashes trying to JSON.stringify a DTU whose `state.__chicken2 … meta.domain` forms a circular
reference. Repeats every consolidation cycle. Self-compression substrate silently failing at runtime
(caught by macro_uncaught_throw wrapper, so no crash — but the promotion never completes).

**#16 — Chicken2 safety guard THROWS during consolidation instead of skipping.**
Second gapPromote throw: `c2_guard_reject:negative_valence_projection:harm`. The Chicken2 valence
guard raises an exception that propagates out of the macro rather than returning a structured
`{ok:false, reason}` and skipping the candidate. A single "harmful"-scored DTU (e.g. authored prose
with the word "harm"/"cage") aborts the whole gap-promotion pass.

**#17 — Silent duplicate macro registrations: `chat.summary`, `ingest.queue`.**
`macro_duplicate_registration` fires for both — second registration silently shadows the first.
Known class per register()'s own comment, but still live (which handler wins is registration-order
dependent / fragile).

**#18 — `/api/feeds` returns 503 `feed_manager_not_initialized` (logged as [ERROR]).**
The feed manager fails to initialize at boot, so the feeds route hard-503s for every caller. (Boot
also shows the external RSS fetches 403'ing — but the manager should still initialize empty rather
than refuse all reads.)

**#19 — Mis-ordered `runMacro` call at server.js:25420 (ctx passed as domain).**
`await runMacro(ctx, "dtu", "gapPromote", { minCluster:6, ... })` — but the signature is
`runMacro(domain, name, input, ctx)`. So domain=ctx(object), name="dtu", input="gapPromote"(string),
ctx={opts}. The MEGA-promotion tick at this site silently no-ops (wrapped in a silent catch). The
correctly-ordered sibling call at :33181 is the one actually doing consolidation.

**#20 — ROOT CAUSE of #15: `runMacro(ctx, "dtu", "cluster", ...)` mis-ordered INSIDE gapPromote (server.js:21085).**
The gapPromote handler reuses clustering via `await runMacro(ctx, "dtu", "cluster", {...})` — again
ctx-as-domain. This is what throws the circular-JSON (#15): runMacro processes the circular `ctx`
object as `domain`. Even when it doesn't throw, `clustersRes.ok` is falsy → gapPromote returns
`{ok:false, error:"cluster_failed"}`. NET EFFECT: the DTU MEGA→HYPER self-consolidation pipeline —
the headline "self-compressing knowledge substrate" — does not function at runtime. Fix is a 2-call
arg reorder (`runMacro("dtu","cluster",{...},ctx)` and same at :25420). (server.js:44191
`runMacro(lens, action, …)` is fine — `lens` there is a string domain.)

## Wave 9 — read-route coverage + frame data

**#21 — `/api/combat/frame-data/:skillId` returns `no_skill` for every common skill.**
Tried punch, kick, jab, cross, slash, melee, light_attack, heavy_attack, fireball — all
`{ok:false,"error":"no_skill"}` (and with HTTP 404, a status/body contract mix). The "derived from
DTU substrate" frame-data has no skills to derive from on a fresh DB, so the parry/dodge/active
timing windows that gate Skyrim-style combat have no data source for any default move.

**#22 (minor) — Leaderboards expose only 4 categories (sparks/skills/crafts/nemesis).**
No `combat`, `wealth`, or `global` board despite combat + economy being central; common category
guesses 400 with `unknown_category`.

## Wave 10 — reasoning + documented-flow mismatches

**#23 — `/api/reasoning/run` rejects `mode=constraint_check` — breaks the documented DriftAlertToast flow.**
CLAUDE.md DC7 invariant: the drift toast's "Resolve via constraint check" button POSTs
`/api/reasoning/run` with `mode=constraint_check`. The route rejects it: `{ok:false,
error:"invalid_mode", allowed:[deductive,inductive,abductive,adversarial,analogical,temporal,
counterfactual]}`. `constraint_check` isn't an accepted mode, so the user-facing drift-resolution
action fails every time. (The internal lattice-orchestrator drift→runHLR bridge may use a different
entry, but the HTTP route the frontend calls is broken for this mode.)

**#24 (minor) — `/api/reasoning/run` advertises modes in UPPERCASE but validates in lowercase.**
Response top-level `modes:["DEDUCTIVE",...]` while `result.allowed:["deductive",...]`. A client that
echoes the advertised UPPERCASE mode back gets `invalid_mode`. Also returns HTTP 200 on a validation
failure (should be 400).

## Wave 11 — runtime perf + false-positive harvest

**#25 (systemic) — `/api/lens/run` returns HTTP 200 for ALL outcomes.**
Validation failures, not-found, unknown/dead macros, and internal errors all return HTTP 200 with
`{ok:true, result:{ok:false,...}}`. Clients can't distinguish success from failure by status code;
monitoring/proxies see everything as 200. (Seen across the whole sweep — not_listed, missing_inputs,
invalid_mode, fetch-failed all 200.)

**#26 — 6.25s event-loop stall at boot (`event_loop_lag_spike maxMs:6250`).**
A single synchronous block (likely the 2001-DTU bootstrap / store migration) freezes the event loop
for 6.25 seconds — every in-flight request stalls. mean 69ms / p99 123ms otherwise.

**#27 — `/api/lens/run` can hang ~96 seconds.**
`slow_request durationMs:96167` on /api/lens/run. The dead-macro → utility-brain fallthrough (#3/#11)
waits on the LLM timeout/backoff instead of failing fast, so a call to any unwired macro can block
for a minute and a half. DoS-adjacent: an unauthenticated-ish caller hitting dead macros ties up a
worker for 96s each.

**#28 — Root `/` request took 43s (`slow_request durationMs:43613`).**
Likely the same boot-stall window (#26); a page load during boot blocks 43s.

**#29 — DTU injection detector is 100% false-positive (71/71 with `patterns:[]`).**
Every `dtu_injection_detected` warning at runtime has an EMPTY `patterns` array — it fires the
detection (and applies `quarantine:injection-review` tags) on internal autogen content with zero
matched patterns. 57 `system.dream` + 14 `system.evolution`. The detector flags + quarantines
legitimate internal DTUs whenever the patterns list is empty instead of treating empty-match as
clean. (This is why Vael's own minted note got auto-tagged `quarantine:injection-review`.)

## Wave 12 — cross-user / privacy / licensing

CORRECTIONS: **#4 and #5 RETRACTED** — both were my own param errors during probing.
`guns.spread_at` reads `consecutiveShots` (spread blooms correctly: 0.69 @ 8 shots);
`guns.damage_at_range` reads `distanceM` (falloff works). Not bugs. Net genuine findings exclude these.

GOOD (verified working, not bugs): cross-user private-DTU read returns "DTU not found" (privacy
holds); marketplace purchase of unlisted → not_listed; immortal NPC kill → 403; hub no-combat → 403.

**#30 — Spell licensing path crashes: `glyph_spells.cast` queries non-existent columns.**
For a non-owner casting a spell, the license check (domains/glyph-spells.js:80) runs
`SELECT 1 FROM dtu_citations WHERE creator_id=? AND parent_id=? AND kind='license'`. But
`dtu_citations` has columns `dtu_id, citation_count, first_cited, last_cited, positive_signals,
negative_signals` — NONE of `creator_id`, `parent_id`, `kind` exist. Result: `macro_uncaught_throw —
no such column: creator_id`. So you can NEVER cast a spell you licensed/bought from another creator;
it hard-errors. The query is also pointed at the wrong table (citation-aggregate, not a license-grant
ledger).

**#31 — Vehicles spawn into a non-existent world id by default (`"concordia"` ≠ `"concordia-hub"`).**
`POST /api/vehicles/spawn` defaults `world = "concordia"` (routes/vehicles.js:50). The canonical hub
world id is `"concordia-hub"` (per /api/worlds). A vehicle spawned with the default — or by any caller
using the platform-standard `worldId` key (the route reads `world`/`type`, not `worldId`/`vehicleType`,
so those are silently ignored) — is stored under world `"concordia"`, which matches no row in `worlds`.
The vehicle is then orphaned/invisible to any world-scoped query using the real id. Both the wrong
default and the param-name divergence (`world` vs platform-wide `worldId`) are the issue.

**#32 — `dtu.create` reports success but never persists the DTU (silent data loss). [SEVERE]**
`POST /api/lens/run {dtu.create}` returns `{ok:true, dtu:{id:"dtu_…"}}`, but an IMMEDIATE
`dtu.get` by that exact id on the SAME server returns `{ok:false,"DTU not found"}`, and the row never
appears in the SQLite `dtus` table (checked t+0/2/5s). STATE holds 1522 DTUs (boot/autogen/consolidation)
so the store works — but the user-initiated create path doesn't land its result in `STATE.dtus`.
Not the daily soft cap (response `warning:null`, no `dtu_daily_soft_cap_exceeded` log). Likely an
early/caught return of the constructed `dtu` object before the `STATE.dtus.set`/persist step (the
create macro is ~410 lines with mutex + consent + Chicken2 paths; cf. #16 where the c2 guard THROWS).
Reproduced 100% with benign content. Impact: anything a player/agent explicitly authors via the DTU
macro is acknowledged but lost — the substrate's headline "create a thought" verb.
