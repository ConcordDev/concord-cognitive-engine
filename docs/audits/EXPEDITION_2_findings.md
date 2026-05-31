# Vael's Expedition II — 30 MORE (distinct from round 1) — Sun May 31 21:27:16 UTC 2026

**#R1 — `goals.propose` throws `Cannot read properties of undefined (reading 'push')`.**
Any call crashes pushing to an undefined array (uninitialised goals store). macro_uncaught_throw,
not a graceful error.

**#R2 — `skill.create` raises validation as an UNCAUGHT THROW.**
Missing title surfaces as `macro_uncaught_throw / "title required"` instead of a structured
`{ok:false,error}`. Validation-by-throw — the handler `throw`s where it should `return`.

**#R3 — `explore.run` throws `Cannot convert undefined or null to object`.**
Crashes even with `{goal,steps}` supplied — Object.keys/entries on an undefined value before guarding.

**#R4 — Entire `/api/film-studio` feature is inaccessible (mounted without requireAuth). [HIGH]**
server.js:30508 `app.use("/api/film-studio", createFilmStudioRouter({ db }))` omits `requireAuth`.
The router's auth shim (routes/film-studio.js:61-62) hard-fails with 401 "Authentication required"
whenever `typeof requireAuth !== "function"` — so EVERY film-studio route 401s for every user,
even with a valid token. The whole film-studio surface is dead.

**#R5 — `/api/evo-asset/interaction` 500s on a non-existent assetId.**
Only `!assetId` (null) is guarded; a present-but-invalid `assetId` flows into `recordInteraction`
which throws (FK/lookup) → caught → HTTP 500 "An unexpected error occurred". Should validate the id
and 404, not 500.

**#R6 — `/api/billing/*` write paths locked out (mounted without requireAuth).**
server.js:30516 `createAPIBillingRouter({ db })` — no requireAuth → `authForWrites` shim returns 401
`auth_not_configured` for every write. (Same root mount-arg bug class as #R4 film-studio; storage/
lens-culture/legal/dtu-format/lens-compliance share the shim but their probed routes reached
validation, so only billing + film-studio are confirmed fully locked.)

**#R7 — `/api/world/workstations/start` 500: destructures `districtId` of undefined.**
`Cannot destructure property 'districtId' of 'undefined'` — handler destructures a nested object
that isn't present, before guarding. Unhandled 500 on a benign call.

**#R8 — `/api/cdn/purge-all` crashes on null cdnManager (mounted `cdnManager: null`).**
server.js:32126 mounts the CDN router with `cdnManager: null`; purge tries `cdnManager.purgeByPrefix`
→ "Cannot read properties of null". Worse, the response surfaces as a chat-handler reply
(`meta.mode:"chat"`), i.e. the route fell through to the LLM catch-all.

**#R9 — Skill teaching/interaction DTU inserts crash: `dtus` has no `lineage` column.**
`lib/skill-effectiveness.js:144` and `lib/skill-interaction.js:148` both run
`INSERT INTO dtus (id,type,title,content,creator_id,world_id,lineage,skill_level,total_experience,...)`
but the live `dtus` table has no `lineage` column (verified PRAGMA). Any cross-world skill
adaptation / skill-interaction DTU mint throws `no such column: lineage`. Same schema-drift class as
round-1 #30 (dtu_citations).

**#R10 — Skill prestige crashes: `UPDATE dtus SET meta` (no `meta` column).**
routes/worlds.js:600 `UPDATE dtus SET meta = json_patch(COALESCE(meta,'{}'), ?) WHERE id=?` — `dtus`
has no `meta` column (it's `metadata_json`/`data`). The prestige loop's first UPDATE (skill_level/
total_experience/practice_count) is fine; this second one throws `no such column: meta`, so prestiging
a skill errors out mid-flow.

## Wave 13 — schema-drift cluster (wrong column vs live PRAGMA, in real db.prepare calls)
Method: PRAGMA table_info for all 649 live tables → scan every db.prepare query → flag column refs
absent from the target table (subqueries stripped to avoid FP; forge-template + Postgres paths
excluded; 5 hand-verified by reading source + schema). Each crashes `no such column` when its path runs.

**#R11** server.js:74859 — `skill_revisions ✗ npc_id`
**#R12** domains/chronicle.js:42 — `dtus ✗ kind` (dtus has `type`, not `kind`)
**#R13** domains/dx.js:266 — `economy_ledger ✗ user_id` (table has from_user_id/to_user_id)
**#R14** domains/faction-strategy.js:79 — `faction_strategy_log ✗ created_at`
**#R15** lib/archetype-needs.js:49 — `economy_flows ✗ faction, ts`
**#R16** lib/archetype-needs.js:64 — `npc_conversations ✗ started_at`
**#R17** lib/archetype-needs.js:77 — `npc_schemes ✗ world_id, status`
**#R18** lib/chronicle/chronicle.js:105 — `realm_citizens ✗ realm_id`
**#R19** lib/code-substrate/code-dtu-emitter.js:256 — `dtus ✗ kind`
**#R20** lib/creator-dashboard.js:235/243/254/266 — `economy_ledger ✗ user_id` (creator $ dashboard balance/earnings all broken)
**#R21** lib/cross-world-economy.js:98 — `economy_flows ✗ created_at`
**#R22** lib/dtu-portability.js:78 — `dtu_citations ✗ creator_id, parent_creator_id`
**#R23** lib/dtu-portability.js:89 — `economy_ledger ✗ buyer_id, seller_id, creator_id` (DTU export corpus economics)
**#R24** lib/emergents/quality/deterministic-gates.js:39 — `dtus ✗ content_hash`
**#R25** lib/kingdoms.js:45 — `procgen_regions ✗ faction_id`
**#R26** lib/npc-skill-author.js:294 — `dtus ✗ meta_json`
**#R27** lib/stealth-perception.js:111 — `dtus ✗ owner_id, owner_type`
**#R28** routes/analytics.js:72 — `world_buildings ✗ created_by`
**#R29** routes/player-inventory.js:137 — `dtus ✗ owner_id`
**#R30** economy/chargeback-handler.js:74/83 — `purchases ✗ stripe_payment_intent_id, metadata_json` (Stripe chargeback handling broken)
**#R31** emergent/forward-sim-cycle.js:32 — `player_inventory ✗ recorded_at`
**#R32** emergent/nemesis-cycle.js:125 — `character_opinions ✗ from_npc_id, to_npc_id` [HAND-VERIFIED] (NEMESIS heartbeat — enabled this session)
**#R33** emergent/npc-vs-npc-combat-cycle.js:100-101 — `npc_grudges ✗ owner_npc_id, target_npc_id` [HAND-VERIFIED] (NPC-vs-NPC combat)
**#R34** lib/npc-legacy.js:228 — `dtus ✗ kind` [HAND-VERIFIED] (recipe inheritance on NPC death)
**#R35** emergent/mount-behavior-cycle.js:62 — `world_resource_nodes ✗ kind` (has node_type) [HAND-VERIFIED] (mount grazing)

NOTE: `lib/secrets.js:219` was flagged but is a FALSE POSITIVE (the `user_id` belongs to a
`secret_discoveries` subquery, not `secrets`) — excluded honestly.
