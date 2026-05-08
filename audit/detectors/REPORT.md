# Detector report

Generated: `2026-05-08T21:58:48.707Z`  Consumer: `all`  Total findings: **1296**

| severity | count |
|---|---|
| critical | 0 |
| high | 19 |
| medium | 559 |
| low | 256 |
| info | 462 |

## Detectors

| id | ok | total | critical | high | medium | low | duration |
|---|---|---|---|---|---|---|---|
| stale-code | yes | 231 | 0 | 0 | 20 | 11 | 21761ms |
| invariant-guardian | yes | 0 | 0 | 0 | 0 | 0 | 3187ms |
| macro-usage | yes | 255 | 0 | 0 | 0 | 0 | 10529ms |
| lens-health | yes | 1 | 0 | 0 | 0 | 0 | 807ms |
| dtu-lineage | no (no_db) | 0 | 0 | 0 | 0 | 0 | 0ms |
| heartbeat-monitor | yes | 1 | 0 | 0 | 0 | 0 | 340ms |
| secret-leak | yes | 1 | 0 | 0 | 0 | 0 | 3097ms |
| performance-hotspot | yes | 802 | 0 | 17 | 539 | 245 | 1030ms |
| historical-trend | yes | 1 | 0 | 0 | 0 | 0 | 9ms |
| predictive-growth | yes | 1 | 0 | 0 | 0 | 0 | 25ms |
| architectural-hub | yes | 3 | 0 | 2 | 0 | 0 | 1822ms |

### stale-code

