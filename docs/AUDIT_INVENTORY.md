# Concord Cognitive Engine — Audit Inventory (verified by direct codebase inspection)

Originally generated: 2026-05-14 (post-Foundry merge — PR #361 / commit `6d32663`). **Top-level counts re-verified 2026-06-02.**

> **⚠️ AUTHORITY REVERSED (2026-06-02).** This file's old banner said "numbers in
> CLAUDE.md that disagree are stale — trust this file." That is now BACKWARDS:
> this file's prose body is a 2026-05-14 snapshot and has drifted, while
> CLAUDE.md's inventory table was re-verified 2026-06-02. **The current
> source-of-truth for counts is `npm run check-doc-claims` (re-runs every
> reproduction command and fails on drift) + CLAUDE.md's refreshed table + `npm
> run count-loc` for LOC.** The top-level table below was refreshed 2026-06-02;
> the per-system prose further down is historical (2026-05-14) and may lag —
> always trust a live `grep`/`ls`/`wc` over any prose number here.

## Top-level counts (re-verified 2026-06-02)

| Surface | Count | How to reproduce |
|---|---|---|
| Lens directories (frontend) | **259** | `ls -d concord-frontend/app/lenses/*/ \| wc -l` |
| Backend domain files | **351** | `ls server/domains/*.js \| wc -l` |
| Migrations applied | **322** | `ls server/migrations/[0-9]*.js \| wc -l` (numbered only) |
| Latest migration | `323_item_enchantments.js` | `ls server/migrations/ \| grep -E '^[0-9]{3}_' \| sort \| tail -1` |
| Route files | **131** | `ls server/routes/*.js \| wc -l` |
| Emergent modules | **211** | `ls server/emergent/*.js \| wc -l` |
| Lib modules | **546** top-level (`ls server/lib/*.js \| wc -l`) · **834** recursive (`find server/lib -name "*.js" \| wc -l`) | — |
| `server/server.js` line count | **75,684** | `wc -l server/server.js` |
| `server/dtus.js` line count | **145,612** (deprecated data seed pack — NOT code; see `npm run count-loc`) | `wc -l server/dtus.js` |
| HTTP routes in server.js | **1,390** | `grep -hcE '^\s*app\.(get\|post\|put\|delete\|patch)\(' server/server.js` |
| HTTP routes in routes/*.js | **1,346** | `grep -hcE '^\s*router\.(get\|post\|put\|delete\|patch)\(' server/routes/*.js \| paste -sd+ - \| bc` |
| HTTP routes (combined) | **~2,736** | sum of the two above (cartographer counts more, incl. socket + macro dispatch surfaces) |
| Distinct CREATE TABLE statements across migrations | **670** | `grep -hoE "CREATE TABLE\s+(IF NOT EXISTS\s+)?[a-z_]+" server/migrations/*.js \| sed -E 's/.*CREATE TABLE\s+(IF NOT EXISTS\s+)?([a-z_]+).*/\2/' \| sort -u \| wc -l` |
| Unique heartbeats registered | **124** | `grep -rohE "registerHeartbeat\(['\"][a-z0-9-]+['\"]" server/ \| sort -u \| wc -l` |
| Authored source LOC | **~2.05M** (2.71M incl. content) | `npm run count-loc` — the prior "~1,364,000" here was a `cat \| wc -l` over everything incl. the 145k-line `dtus.js` data pack; `count-loc` excludes generated/data and is the source of truth |
| Test files | **1,118** | `find server/tests tests -name '*.test.js' -o -name '*-tests.js' \| wc -l` |

> **Test pass total not re-verified at this HEAD.** The prior inventory recorded 12,244 passing (10,940 main + 1,304 behavior) at the migration-158 era. Migrations 159–192 and the Foundry phases added test files; re-run `cd server && npm test` to get a current figure before quoting one.

## Drift since the previous inventory (2026-05-10 migration-158 era → 2026-05-14 HEAD `6d32663`)

| Surface | Was | Now | Δ | Cause |
|---|---|---|---|---|
| Lens directories | 206 | 232 | +26 | Migrations/PRs through #361 — incl. Foundry lens (#125), plus the lens build-out waves |
| Backend domain files | 210 | 249 | +39 | New domain backends across the cross-world economy, classroom/research, vehicles, dynasty, war, and Foundry work |
| Migrations | 158 | 192 | +34 | 159–192: federation peer, player scars, artifact economy, spectator betting, economy primitives, code-loop safety, classroom/research, cross-world economy + relationships, population migration, event timeline, BYO brain overrides, agent marathon sessions, hook artifacts, bloodline ancestry, actor physique, realm exiles, player stamina, world vehicles, underwater features, tunyan jobs, multi-step crafts, aging dynasty, culture marriage, council sessions, creature homes, world NPC xyz, war campaigns, avatar appearance, world markers, NPC equal agency, mount behavior, Foundry worlds, Foundry phase 7 |
| Latest migration | `158_kingdoms.js` | `192_foundry_phase7.js` | — | Foundry Phase 7 closeout |
| Route files | 130 | 131 | +1 | `routes/foundry.js` (the Foundry HTTP surface) |
| HTTP routes (combined) | 2,399 | 2,400 | +1 | Net of server.js growth + the Foundry route file |
| Emergent modules | 166 | 178 | +12 | New heartbeat-driven cycles: war/skirmish, agent-marathon, underwater-threat, NPC-vs-NPC combat, plus internal handlers |
| Lib modules (top-level) | 292 | 341 | +49 | BYO-key router, Foundry generators, cross-world economy, dynasty/ancestry, vehicles, council, war-campaign, and more |
| `server/server.js` line count | 67,784 | 70,238 | +2,454 | Inline route + macro additions (server stays intentionally monolithic) |
| Heartbeats | 50 | 64 | +14 | war-skirmish-cycle, agent-marathon-cycle, underwater-threat-cycle, npc-vs-npc-combat, and more — full list below |
| Brains | 5 (with OpenAI emergency fallback) | 5 (BYO-key router replaces OpenAI fallback) | — | The OpenAI emergency-fallback path was removed (`sec(byo)` — "drop OpenAI relics"); `ctx.llm.chat()` now routes per-user, per-slot through the BYO key router (migration 170) |

## Brain configuration — verified from `server/lib/brain-config.js`

`BRAIN_CONFIG` is the frozen default. Every model and URL is env-overridable.

| Brain | Default model | Port | Role |
|---|---|---|---|
| Conscious | `concord-conscious:latest` (custom model built on qwen2.5) | 11434 | Chat, deep reasoning, council deliberation |
| Subconscious | `qwen2.5:7b-instruct-q4_K_M` | 11435 | Autogen, dream, evolution, synthesis, birth |
| Utility | `qwen2.5:3b` | 11436 | Lens interactions, entity actions, quick domain tasks |
| Repair | `qwen2.5:0.5b` | 11437 | Error detection, auto-fix, runtime repair |
| Multimodal / Vision | `qwen2.5vl:7b` | 11438 | Image understanding, food vision, document layout |

`ctx.llm.chat()` routes to conscious, falls back to subconscious. **There is no OpenAI emergency-fallback path anymore** — when a user supplies an external API key, their individual brain slots route through the BYO key router (`server/lib/` BYO router, migration 170 `byo_brain_overrides`).

## Economy constants — verified from code (constitutional invariants — do not change without governance approval)

| Constant | Value | Source |
|---|---|---|
| DTU royalty-aware path creator pool | **95%** (`creatorPool = price * 0.95`); 5% platform | `server/server.js:34002` (`register("marketplace","purchaseWithRoyalties")`) |
| Economic marketplace fee | **4%** (`MARKETPLACE_FEE: 0.04`) | `server/server.js:63516` (`ECONOMIC_CONFIG`) |
| Economic marketplace creator share | **70%** (`CREATOR_SHARE: 0.70`) | `server/server.js:63517` |
| Economic marketplace royalty share | **20%** (`ROYALTY_SHARE: 0.20`) | `server/server.js:63518` |
| Economic marketplace treasury share | **10%** (`TREASURY_SHARE: 0.10`) | `server/server.js:63519` |
| Token-purchase fee | **1.46%** (`TOKEN_PURCHASE_FEE: 0.0146`) | `server/server.js:63515` |
| Platform fee rate / total max fee | **1.46% / 5.46%** (`PLATFORM_FEE_RATE 0.0146`, `TOTAL_FEE_RATE 0.0546`) | `server/lib/creative-marketplace-constants.js:423-425` |
| Initial royalty rate | **21%** (`INITIAL_ROYALTY_RATE 0.21`) | `server/lib/creative-marketplace-constants.js:427` |
| Royalty halving / floor / cascade depth | **÷2 per gen / 0.05% / 50 deep** (`ROYALTY_HALVING 2`, `ROYALTY_FLOOR 0.0005`, `MAX_CASCADE_DEPTH 50`) | `server/lib/creative-marketplace-constants.js:428-430` |
| Max royalty to ancestors | **30% of sale price** (`MAX_ROYALTY_RATE = 0.30`) — seller always keeps **≥64.54%** | `server/economy/royalty-cascade.js:263` |
| Withdrawal hold | **48 hours** (`WITHDRAWAL_HOLD_HOURS = 48`) | `server/economy/withdrawals.js:23` |

## Heartbeats — verified by direct grep (64 unique)

Each is registered via `registerHeartbeat(name, { frequency, handler })`; 1 tick = 15s. Frequency-sorted (from `audit/cartograph/SYSTEMS.md`):

`refusal-field-sweep` (1) · `war-skirmish-cycle` (2) · `combat-recovery-cycle` (2) · `signal-propagation-cycle` (3) · `creature-flock-cycle` (4) · `scheduled-posts` (4) · `affect-tick` (4) · `social-npc-bridge` (5) · `eco-expiry-sweep` (5) · `npc-routine-cycle` (5) · `environment-sensor` (5) · `environment-sense` (5) · `underwater-threat-cycle` (6) · `npc-vs-npc-combat` (8) · `npc-perception-snapshot` (8) · `npc-economy-cycle` (8) · `npc-conversation-initiator` (8) · `npc-knowledge-bridge` (10) · `corpse-cleanup` (10) · `agent-marathon-cycle` (12) · `kingdom-decree-cycle` (16) · `metrics-decay` (20) · `repair-cycle` (20) · `npc-scheme-cycle` (30) · `fauna-spawner` (30) · `personal-beat-scheduler` (60) · `lattice-drift-scan` (60) · `embodied-dream-cycle` (80) · `npc-skill-evolve-cycle` (80) · `forward-sim-cycle` (100) · `lattice-federation-poll` (120) · `lattice-quest-cycle` (180) · `faction-strategy-cycle` (200) · `npc-marketplace-cycle` (240) · `lattice-breakthrough-pass` (240) · `player-signs-cleanup` (240) · `season-cycle` (480) · plus `brain-daily-refresh`, `brain-outcome-resolver`, `code-substrate-refresh`, `culture-drift-pass`, `detectors-sweep`, `forgetting-health-check`, `land-claims-cycle`, `mount-care-cycle`, `presence-stale-sweep`, `procedural-npc-spawner`, `procgen-settlement-cycle`, `qualia-persist`, `reflex-architectural-drift`, `reflex-dependency-entropy`, `reflex-scaling-pressure`, `reflex-unsafe-expansion`, `understanding-evolve`, and the remaining cycles. Regenerate the authoritative frequency-sorted list with `npm run cartograph:static`.

Every handler is wrapped in `try/catch` — a heartbeat module must never throw. `concord_heartbeat_ticks_total` increments per tick; `concord_heartbeat_skipped_total` increments on overrun.

## Migration ledger — 192 numbered files

Migrations are append-only and run at startup; `schema_version` tracks the high-water mark. The full list is `ls server/migrations/[0-9]*.js`. Notable ranges:

- **001–111** — core platform: economy, federation, creative marketplace, OAuth, security intelligence, Concordia worlds, skill progression, NPC enhancements, combat, quests, evo-assets, affect/qualia state.
- **112–118** — embodied substrate layers 7–13: `embodied_signals`, `pain_signals`, `dreams`, `forward_predictions`, `faction_strategy`, `npc_conversations`.
- **119–158** — understandings, mount substrate, macro-call billing, repair feedback, signal-propagation indexes, player signs, quest triggers, player corpses, then Sprint D (npc_stress, character_opinions, secrets, npc_schemes, creature_swim_depth, player_oxygen, realms/kingdoms).
- **159–192** — federation origin peer, player scars + avatar drift, artifact economy, spectator betting, economy primitives, code-loop safety, classroom/research, cross-world economy + relationships, population migration, event timeline, **BYO brain overrides (170)**, agent marathon sessions, hook artifacts, bloodline ancestry, actor physique, realm exiles, player stamina, world vehicles, underwater features, tunyan jobs, multi-step crafts, aging dynasty, culture marriage, council sessions, creature homes, world NPC xyz, war campaigns, avatar appearance, world markers, NPC equal agency, mount behavior, **Foundry worlds (191) + Foundry phase 7 (192)**.

Migration numbers 141, 143 are `_drop_dead_mig*` debt-cleanup migrations renumbered to dodge collisions during the merge wave. See git history for the full collision ledger.

## Content worlds — 9 authored

`content/world/` holds: `concordia-hub`, `concord-link-frontier`, `crime`, `cyber`, `fantasy`, `lattice-crucible`, `sovereign-ruins`, `superhero`, `tunya`. Each `content/world/<name>/` directory is auto-discovered by `server/lib/content-seeder.js#discoverSubWorlds()` and seeds idempotently at startup. `content/quests/` holds the authored quest chains; `content/foundry-templates/` holds the Foundry world-builder templates; `content/dialogues/` holds hand-authored idle dialogue trees.

## SDK & clients

- `sdk/` — `@concord/sdk` v0.1.0 (DTU protocol surface + examples). **There is no `packages/` directory** — the "12 `@concord` npm packages" described in older docs were consolidated during the absorbed-libs audit (most dropped as mock/duplicate code; survivors folded into `server/lib/`). See `audit/cartograph/ABSORBED_LIBS.md`.
- `concord-vscode/`, `concord-jetbrains/`, `concord-lsp/` — IDE integrations + language server.
- `extension/` — browser extension.
- `concord-mobile/` — React Native 0.76 + Expo 52 native app (~42K LOC).

## Stack versions — verified from package.json

| Surface | Version |
|---|---|
| Frontend — Next.js | `^15.5.15` |
| Frontend — React | `^19.2.6` |
| Frontend — TypeScript | `^5.9.3` |
| Mobile — Expo | `~52.0.0` |
| Mobile — React Native | `0.76.6` |
| Backend — better-sqlite3 | `^11.10.0` |
| Frontend component directories | 97 (`ls -d concord-frontend/components/*/ \| wc -l`) |
| Frontend custom hooks | 36 (`ls concord-frontend/hooks/*.ts* \| wc -l`) |

## Docker — 13 services

`docker-compose.yml` defines: `backend`, `frontend`, `nginx`, `certbot`, `prometheus`, `grafana`, `redis`, `qdrant`, and five Ollama brain services (`ollama-conscious`, `ollama-subconscious`, `ollama-utility`, `ollama-repair`, `ollama-vision`).

## How to refresh this file

1. `cd server && npm run cartograph:static` — regenerates `audit/cartograph/SYSTEMS.{json,md}` (tables, routes, socket events, heartbeats, lenses).
2. `cd server && npm run detectors:report` — regenerates `audit/detectors/REPORT.md` (stale code, macro usage, perf hotspots).
3. Run the per-row reproduction commands above for the top-level counts.
4. Update the "Generated" line and the drift table.
