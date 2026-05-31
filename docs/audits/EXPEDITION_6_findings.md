# Vael's Expedition VI — frontend runtime (no browser; build + static crash-pattern hunt) — Sun May 31 22:26:17 UTC 2026

## Wave 21 — migrations + schema-source-of-truth (authoritative)
**VERIFIED SOUND:** all 313 migrations apply cleanly on a FRESH empty DB (exit 0, schema v314). No
ordering/idempotency failure. This also CONFIRMS round-3: the ghost tables (user_wallets, world_events,
city_presence, npc_relations, refusal_field, …) are absent from a fresh-migrated DB too → genuinely
never created by anything, not a migration-order artifact.

**#F1 — 24 tables exist only as runtime `CREATE TABLE IF NOT EXISTS` (not in any migration).**
Live DB has 648 tables; fresh-migrated has 624. The 24-table gap (agents, agent_logs, agent_tasks,
social_groups + 6 social_* , spell_cast_log, world_forecasts, route_studio_* , forge_generations,
embedding_cache, reserves_*, knowledge_genomes, …) is lazily created by feature code at runtime. On a
fresh install, any query against one of these BEFORE its creating code path runs crashes
`no such table`. Notably `agents` is lazy AND its macros are dead (round-1 #11) — so /lenses/agents on
a fresh box is doubly broken. The migration ledger is not the schema source of truth; 24 tables live
in scattered code.

## Frontend runtime — METHOD-LIMITED (honest)
True browser-driven runtime audit is BLOCKED in this sandbox: playwright is installed but the chromium
binary can't download (no network egress). Static white-screen hunt (unguarded `result.X.map()` on
API responses) produced 143 strict candidates but they're guard-heavy and mostly safe-by-enclosing-
block — NOT claimable without a browser to trigger them. Flagged as a RISK CLASS, not N bugs:
**#F2 (risk) — unguarded response sub-field access** (e.g. cooking `actionResult.result.ingredients.map`
is rendered with `result.recipe` guarded but `ingredients` not). A partial/soft-fail macro response
missing the field would white-screen the lens. The right detector is a browser smoke-test in CI, not
static regex. Authoritative substitute below: `next build`.

## Wave 22 — `next build` (authoritative frontend compile, the no-browser substitute)
Status at writing: build cleared the **lint phase with WARNINGS ONLY** (no errors) — the only flags
were `react-hooks/exhaustive-deps` missing-dep warnings (e.g. PartyCombatHUD `TICK_MS`,
ContextPromptLayer `FRAME_THROTTLE_MS`). It then entered the (slow) optimize/compile phase; no compile
errors observed before cutoff. Combined with the earlier clean `tsc --noEmit` (0 errors) + clean
ESLint, the frontend **type-checks and lints clean** — the page-level code is structurally healthy.

**#F3 (cosmetic) — a handful of `useEffect` missing-dependency warnings** (PartyCombatHUD,
ContextPromptLayer, …). Non-fatal, but missing-dep on a poll/throttle constant can cause stale-closure
polling intervals. Worth a pass since these drive the live-polling HUDs (and the POLL_MS/throttle
dials are the same untuned-constants cluster CLAUDE.md flags).

## Expedition VI synthesis
The frontend's last blank map turned out mostly SOUND where I could measure it (tsc clean, lint clean,
build compiling clean) — the one thing I genuinely could NOT do is true browser-driven runtime
(no network → no chromium), so the client-crash class (#F2) stays a flagged RISK, not a confirmed
count. The real new finding is backend-shaped: **#F1 — 24 tables live only in runtime CREATE-IF-NOT-
EXISTS, outside the migration ledger**, a fresh-install read-before-create hazard that also explains
why a fresh box's agent/social/spell-cast surfaces can crash before warmup. Migrations themselves:
clean. Round-3 ghost tables: re-confirmed genuinely-never-created.

Net: rounds 1-6 converge on the SAME small root-cause set (schema-rename drift + ghost-fleet
registration gap + one injection), now with the frontend confirmed structurally healthy on top of a
backend whose bugs are breadth, not depth.