- • **medium** `table_orphan` — Table dtu_embeddings is created but never read or written outside migrations `server/migrations/006_embedding_column.js:24`
- • **medium** `table_orphan` — Table preserved is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:11`
- • **medium** `table_orphan` — Table personality_state is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:20`
- • **medium** `table_orphan` — Table personality_evolution_log is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:34`
- • **medium** `table_orphan` — Table want_suppressions is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:81`
- • **medium** `table_orphan` — Table spontaneous_queue is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:88`
- • **medium** `table_orphan` — Table spontaneous_user_prefs is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:107`
- • **medium** `table_orphan` — Table want_actions is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:117`
- • **medium** `table_orphan` — Table dtu_helpfulness is created but never read or written outside migrations `server/migrations/010_learning_verification.js:31`
- • **medium** `table_orphan` — Table retrieval_metrics is created but never read or written outside migrations `server/migrations/010_learning_verification.js:40`
- • **medium** `table_orphan` — Table novelty_daily is created but never read or written outside migrations `server/migrations/010_learning_verification.js:52`
- • **medium** `table_orphan` — Table dedup_audits is created but never read or written outside migrations `server/migrations/010_learning_verification.js:62`
- • **medium** `table_orphan` — Table pruning_history is created but never read or written outside migrations `server/migrations/010_learning_verification.js:74`
- • **medium** `table_orphan` — Table generation_quotas is created but never read or written outside migrations `server/migrations/010_learning_verification.js:85`
- • **medium** `table_orphan` — Table creation_diffusion is created but never read or written outside migrations `server/migrations/044_substrate_diffusion.js:19`
- • **medium** `table_orphan` — Table guilds is created but never read or written outside migrations `server/migrations/052_guild_persistence.js:12`
- • **medium** `table_orphan` — Table guild_members is created but never read or written outside migrations `server/migrations/052_guild_persistence.js:25`
- • **medium** `table_orphan` — Table messaging_verification_codes is created but never read or written outside migrations `server/migrations/056_messaging_adapters.js:52`
- • **medium** `table_orphan` — Table reasoning_sessions is created but never read or written outside migrations `server/migrations/059_reasoning_sessions.js:29`
- • **medium** `table_orphan` — Table plugin_installs is created but never read or written outside migrations `server/migrations/085_plugin_gallery.js:46`
- · **low** `module_orphan` — Module is never imported `server/lib/agentic/learnings-curation.js`
- · **low** `module_orphan` — Module is never imported `server/lib/analogy-engine.js`
- · **low** `module_orphan` — Module is never imported `server/lib/concord-moderate.js`
- · **low** `module_orphan` — Module is never imported `server/lib/concord-test.js`
- · **low** `module_orphan` — Module is never imported `server/lib/evo-asset/npc-shadow-bridge.js`
- · **low** `module_orphan` — Module is never imported `server/lib/llm-local.js`
- · **low** `module_orphan` — Module is never imported `server/lib/npc-ambient.js`
- · **low** `module_orphan` — Module is never imported `server/lib/npc-combat-profiles.js`
- · **low** `module_orphan` — Module is never imported `server/lib/reasoning/shadow-quality.js`
- · **low** `module_orphan` — Module is never imported `server/lib/sim/world.js`
- · **low** `module_orphan` — Module is never imported `server/lib/sqlite-retry.js`
- · **info** `route_orphan` — Route POST /api/studio/:projectId/render has no frontend caller `server/durable.js:661`
- · **info** `route_orphan` — Route POST /api/dtus/durable has no frontend caller `server/durable.js:954`
- · **info** `route_orphan` — Route GET /api/economy/license-tiers/:contentType has no frontend caller `server/economy/creator-economy-routes.js:59`
- · **info** `route_orphan` — Route GET /api/economy/license-tiers/:contentType/defaults has no frontend caller `server/economy/creator-economy-routes.js:72`
- · **info** `route_orphan` — Route POST /api/economy/license-tiers/:contentType/validate has no frontend caller `server/economy/creator-economy-routes.js:84`
- · **info** `route_orphan` — Route GET /api/economy/license-tiers/:contentType/upgrade has no frontend caller `server/economy/creator-economy-routes.js:96`
- · **info** `route_orphan` — Route GET /api/economy/distribution-modes has no frontend caller `server/economy/creator-economy-routes.js:110`
- · **info** `route_orphan` — Route GET /api/economy/distribution-modes/:modeId/preview/:contentType has no frontend caller `server/economy/creator-economy-routes.js:121`
- · **info** `route_orphan` — Route GET /api/economy/rights/check/:dtuId has no frontend caller `server/economy/creator-economy-routes.js:137`
- · **info** `route_orphan` — Route GET /api/economy/rights/licenses/:dtuId has no frontend caller `server/economy/creator-economy-routes.js:158`
- · **info** `route_orphan` — Route GET /api/economy/rights/my-licenses has no frontend caller `server/economy/creator-economy-routes.js:174`
- · **info** `route_orphan` — Route POST /api/economy/rights/purchase has no frontend caller `server/economy/creator-economy-routes.js:191`
- · **info** `route_orphan` — Route GET /api/economy/commissions/types/:creatorId has no frontend caller `server/economy/creator-economy-routes.js:267`
- · **info** `route_orphan` — Route POST /api/economy/commissions/types has no frontend caller `server/economy/creator-economy-routes.js:279`
- · **info** `route_orphan` — Route PUT /api/economy/commissions/types/:id has no frontend caller `server/economy/creator-economy-routes.js:294`
- · **info** `route_orphan` — Route POST /api/economy/commissions/request has no frontend caller `server/economy/creator-economy-routes.js:309`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/respond has no frontend caller `server/economy/creator-economy-routes.js:324`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/client-respond has no frontend caller `server/economy/creator-economy-routes.js:343`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/deliver has no frontend caller `server/economy/creator-economy-routes.js:362`
- _…and 181 more_

### invariant-guardian

_No findings._

### macro-usage

- · **info** `macro_usage_summary` — 707 macros · 0 dead · 411 single-caller · 1 popular · 253 dispatcher-reach (0 runtime-live, 0 retirement-candidates)
- · **info** `macro_dispatcher_reach` — Macro chicken3.status has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:9904`
- · **info** `macro_dispatcher_reach` — Macro chicken3.session_optin has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:9909`
- · **info** `macro_dispatcher_reach` — Macro hlr.trace has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14271`
- · **info** `macro_dispatcher_reach` — Macro hlr.list_traces has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14272`
- · **info** `macro_dispatcher_reach` — Macro hlr.metrics has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14273`
- · **info** `macro_dispatcher_reach` — Macro hlr.findings has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14274`
- · **info** `macro_dispatcher_reach` — Macro hlm.clusters has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14292`
- · **info** `macro_dispatcher_reach` — Macro hlm.gaps has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14296`
- · **info** `macro_dispatcher_reach` — Macro hlm.redundancy has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14301`
- · **info** `macro_dispatcher_reach` — Macro hlm.orphans has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14305`
- · **info** `macro_dispatcher_reach` — Macro hlm.topology has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14310`
- · **info** `macro_dispatcher_reach` — Macro hlm.domain_census has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14314`
- · **info** `macro_dispatcher_reach` — Macro hlm.freshness has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14318`
- · **info** `macro_dispatcher_reach` — Macro hlm.metrics has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14322`
- · **info** `macro_dispatcher_reach` — Macro understanding.parse has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14350`
- · **info** `macro_dispatcher_reach` — Macro understanding.compose has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14364`
- · **info** `macro_dispatcher_reach` — Macro understanding.get has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14379`
- · **info** `macro_dispatcher_reach` — Macro understanding.list has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14384`
- · **info** `macro_dispatcher_reach` — Macro understanding.recompose has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14387`
- · **info** `macro_dispatcher_reach` — Macro understanding.sweep has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14399`
- · **info** `macro_dispatcher_reach` — Macro understanding.subject_kinds has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14401`
- · **info** `macro_dispatcher_reach` — Macro understanding.record_evidence has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14419`
- · **info** `macro_dispatcher_reach` — Macro understanding.evaluate_promotion has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14422`
- · **info** `macro_dispatcher_reach` — Macro understanding.apply_promotion has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14425`
- · **info** `macro_dispatcher_reach` — Macro understanding.consolidate has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14428`
- · **info** `macro_dispatcher_reach` — Macro understanding.consolidation_candidates has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14431`
- · **info** `macro_dispatcher_reach` — Macro understanding.lineage has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14434`
- · **info** `macro_dispatcher_reach` — Macro understanding.evolution_tick has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14437`
- · **info** `macro_dispatcher_reach` — Macro understanding.promoted_by_composer has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14440`
- · **info** `macro_dispatcher_reach` — Macro understanding.evolution_stats has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14443`
- · **info** `macro_dispatcher_reach` — Macro cognition.understand has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14454`
- · **info** `macro_dispatcher_reach` — Macro cognition.live_understanding has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14465`
- · **info** `macro_dispatcher_reach` — Macro forge.verify_constraints has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14474`
- · **info** `macro_dispatcher_reach` — Macro council.understanding_for_proposal has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14480`
- · **info** `macro_dispatcher_reach` — Macro chat.compose_thread_understanding has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14509`
- · **info** `macro_dispatcher_reach` — Macro agents.create has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14539`
- · **info** `macro_dispatcher_reach` — Macro agents.run has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14540`
- · **info** `macro_dispatcher_reach` — Macro agents.pause has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14544`
- · **info** `macro_dispatcher_reach` — Macro agents.resume has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14545`
- · **info** `macro_dispatcher_reach` — Macro agents.destroy has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14546`
- · **info** `macro_dispatcher_reach` — Macro agents.get has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14547`
- · **info** `macro_dispatcher_reach` — Macro agents.list has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14548`
- · **info** `macro_dispatcher_reach` — Macro agents.findings has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14549`
- · **info** `macro_dispatcher_reach` — Macro agents.all_findings has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14550`
- · **info** `macro_dispatcher_reach` — Macro agents.freeze has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14551`
- · **info** `macro_dispatcher_reach` — Macro agents.thaw has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14552`
- · **info** `macro_dispatcher_reach` — Macro agents.tick has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14553`
- · **info** `macro_dispatcher_reach` — Macro agents.metrics has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14557`
- · **info** `macro_dispatcher_reach` — Macro hypothesis.add_evidence has no static callers but is reachable via open dispatcher (no telemetry yet) `server/server.js:14592`
- _…and 205 more_

### lens-health

- · **info** `lens_health_summary` — Scanned 203 lenses · 0 issues found

### dtu-lineage
> ⚠ failed: no_db 

_No findings._

### heartbeat-monitor

- · **info** `heartbeat_summary` — 32 heartbeats registered (static)

### secret-leak

- · **info** `secret_leak_summary` — Scanned 2882 files; flagged 0

### performance-hotspot

- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/durable.js:476`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/durable.js:481`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/creative-marketplace.js:329`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/creative-marketplace.js:1561`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/film-studio.js:758`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/film-studio.js:767`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/lens-culture.js:1048`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/marketplace-lens-service.js:180`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/reconciliation.js:346`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/routes.js:1993`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/storage.js:156`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/stripe.js:551`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/stripe.js:602`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/environment-sensor.js:63`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:453`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:459`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:465`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/affect/schema.js:63`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/admin.js:193`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/admin.js:223`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/admin.js:229`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/admin.js:266`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/affect.js:72`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/affect.js:221`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/affect.js:226`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/affect.js:385`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/affect.js:386`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/agriculture.js:38`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:27`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:28`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:40`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:41`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:137`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:254`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/alliance.js:368`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/anon.js:23`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/anon.js:30`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/anon.js:96`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/anon.js:97`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:141`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:236`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:283`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:303`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:304`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/appmaker.js:317`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/ar.js:256`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/atlas.js:384`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/attention.js:232`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/audit.js:122`
- • **medium** `perf_unbounded_cache_growth` — Module-level Map / Set used as cache with no eviction `server/domains/audit.js:123`
- _…and 752 more_

### historical-trend

- · **info** `historical_trend_summary` — Only 1 history rows — need ≥5 for slope analysis

### predictive-growth

- · **info** `predictive_growth_summary` — 12 samples · 0 tables observed · heap 5MB

### architectural-hub

- ⚠️  **high** `architectural_hub_split_risk` — Module server/logger.js fan-in=176 fan-out=0 `server/logger.js`
- ⚠️  **high** `architectural_import_cycle` — Import cycle of 4 modules: server/emergent/atlas-scope-router.js → server/emergent/atlas-write-guard.js → server/emergent/atlas-rights.js → server/emergent/atlas-scope-router.js `server/emergent/atlas-scope-router.js`
- · **info** `architectural_hub_summary` — Scanned 1522 server modules · 1 hubs · 0 hub-of-hubs · 1 cycles
