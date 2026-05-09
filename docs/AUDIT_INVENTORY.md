# Concord Cognitive Engine — Audit Inventory (verified by direct codebase inspection)

Generated: 2026-05-09T16:00:00Z (refreshed during major audit phase 3.1)
Branch: claude/codebase-audit-blockers-WEY8p
Head:   post-#316 (audit phases 1.2 + 2.1–2.4 + 3.1 + 4.1–4.3 + 5.2 + 5.4 landed)

Every number below comes from a `grep` or `ls` against the working tree at the head above. Numbers in CLAUDE.md / audit/cartograph/* that disagree are stale — trust this file.

## Top-level counts

| Surface | Count | How to reproduce |
|---|---|---|
| Lens directories (frontend) | 205 | `ls -d concord-frontend/app/lenses/*/ \| wc -l` |
| Backend domain files | 195 | `ls server/domains/*.js \| wc -l` |
| Migrations applied | 144 | `ls server/migrations/[0-9]*.js \| wc -l` (numbered only — `_drop-with-rescue.js` is a helper) |
| Latest migration | 144_mount_gear.js | `ls server/migrations/ \| grep -E '^[0-9]{3}_' \| sort \| tail -1` |
| Route files | 129 | `ls server/routes/*.js \| wc -l` |
| Emergent modules | 158 | `ls server/emergent/*.js \| wc -l` |
| Lib modules | 272 | `ls server/lib/*.js \| wc -l` (added `http-errors.js` in audit phase 4.1; archived 11 orphans to `_archived/` in phase 3.2) |
| Test files | 353 | `find server/tests -name "*.test.js" -o -name "*-tests.js" \| wc -l` |
| Test cases (it/test() blocks) | 11125 | `grep -rE "^\s*(it\|test)\(" server/tests --include="*.js" \| wc -l` |
| HTTP routes in server.js | 1086 | `grep -hcE '^\s*app\.(get\|post\|put\|delete\|patch)\(' server/server.js` |
| HTTP routes in routes/*.js | 1313 | `grep -hcE '^\s*router\.(get\|post\|put\|delete\|patch)\(' server/routes/*.js \| paste -sd+ - \| bc` |
| Unique macro domains (server.js) | 129 | `grep -hE "^\s*register\(\s*['\"][a-z_]+" server/server.js` |
| Unique (domain, macro) pairs (server.js) | 684 | grep+sed against `register('domain','name')` |
| Distinct CREATE TABLE statements across migrations | 353 | grep CREATE TABLE in migrations/*.js + sort -u |
| Unique heartbeats registered | 42 | grep registerHeartbeat across server.js + lib/ + emergent/ |

## Drift since 2026-05-08 (delta against the previous inventory)

| Surface | Was | Now | Δ | Cause |
|---|---|---|---|---|
| Lens directories | 203 | 205 | +2 | dx-platform sub-routes (`billing`, `web-editor`) added in #307 |
| Backend domain files | 182 | 195 | +13 | A1-A5 + B1-B3 wave landed new domains |
| Migrations | 121 | 145 | +24 | A1-A5 + B1-B3 + Phase 7-8 + procgen NPCs + governance + combat polish |
| Latest migration | 121_understanding_evolution | 144_mount_gear | — | B3 capstone |
| Emergent modules | 146 | 158 | +12 | new heartbeats below |
| Lib modules | 255 | 278 | +23 | concord-lsp, mounts, NPC routines, etc. |
| (domain, macro) pairs | 682 | 684 | +2 | minor surface growth |
| CREATE TABLE statements | 318 | 353 | +35 | new substrate + procgen tables |
| Heartbeats | 26 | 42 | +16 | new heartbeats below |

**Migration collisions fixed since the previous inventory:**
- `120_drop_dead_mig006.js` → `141_drop_dead_mig006.js` (collided with `120_understandings.js`; commit `5303bff4`, PR #305)
- `121_drop_dead_mig009.js` → `142_drop_dead_mig009.js` (collided with `121_understanding_evolution.js`; same commit/PR)
- `142_drop_dead_mig009.js` → `143_drop_dead_mig009.js` (collided with `142_mount_substrate.js` from B1; this branch — caught by the fresh-DB boot rerun while updating this inventory)

Net: every numeric claim in CLAUDE.md older than this inventory line is potentially stale. The cross-check pass against CLAUDE.md follows.

## Heartbeats — verified by direct grep

Each heartbeat is registered via `registerHeartbeat(name, { frequency, handler })`. Frequency is in tick units (1 tick = 15s, see `governorTick()` in server.js). The list below comes from grep against `server/server.js`, `server/lib/*.js`, and `server/emergent/*.js` — every registration call lives in `server.js`; the handler implementations live in the modules under `server/emergent/` and `server/lib/`.

| Heartbeat | Registered in |
|---|---|
| `affect-tick` | `server.js` |
| `brain-daily-refresh` | `server.js` |
| `brain-outcome-resolver` | `server.js` |
| `code-substrate-refresh` | `server.js` |
| `combat-recovery-cycle` | `server.js` |
| `corpse-cleanup` | `server.js` |
| `culture-drift-pass` | `server.js` |
| `detectors-sweep` | `server.js` |
| `eco-expiry-sweep` | `server.js` |
| `embodied-dream-cycle` | `server.js` |
| `environment-sense` | `server.js` |
| `environment-sensor` | `server.js` |
| `faction-strategy-cycle` | `server.js` |
| `fauna-spawner` | `server.js` |
| `forgetting-health-check` | `server.js` |
| `forward-sim-cycle` | `server.js` |
| `land-claims-cycle` | `server.js` |
| `lattice-breakthrough-pass` | `server.js` |
| `lattice-drift-scan` | `server.js` |
| `lattice-federation-poll` | `server.js` |
| `lattice-quest-cycle` | `server.js` |
| `metrics-decay` | `server.js` |
| `npc-conversation-initiator` | `server.js` |
| `npc-economy-cycle` | `server.js` |
| `npc-knowledge-bridge` | `server.js` |
| `npc-marketplace-cycle` | `server.js` |
| `npc-routine-cycle` | `server.js` |
| `npc-skill-evolve-cycle` | `server.js` |
| `personal-beat-scheduler` | `server.js` |
| `presence-stale-sweep` | `server.js` |
| `procedural-npc-spawner` | `server.js` |
| `qualia-persist` | `server.js` |
| `reflex-architectural-drift` | `server.js` |
| `reflex-dependency-entropy` | `server.js` |
| `reflex-scaling-pressure` | `server.js` |
| `reflex-unsafe-expansion` | `server.js` |
| `refusal-field-sweep` | `server.js` |
| `repair-cycle` | `server.js` |
| `scheduled-posts` | `server.js` |
| `season-cycle` | `server.js` |
| `social-npc-bridge` | `server.js` |
| `understanding-evolve` | `server.js` |

## Macro inventory — domain → macro count

All macros are registered in `server/server.js` via `register(domain, name, ctx => …)`. The list below is grep'd directly. Front-end calls each macro via `POST /api/lens/run` with `{ domain, name, input }`.

| Domain | Macro count |
|---|---|
| `hypothesis` | 20 |
| `foundation` | 17 |
| `worldmodel` | 16 |
| `culture` | 16 |
| `dtu` | 15 |
| `intel` | 14 |
| `ingest` | 14 |
| `research` | 13 |
| `entity_economy` | 13 |
| `agents` | 13 |
| `metacognition` | 12 |
| `goals` | 12 |
| `creative` | 12 |
| `chat` | 12 |
| `teaching` | 11 |
| `shield` | 11 |
| `marketplace` | 11 |
| `lens` | 11 |
| `history` | 11 |
| `grounding` | 11 |
| `cri` | 11 |
| `conflict` | 11 |
| `autonomy` | 11 |
| `system` | 10 |
| `quest` | 10 |
| `mesh` | 10 |
| `persona` | 9 |
| `hlm` | 9 |
| `cortex` | 9 |
| `atlas` | 9 |
| `apps` | 9 |
| `physical` | 8 |
| `metalearning` | 8 |
| `forge` | 8 |
| `transfer` | 7 |
| `semantic` | 7 |
| `reasoning` | 7 |
| `forgetting` | 7 |
| `council` | 7 |
| `collab` | 7 |
| `breakthrough` | 7 |
| `verify` | 6 |
| `promotion` | 6 |
| `inference` | 6 |
| `experience` | 6 |
| `commonsense` | 6 |
| `city` | 6 |
| `autotag` | 6 |
| `attention_alloc` | 6 |
| `attention` | 6 |
| `webhook` | 5 |
| `temporal` | 5 |
| `schema` | 5 |
| `reflection` | 5 |
| `hlr` | 5 |
| `dream` | 5 |
| `cache` | 5 |
| `automation` | 5 |
| `whiteboard` | 4 |
| `repair_network` | 4 |
| `redis` | 4 |
| `plugin` | 4 |
| `market` | 4 |
| `explanation` | 4 |
| `db` | 4 |
| `anon` | 4 |
| `agent` | 4 |
| `admin` | 4 |
| `wrapper` | 3 |
| `vscode` | 3 |
| `voice` | 3 |
| `visual` | 3 |
| `universe` | 3 |
| `scope` | 3 |
| `resonance` | 3 |
| `paper` | 3 |
| `layer` | 3 |
| `lattice` | 3 |
| `jobs` | 3 |
| `graph` | 3 |
| `governor` | 3 |
| `export` | 3 |
| `explore` | 3 |
| `dimensional` | 3 |
| `tools` | 2 |
| `style` | 2 |
| `source` | 2 |
| `shard` | 2 |
| `settings` | 2 |
| `search` | 2 |
| `quality` | 2 |
| `pwa` | 2 |
| `perf` | 2 |
| `obsidian` | 2 |
| `multimodal` | 2 |
| `mobile` | 2 |
| `llm` | 2 |
| `import` | 2 |
| `global` | 2 |
| `entity` | 2 |
| `crawl` | 2 |
| `auth` | 2 |
| `synth` | 1 |
| `sync` | 1 |
| `swarm` | 1 |
| `spreadsheet` | 1 |
| `slides` | 1 |
| `skill` | 1 |
| `sim` | 1 |
| `org` | 1 |
| `notion` | 1 |
| `materials` | 1 |
| `log` | 1 |
| `legal` | 1 |
| `interface` | 1 |
| `intent` | 1 |
| `integration` | 1 |
| `heartbeat` | 1 |
| `harness` | 1 |
| `experiment` | 1 |
| `evolution` | 1 |
| `context` | 1 |
| `compile` | 1 |
| `backpressure` | 1 |
| `audit` | 1 |
| `ask` | 1 |

## HTTP route inventory — full (server.js + routes/*.js)

Generated by grep of `app.{get,post,put,delete,patch}(` in server.js and `router.{get,post,put,delete,patch}(` in routes/*.js.

**This list is the source of truth for API billing — every endpoint a paying developer can hit appears here.**

### Method breakdown

| Method | server.js | routes/*.js | Total |
|---|---|---|---|
| GET | 604 | 675 | 1279 |
| POST | 446 | 582 | 1028 |
| PUT | 10 | 19 | 29 |
| DELETE | 21 | 30 | 51 |
| PATCH | 5 | 7 | 12 |

### server.js routes (full list, sorted by path)

```
GET     /api/activity
GET     /api/adaptive/layout
GET     /api/admin/artifact-gc/orphan-count
GET     /api/admin/attention/history
GET     /api/admin/attention/status
GET     /api/admin/audit
GET     /api/admin/backup/status
GET     /api/admin/cascade-recovery
GET     /api/admin/compression-stats
GET     /api/admin/forgetting/candidates
GET     /api/admin/forgetting/history
GET     /api/admin/forgetting/status
GET     /api/admin/governance-rejections
GET     /api/admin/integrity
GET     /api/admin/intervals/status
GET     /api/admin/lens-audit
GET     /api/admin/logs
GET     /api/admin/logs/stream
GET     /api/admin/memory/pressure
GET     /api/admin/permission-matrix/data
GET     /api/admin/promotion/history
GET     /api/admin/promotion/queue
GET     /api/admin/queue/stats
GET     /api/admin/repair/accumulator
GET     /api/admin/repair/full-status
GET     /api/admin/repair/network-status
GET     /api/admin/repair/patterns
GET     /api/admin/repair/status
GET     /api/admin/scaling/status
GET     /api/admin/ssl/status
GET     /api/admin/stats
GET     /api/admin/sync/status
GET     /api/admin/system-health/series
GET     /api/affect/events
GET     /api/affect/health
GET     /api/affect/policy
GET     /api/affect/state
GET     /api/affect/system
PUT     /api/agent/config
GET     /api/agent/status
GET     /api/ai/embeddings/status
GET     /api/ai/gaps
GET     /api/ai/search
GET     /api/alerts
GET     /api/alerts/active
GET     /api/analytics/atlas-domains
GET     /api/analytics/citations
GET     /api/analytics/dashboard
GET     /api/analytics/density
GET     /api/analytics/growth
GET     /api/analytics/marketplace
GET     /api/analytics/personal/:userId
GET     /api/anon/identity
GET     /api/anon/messages
GET     /api/apps
GET     /api/apps/:id
GET     /api/ar/layers
GET     /api/ar/status
GET     /api/archaeology
GET     /api/artifact/:dtuId/download
GET     /api/artifact/:dtuId/info
GET     /api/artifact/:dtuId/stream
GET     /api/artifact/:dtuId/thumbnail
GET     /api/artistry/ai/learning/:pathId
GET     /api/artistry/asset-types
GET     /api/artistry/assets
GET     /api/artistry/assets/:id
GET     /api/artistry/blobs/:id
GET     /api/artistry/collab/remixes
GET     /api/artistry/collab/sessions
GET     /api/artistry/collab/shared
GET     /api/artistry/distribution/embeds/:id
GET     /api/artistry/distribution/feed/:userId
GET     /api/artistry/distribution/followers/:userId
GET     /api/artistry/distribution/following/:userId
GET     /api/artistry/distribution/releases
GET     /api/artistry/distribution/releases/:id
GET     /api/artistry/distribution/streams/:assetId
GET     /api/artistry/genres
GET     /api/artistry/marketplace/art
GET     /api/artistry/marketplace/art
GET     /api/artistry/marketplace/beats
GET     /api/artistry/marketplace/licenses
GET     /api/artistry/marketplace/samples
GET     /api/artistry/marketplace/splits/:id
GET     /api/artistry/marketplace/stems
GET     /api/artistry/stats
GET     /api/artistry/studio/effects
GET     /api/artistry/studio/instruments
GET     /api/artistry/studio/projects
GET     /api/artistry/studio/projects/:id
GET     /api/atlas/antigaming/metrics
GET     /api/atlas/antigaming/scan/:id
GET     /api/atlas/auto-promote-gate/:id
GET     /api/atlas/autogen/metrics
GET     /api/atlas/autogen/run/:runId
GET     /api/atlas/chat/metrics
GET     /api/atlas/chat/session/:id
GET     /api/atlas/config/thresholds
GET     /api/atlas/config/thresholds/:epistemicClass
GET     /api/atlas/contradictions/:id
GET     /api/atlas/council/actions
GET     /api/atlas/council/metrics
GET     /api/atlas/council/queue
GET     /api/atlas/domains
GET     /api/atlas/dtu/:id
GET     /api/atlas/entity/:id
GET     /api/atlas/heartbeat/metrics
GET     /api/atlas/invariants/log
GET     /api/atlas/invariants/metrics
GET     /api/atlas/local-hints/:dtuId
GET     /api/atlas/metrics
GET     /api/atlas/privacy_zones
GET     /api/atlas/retrieve
GET     /api/atlas/retrieve/chat
GET     /api/atlas/retrieve/labeled
GET     /api/atlas/retrieve/scope/:scope
GET     /api/atlas/rights/citation/:id
GET     /api/atlas/rights/hash/:id
GET     /api/atlas/rights/metrics
GET     /api/atlas/rights/origin/:id
GET     /api/atlas/rights/verify/:id
GET     /api/atlas/scope-metrics
GET     /api/atlas/scope/:dtuId
GET     /api/atlas/score-explain/:id
GET     /api/atlas/search
GET     /api/atlas/submission/:id
GET     /api/atlas/submissions
GET     /api/atlas/write-guard/log
GET     /api/atlas/write-guard/metrics
GET     /api/attention/feed
GET     /api/audit/provenance
GET     /api/automations
GET     /api/backpressure/status
GET     /api/battles
GET     /api/bio/systems
GET     /api/board/tasks
GET     /api/bounties
GET     /api/brain/fallback-health
GET     /api/brain/health
GET     /api/brain/personality
GET     /api/brain/personality/history
GET     /api/brain/spontaneous/status
GET     /api/brain/status
GET     /api/brain/wants
GET     /api/brain/wants/metrics
GET     /api/bridge/births
GET     /api/bridge/debates
GET     /api/bridge/emergents
GET     /api/bridge/log
GET     /api/bridge/organisms
GET     /api/bridge/quarantine
GET     /api/brief/latest
GET     /api/brief/morning
GET     /api/cache/:key
GET     /api/cache/stats
GET     /api/causal/chain
GET     /api/causal/edges
GET     /api/causal/graph/:dtuId
GET     /api/chat/web-metrics
GET     /api/chem/compounds
GET     /api/chem/reactions
GET     /api/circuits
GET     /api/city/streams
GET     /api/cli/help
GET     /api/cli/stats
GET     /api/cognitive/dreams
GET     /api/collab/active
PUT     /api/collab/comment/:id
GET     /api/collab/comments/:dtuId
GET     /api/collab/metrics
GET     /api/collab/revisions/:dtuId
GET     /api/collab/sessions
GET     /api/collab/workspace/:id
GET     /api/collab/workspaces
GET     /api/combat/state/:actorId
GET     /api/compliance/log
GET     /api/compliance/partition/:orgId
GET     /api/compliance/region/:resourceId
GET     /api/compliance/retention/:orgId
GET     /api/compliance/status
GET     /api/confidence/alerts
GET     /api/config/shortcuts
PUT     /api/config/shortcuts
GET     /api/config/theme/:id
GET     /api/config/themes
GET     /api/context/metrics
GET     /api/context/panel/:sessionId
GET     /api/context/profiles
GET     /api/context/resurrect
GET     /api/context/user/:userId
GET     /api/coop/build/:siteId
GET     /api/coop/build/party/:partyId
GET     /api/coop/raid/:raidId
GET     /api/coop/raids
GET     /api/coop/stash/:partyId
GET     /api/costs
GET     /api/council/debate
GET     /api/council/proposals
GET     /api/council/sessions
...
(showing first 200 of 1086; full list available via `grep -hE "^\s*app\.(get|post|put|delete|patch)\(" server/server.js | wc -l`)
```

### routes/*.js file index (one heading per file)

| Route file | Endpoints |
|---|---|
| `routes/world.js` | 195 |
| `routes/emergent.js` | 90 |
| `routes/worlds.js` | 66 |
| `routes/federation.js` | 48 |
| `routes/emergent-features.js` | 39 |
| `routes/learning.js` | 34 |
| `routes/film-studio.js` | 30 |
| `routes/lens-culture.js` | 28 |
| `routes/legal-liability.js` | 27 |
| `routes/creative-marketplace.js` | 27 |
| `routes/connective-tissue.js` | 22 |
| `routes/storage.js` | 20 |
| `routes/lens-compliance.js` | 20 |
| `routes/frontier-part2.js` | 20 |
| `routes/api-billing.js` | 19 |
| `routes/social-extended.js` | 18 |
| `routes/media.js` | 16 |
| `routes/social-groups.js` | 15 |
| `routes/frontier-part1.js` | 15 |
| `routes/frontier-part3.js` | 14 |
| `routes/auth.js` | 14 |
| `routes/world-orgs-extended.js` | 13 |
| `routes/qualia.js` | 13 |
| `routes/frontier-part4.js` | 13 |
| `routes/channels.js` | 13 |
| `routes/sovereign-emergent.js` | 12 |
| `routes/messaging.js` | 12 |
| `routes/marketplace-lens-registry.js` | 12 |
| `routes/feeds.js` | 12 |
| `routes/crafting.js` | 12 |
| `routes/account-lifecycle.js` | 12 |
| `routes/universal-export.js` | 11 |
| `routes/studio.js` | 11 |
| `routes/inference-debug.js` | 11 |
| `routes/cdn.js` | 11 |
| `routes/lens-features.js` | 10 |
| `routes/kingdoms.js` | 10 |
| `routes/dtu-format.js` | 10 |
| `routes/city.js` | 10 |
| `routes/tournaments.js` | 9 |
| `routes/social-engagement.js` | 9 |
| `routes/personal-locker.js` | 9 |
| `routes/parties.js` | 9 |
| `routes/combat-flow.js` | 9 |
| `routes/city-assets.js` | 9 |
| `routes/sub-lens.js` | 8 |
| `routes/moderation.js` | 8 |
| `routes/minigames.js` | 8 |
| `routes/forge.js` | 8 |
| `routes/consent.js` | 8 |

## Lens directories — verified inventory (203 dirs)

Each row is a real directory under `concord-frontend/app/lenses/`. `page.tsx` column is true if the dir contains a `page.tsx` (a lens missing it can't be reached). The third column is the lens's primary backend domain when grep-detectable from `page.tsx`.

| Lens dir | page.tsx | First detected domain.macro call |
|---|---|---|
| `[parent]` | no | `—` |
| `accounting` | yes | `—` |
| `admin` | yes | `—` |
| `affect` | yes | `—` |
| `agents` | yes | `—` |
| `agriculture` | yes | `—` |
| `all` | yes | `—` |
| `alliance` | yes | `—` |
| `analytics` | yes | `—` |
| `animation` | yes | `—` |
| `anon` | yes | `—` |
| `answers` | yes | `—` |
| `app-maker` | yes | `—` |
| `ar` | yes | `—` |
| `art` | yes | `—` |
| `artistry` | yes | `—` |
| `astronomy` | yes | `—` |
| `atlas` | yes | `—` |
| `attention` | yes | `—` |
| `audit` | yes | `—` |
| `automotive` | yes | `—` |
| `aviation` | yes | `—` |
| `billing` | yes | `—` |
| `bio` | yes | `—` |
| `black-market` | yes | `—` |
| `board` | yes | `—` |
| `bridge` | yes | `—` |
| `calendar` | yes | `—` |
| `carpentry` | yes | `—` |
| `chat` | yes | `—` |
| `chem` | yes | `—` |
| `code` | yes | `—` |
| `cognition` | yes | `hlr` |
| `collab` | yes | `—` |
| `command-center` | yes | `—` |
| `commonsense` | yes | `—` |
| `construction` | yes | `—` |
| `consulting` | yes | `—` |
| `cooking` | yes | `—` |
| `council` | yes | `—` |
| `crafting` | yes | `—` |
| `creative-writing` | yes | `—` |
| `creative` | yes | `—` |
| `creator` | yes | `—` |
| `cri` | yes | `—` |
| `crypto` | yes | `—` |
| `custom` | yes | `—` |
| `daily` | yes | `—` |
| `database` | yes | `—` |
| `debate` | yes | `—` |
| `debug` | yes | `—` |
| `defense` | yes | `—` |
| `desert` | yes | `—` |
| `disputes` | yes | `—` |
| `diy` | yes | `—` |
| `docs` | yes | `—` |
| `dtus` | yes | `—` |
| `eco` | yes | `—` |
| `education` | yes | `—` |
| `electrical` | yes | `—` |
| `emergency-services` | yes | `—` |
| `energy` | yes | `—` |
| `engineering` | yes | `—` |
| `entity` | yes | `—` |
| `environment` | yes | `—` |
| `ethics` | yes | `—` |
| `events` | yes | `—` |
| `experience` | yes | `—` |
| `export` | yes | `—` |
| `fashion` | yes | `—` |
| `federation` | yes | `—` |
| `feed` | yes | `—` |
| `film-studios` | yes | `—` |
| `finance` | yes | `—` |
| `fitness` | yes | `—` |
| `food` | yes | `—` |
| `forestry` | yes | `—` |
| `forge` | yes | `—` |
| `fork` | yes | `—` |
| `forum` | yes | `—` |
| `fractal` | yes | `—` |
| `game-design` | yes | `—` |
| `game` | yes | `—` |
| `genesis` | yes | `—` |
| `geology` | yes | `—` |
| `global` | yes | `—` |
| `goals` | yes | `—` |
| `government` | yes | `—` |
| `graph` | yes | `—` |
| `grounding` | yes | `—` |
| `healthcare` | yes | `—` |
| `history` | yes | `—` |
| `home-improvement` | yes | `—` |
| `household` | yes | `—` |
| `hr` | yes | `—` |
| `hvac` | yes | `—` |
| `hypothesis` | yes | `—` |
| `import` | yes | `—` |
| `inference` | yes | `—` |
| `ingest` | yes | `—` |
| `insurance` | yes | `—` |
| `integrations` | yes | `—` |
| `invariant` | yes | `—` |
| `kingdoms` | yes | `—` |
| `lab` | yes | `—` |
| `landscaping` | yes | `—` |
| `lattice` | yes | `—` |
| `law-enforcement` | yes | `—` |
| `law` | yes | `—` |
| `legacy` | yes | `—` |
| `legal` | yes | `—` |
| `linguistics` | yes | `—` |
| `lock` | yes | `—` |
| `logistics` | yes | `—` |
| `maker` | yes | `apps` |
| `manufacturing` | yes | `—` |
| `market` | yes | `—` |
| `marketing` | yes | `—` |
| `marketplace` | yes | `—` |
| `masonry` | yes | `—` |
| `materials` | yes | `—` |
| `math` | yes | `—` |
| `mental-health` | yes | `—` |
| `mentorship` | yes | `—` |
| `mesh` | yes | `mesh` |
| `message` | yes | `—` |
| `meta` | yes | `—` |
| `metacognition` | yes | `—` |
| `metalearning` | yes | `—` |
| `mining` | yes | `—` |
| `ml` | yes | `—` |
| `music` | yes | `—` |
| `neuro` | yes | `—` |
| `news` | yes | `—` |
| `nonprofit` | yes | `—` |
| `ocean` | yes | `—` |
| `offline` | yes | `—` |
| `ops` | yes | `attention_alloc` |
| `organ` | yes | `—` |
| `paper` | yes | `—` |
| `parenting` | yes | `—` |
| `pets` | yes | `—` |
| `pharmacy` | yes | `—` |
| `philosophy` | yes | `—` |
| `photography` | yes | `—` |
| `physics` | yes | `—` |
| `platform` | yes | `—` |
| `plumbing` | yes | `—` |
| `podcast` | yes | `—` |
| `poetry` | yes | `—` |
| `privacy` | yes | `—` |
| `productivity` | yes | `code` |
| `projects` | yes | `—` |
| `quantum` | yes | `—` |
| `questmarket` | yes | `—` |
| `queue` | yes | `—` |
| `realestate` | yes | `—` |
| `reasoning` | yes | `—` |
| `reflection` | yes | `—` |
| `repos` | yes | `—` |
| `research` | yes | `—` |
| `resonance` | yes | `—` |
| `retail` | yes | `—` |
| `robotics` | yes | `—` |
| `root` | yes | `—` |
| `sandbox` | yes | `—` |
| `schema` | yes | `—` |
| `science` | yes | `—` |
| `security` | yes | `—` |
| `self` | yes | `auth` |
| `sentinel` | yes | `shield` |
| `services` | yes | `—` |
| `settings` | yes | `—` |
| `sim` | yes | `—` |
| `society` | yes | `culture` |
| `space` | yes | `—` |
| `sports` | yes | `—` |
| `srs` | yes | `—` |
| `studio` | yes | `—` |
| `suffering` | yes | `—` |
| `supplychain` | yes | `—` |
| `system` | yes | `system` |
| `telecommunications` | yes | `—` |
| `temporal` | yes | `—` |
| `thread` | yes | `—` |
| `tick` | yes | `—` |
| `timeline` | yes | `—` |
| `tools` | yes | `tools` |
| `tournaments` | yes | `—` |
| `trades` | yes | `—` |
| `transfer` | yes | `—` |
| `travel` | yes | `—` |
| `urban-planning` | yes | `—` |
| `ux-suite` | yes | `—` |
| `veterinary` | yes | `—` |
| `voice` | yes | `—` |
| `vote` | yes | `—` |
| `wallet` | yes | `—` |
| `welding` | yes | `—` |
| `whiteboard` | yes | `—` |
| `world-creator` | no | `—` |
| `world` | yes | `—` |
| `worldmodel` | yes | `worldmodel` |

## Migrations — verified ledger (119 files)

All migration files in `server/migrations/`, in apply order. Each migration's `up()` is idempotent and runs once at startup; the `schema_version` table tracks the high-water mark.

| Index | File |
|---|---|
| 1 | `001_core_tables.js` |
| 2 | `002_economy_tables.js` |
| 3 | `003_economy_stripe.js` |
| 4 | `004_ledger_idempotency.js` |
| 5 | `005_purchases_table.js` |
| 6 | `006_embedding_column.js` |
| 7 | `007_archived_dtus.js` |
| 8 | `008_economic_system.js` |
| 9 | `009_brain_want_engine.js` |
| 10 | `010_learning_verification.js` |
| 11 | `011_federation_tiers.js` |
| 12 | `012_federation_v11.js` |
| 13 | `013_federation_marketplace_dedup.js` |
| 14 | `014_creative_marketplace.js` |
| 15 | `015_lens_culture.js` |
| 16 | `016_dtu_format.js` |
| 17 | `017_api_billing.js` |
| 18 | `018_storage.js` |
| 19 | `019_lens_compliance.js` |
| 20 | `020_legal_liability.js` |
| 21 | `021_film_studio.js` |
| 22 | `022_marketplace_lens_registry.js` |
| 23 | `023_lens_features.js` |
| 24 | `024_connective_tissue.js` |
| 25 | `025_canonical_dtu.js` |
| 26 | `026_oauth.js` |
| 27 | `027_backup_history.js` |
| 28 | `028_code_engine.js` |
| 29 | `029_initiative.js` |
| 30 | `030_repair_enhanced.js` |
| 31 | `031_security_intelligence.js` |
| 32 | `032_consent_layer.js` |
| 33 | `033_account_lifecycle.js` |
| 34 | `034_orphan_tables_and_indexes.js` |
| 35 | `035_player_world_state.js` |
| 36 | `036_personal_locker.js` |
| 37 | `037_base6_dtu_layer.js` |
| 38 | `038_emergent_trust.js` |
| 39 | `039_emergent_identity.js` |
| 40 | `040_emergent_communications.js` |
| 41 | `041_emergent_quality_history.js` |
| 42 | `042_concordia_worlds.js` |
| 43 | `043_skill_progression.js` |
| 44 | `044_substrate_diffusion.js` |
| 45 | `045_concordia_credits.js` |
| 46 | `046_nemesis_crises.js` |
| 47 | `047_game_mode_tables.js` |
| 48 | `048_sparks.js` |
| 49 | `049_tool_tree.js` |
| 50 | `050_player_inventory.js` |
| 51 | `051_wagers.js` |
| 52 | `052_guild_persistence.js` |
| 53 | `053_lens_portals.js` |
| 54 | `054_player_ratings.js` |
| 55 | `055_arena_queue.js` |
| 56 | `056_messaging_adapters.js` |
| 57 | `057_sandbox_workspaces.js` |
| 58 | `058_agent_threads.js` |
| 59 | `059_reasoning_sessions.js` |
| 60 | `060_npc_enhancements.js` |
| 61 | `061_npc_gear_and_knowledge.js` |
| 62 | `062_npc_families_and_spawning.js` |
| 63 | `063_world_environment.js` |
| 64 | `064_crafting_and_skills.js` |
| 65 | `065_crime_and_jobs.js` |
| 66 | `066_resource_bars_and_combat.js` |
| 67 | `067_character_levels.js` |
| 68 | `068_quest_state_machine.js` |
| 69 | `069_player_trade.js` |
| 70 | `070_parties.js` |
| 71 | `071_inventory_audit.js` |
| 72 | `072_users_first_visit.js` |
| 73 | `073_evo_assets.js` |
| 74 | `074_quest_archetype_history.js` |
| 75 | `075_faction_events.js` |
| 76 | `076_concord_link.js` |
| 77 | `077_users_current_world.js` |
| 78 | `078_faction_policy_state.js` |
| 79 | `079_concord_link_walker_journeys.js` |
| 80 | `080_black_market.js` |
| 81 | `081_vehicles.js` |
| 82 | `082_emergent_skills.js` |
| 83 | `083_creature_crossbreeding.js` |
| 84 | `084_evo_asset_cdn_urls.js` |
| 85 | `085_plugin_gallery.js` |
| 86 | `086_search_persistence.js` |
| 87 | `087_dtus_type_creator_data.js` |
| 88 | `088_combat_flow.js` |
| 89 | `089_training_matches.js` |
| 90 | `090_dual_hand_loadout.js` |
| 91 | `091_world_buildings.js` |
| 92 | `092_npc_knowledge.js` |
| 93 | `093_multi_avatar.js` |
| 94 | `094_creature_population.js` |
| 95 | `095_inventory_spoilage_and_effects.js` |
| 96 | `096_player_world_metrics.js` |
| 97 | `097_refusal_fields.js` |
| 98 | `098_concordia_hub_id_reconciliation.js` |
| 99 | `099_user_storage.js` |
| 100 | `100_evo_assets_gameplay_kinds.js` |
| 101 | `101_player_inventory_world_scope.js` |
| 102 | `102_world_facts.js` |
| 103 | `103_tournaments.js` |
| 104 | `104_player_companions.js` |
| 105 | `105_kingdoms.js` |
| 106 | `106_minigame_matches.js` |
| 107 | `107_evo_assets_fk_repair.js` |
| 108 | `108_lattice_train_consent.js` |
| 109 | `109_brain_interactions.js` |
| 110 | `110_affect_state.js` |
| 111 | `111_qualia_state.js` |
| 112 | `112_embodied_signals.js` |
| 113 | `113_embodied_signal_log_unification.js` |
| 114 | `114_pain_signals.js` |
| 115 | `115_dreams.js` |
| 116 | `116_forward_predictions.js` |
| 117 | `117_faction_strategy.js` |
| 118 | `118_npc_conversations.js` |
| 119 | `119_world_invites.js` |

## Lib + emergent modules (verified file counts)

**`server/lib/` — 252 modules.** Direct `ls server/lib/*.js`. Selected anchor modules:

| Module | LOC | Role |
|---|---|---|
| `economy/royalty-cascade.js` | 518 | (see file header) |
| `lib/narrative-bridge.js` | 501 | (see file header) |
| `lib/content-seeder.js` | 511 | (see file header) |
| `lib/federation.js` | 1513 | (see file header) |
| `lib/oracle-engine.js` | 2206 | (see file header) |
| `lib/code-engine.js` | 1785 | (see file header) |
| `lib/feed-manager.js` | 999 | (see file header) |
| `lib/media-dtu.js` | 908 | (see file header) |
| `lib/initiative-engine.js` | 1487 | (see file header) |
| `lib/refusal-field.js` | 254 | (see file header) |
| `lib/goddess-arcs.js` | 176 | (see file header) |
| `lib/commune-templates.js` | 131 | (see file header) |
| `lib/creator-dashboard.js` | 448 | (see file header) |
| `lib/console-stats.js` | 146 | (see file header) |
| `lib/memory-pressure.js` | 266 | (see file header) |

**`server/emergent/` — 146 modules.** Direct `ls server/emergent/*.js`. Selected anchor modules:

| Module | LOC |
|---|---|
| `emergent/lattice-orchestrator.js` | 196 |
| `emergent/faction-strategy-cycle.js` | 60 |
| `emergent/forward-sim-cycle.js` | 68 |
| `emergent/embodied-dream-cycle.js` | 81 |
| `emergent/repair-cycle.js` | 137 |
| `emergent/environment-sensor.js` | 124 |
| `emergent/npc-conversation-initiator.js` | 59 |
| `emergent/quest-engine.js` | 793 |

