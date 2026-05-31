# Vael's Expedition III — 30+ MORE (distinct from rounds 1 & 2) — Sun May 31 21:44:41 UTC 2026

**#V1 — Wagers allow self-wager (no proposer≠opponent check). [economy logic]**
`routes/wagers.js:36-39` validates only presence of opponentId/amount/currency — never that
`opponentId !== proposerId`. Proposing a wager with `opponentId = <my own id>` returns 201, and
`/accept` on it also returns 200 (I'm both sides). The stake is escrowed from me and the resolve
payout with proposer==opponent is undefined money movement (self-launder / balance-manipulation
vector). Needs `if (opponentId === proposerId) reject`.

**#V2 — `world_visits` ORDER BY `entered_at` (no such column) — dive-state + dream-engine crash.**
`world_visits` columns are `arrived_at`/`departed_at` (no `entered_at`). Two sites order by it:
server.js:50402 (the `/api/players/me/dive-state` submarine query) and lib/embodied/dream-engine.js:136
(offline dream fragment gather). Both throw `no such column: entered_at`. Schema-drift, distinct from
round-2 (this is an ORDER BY site, verified non-alias).

**#V3 — `sabotage_decree` cross-world scheme is a silent no-op (`realm_decrees` has no `world_id`).**
lib/cross-world-schemes.js:266 `UPDATE realm_decrees SET effect_state='sabotaged' WHERE id=? AND
world_id=?` — realm_decrees has `kingdom_id`, no `world_id`. Wrapped in try/catch (comment admits
"may not have world_id"), so the sabotage outcome silently never applies — the scheme resolves with
no effect.

**#V4 — Procedural NPC backstories silently lost (`procedural_npcs` PK is `npc_id`, not `id`).**
emergent/world-population-cycle.js:259 `UPDATE procedural_npcs SET backstory=? WHERE id=?` — table
has `npc_id`, no `id`. try/catch swallows the throw (comment: "backstory lost, NPC still alive").
Every procedurally-generated NPC's authored backstory fails to persist.

## Wave 14 — the `user_wallets` ghost table (never created, queried in 7 features) [HIGH]
`user_wallets` is referenced (SELECT/INSERT/UPDATE, columns `balance`/`concord_coins`) but is NEVER
created — not in any migration, not lazily. Live query → `no such table: user_wallets`. The canonical
wallet store is the `users` table (cc_balance/sparks — that's what the working wager path queries).
Every site below crashes:
**#V5** lib/auctions.js:261/264/281 — buy-order escrow + settlement (auction buy-side broken)
**#V6** lib/achievement-engine.js:287 — achievement CC reward payout
**#V7** lib/player-corpse.js:48 — corpse coin-loss read + credit (Dark-Souls corpse drop)
**#V8** lib/player-mail.js — mail COD / attachment money transfer (the "single-transaction" invariant)
**#V9** lib/weekly-objectives.js — weekly objective CC reward
**#V10** lib/world-buildings-repair.js — building repair cost debit
**#V11** lib/world-health.js — world-health economic sink

## Wave 15 — more ghost tables (queried, never created; verified real FROM/INTO)
Method: live `SELECT * FROM <t> LIMIT 1` → `no such table`; excluded lazy-created + try/fallback cases.
**#V12** server.js:50425 — `FROM creature_swim_depth` (sonar query; mig 156 added swim_depth as a COLUMN, no such table) → submarine sonar crashes
**#V13** lib/plague-event.js:72 — `INSERT INTO refusal_field` (table is `refusal_fields`, plural) → plague quarantine field never created
**#V14** lib/npc-legacy.js:94 + lib/spouse-reactivity.js:57 — `FROM npc_relations` (no such table) → heir lookup + spouse reactivity (E4) crash
**#V15** emergent/npc-perception-snapshot.js:52 — `FROM city_presence` (no such table) → NPC perception snapshot crashes
**#V16** routes/social-engagement.js:320 — `FROM economy_transactions` (table is `economy_ledger`) → social engagement economy query crashes
(EXCLUDED: `creative_artifact_listings` — forge-marketplace wraps it in try/v2→fallback/v1, handled.)

## Wave 16 — ghost-table cluster (verified real queries; most try/catch-swallowed → silent no-op)
**#V17** lib/governance/auto-proposal.js:101 — `INSERT INTO council_proposals` (no table) → auto-governance proposals silently never created
**#V18** lib/guidance-waypoint.js:26 — `FROM quest_state` (no table) → quest waypoint guidance silently empty
**#V19** lib/embodied/forward-sim.js:188 — `FROM quest_progress` (no table) → forward-sim quest anticipation degraded
**#V20** lib/embodied/forward-sim.js:214 — `FROM faction_members` (no table) → forward-sim faction prediction degraded
**#V21** domains/nemesis.js:92 — `FROM authored_npcs` (no table) → nemesis authored-NPC lookup silently null
**#V22** domains/crisis.js:184 — `FROM user_skills` (no table) → crisis skill check degraded
**#V23** lib/account-lifecycle.js:331/338 — `FROM direct_messages` + `FROM social_posts` (no tables) → GDPR account-data export omits messages/posts
**#V24** lib/news-story-composer.js:185 — `FROM lattice_drift_alerts` (no table, UNGUARDED) → news-story composition crashes (table is `drift_alerts`/lattice variant)
**#V25** lib/embodied/forward-sim.js — multiple ghost-table reads make forward-sim a degraded shell

## Wave 17 — ghost-table cluster (final, verified real queries)
**#V26** domains/patterns.js:20 — `FROM cross_domain_breakthroughs` (no table)
**#V27** domains/patterns.js:26 — `FROM cnet_federation_pulse` (no table)
**#V28** lib/account-lifecycle.js:398 — `UPDATE citations` (table is `dtu_citations`) → GDPR citation-anonymization no-op
**#V29** domains/ghost-hunt.js:118 — `FROM drift_alerts` (no table; real table is the lattice drift store) → ghost-hunt drift feed broken
**#V30** lib/combat/match-chronicle.js:66 — `FROM combat_flow` (table is `combat_flows`, plural) → match chronicle flow lookup crashes
**#V31** domains/messaging.js:32 — `INSERT INTO messaging_adapters` (no table) → messaging adapter registration fails
**#V32** lib/audit/provenance.js:74 — `FROM lenses` (no table) → audit/provenance lens lookup crashes

## Meta-finding (rounds 2+3)
The ghost-table cluster (#V5-V32) and the column-drift cluster (round-2 #R11-R35) share ONE root
cause: the schema was renamed/consolidated over time (singular→plural: refusal_field→refusal_fields,
combat_flow→combat_flows; store moves: user_wallets→users, world_events→world_events_log,
economy_transactions/citations→economy_ledger/dtu_citations, npc_relations→npc_nemesis) but a large
swath of code still references the OLD/WRONG names. Nothing in CI dry-runs the SQL, so every one ships.
A boot-time "prepare every statement against the schema" gate would catch this entire class.
