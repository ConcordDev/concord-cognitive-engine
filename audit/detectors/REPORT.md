# Detector report

Generated: `2026-05-08T20:01:16.221Z`  Consumer: `all`  Total findings: **1921**

| severity | count |
|---|---|
| critical | 0 |
| high | 87 |
| medium | 564 |
| low | 1065 |
| info | 205 |

## Detectors

| id | ok | total | critical | high | medium | low | duration |
|---|---|---|---|---|---|---|---|
| stale-code | yes | 862 | 0 | 0 | 24 | 638 | 23509ms |
| invariant-guardian | yes | 0 | 0 | 0 | 0 | 0 | 10727ms |
| macro-usage | yes | 254 | 0 | 0 | 0 | 253 | 10790ms |
| lens-health | yes | 1 | 0 | 0 | 0 | 0 | 733ms |
| dtu-lineage | no (no_db) | 0 | 0 | 0 | 0 | 0 | 0ms |
| heartbeat-monitor | yes | 1 | 0 | 0 | 0 | 0 | 294ms |
| secret-leak | yes | 1 | 0 | 0 | 0 | 0 | 10639ms |
| performance-hotspot | yes | 802 | 0 | 87 | 540 | 174 | 942ms |

### stale-code

- • **medium** `table_orphan` — Table dtu_embeddings is created but never read or written outside migrations `server/migrations/006_embedding_column.js:24`
- • **medium** `table_orphan` — Table preserved is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:11`
- • **medium** `table_orphan` — Table personality_state is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:20`
- • **medium** `table_orphan` — Table personality_evolution_log is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:34`
- • **medium** `table_orphan` — Table wants is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:44`
- • **medium** `table_orphan` — Table want_audit_log is created but never read or written outside migrations `server/migrations/009_brain_want_engine.js:69`
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
- • **medium** `table_orphan` — Table evo_asset_interactions_fix is created but never read or written outside migrations `server/migrations/107_evo_assets_fk_repair.js:68`
- • **medium** `table_orphan` — Table evo_asset_versions_fix is created but never read or written outside migrations `server/migrations/107_evo_assets_fk_repair.js:99`
- · **low** `macro_unused` — Macro commune.list is registered but never called by name `server/domains/commune.js:20`
- · **low** `macro_unused` — Macro commune.get is registered but never called by name `server/domains/commune.js:24`
- · **low** `macro_unused` — Macro commune.create is registered but never called by name `server/domains/commune.js:30`
- · **low** `macro_unused` — Macro commune.validate is registered but never called by name `server/domains/commune.js:36`
- · **low** `macro_unused` — Macro commune.remove is registered but never called by name `server/domains/commune.js:40`
- · **low** `macro_unused` — Macro commune.options is registered but never called by name `server/domains/commune.js:46`
- · **low** `macro_unused` — Macro detectors.list is registered but never called by name `server/domains/detectors.js:19`
- · **low** `macro_unused` — Macro detectors.run is registered but never called by name `server/domains/detectors.js:27`
- · **low** `macro_unused` — Macro detectors.runAll is registered but never called by name `server/domains/detectors.js:42`
- · **low** `macro_unused` — Macro detectors.findings is registered but never called by name `server/domains/detectors.js:57`
- · **low** `macro_unused` — Macro emergent.reproduce is registered but never called by name `server/emergent/index.js:953`
- · **low** `macro_unused` — Macro emergent.growth.reputation is registered but never called by name `server/emergent/index.js:1044`
- · **low** `macro_unused` — Macro emergent.growth.contradiction is registered but never called by name `server/emergent/index.js:1048`
- · **low** `macro_unused` — Macro emergent.growth.prediction is registered but never called by name `server/emergent/index.js:1052`
- · **low** `macro_unused` — Macro emergent.reality.recordWork is registered but never called by name `server/emergent/index.js:1264`
- · **low** `macro_unused` — Macro emergent.reality.workHistory is registered but never called by name `server/emergent/index.js:1268`
- · **low** `macro_unused` — Macro emergent.reality.cascadeContradiction is registered but never called by name `server/emergent/index.js:1272`
- · **low** `macro_unused` — Macro emergent.reality.transitiveTrust is registered but never called by name `server/emergent/index.js:1276`
- · **low** `macro_unused` — Macro emergent.sector.list is registered but never called by name `server/emergent/index.js:1284`
- · **low** `macro_unused` — Macro emergent.sector.get is registered but never called by name `server/emergent/index.js:1288`
- · **low** `macro_unused` — Macro emergent.sector.access is registered but never called by name `server/emergent/index.js:1294`
- · **low** `macro_unused` — Macro emergent.sector.home is registered but never called by name `server/emergent/index.js:1298`
- · **low** `macro_unused` — Macro emergent.sector.noiseFloor is registered but never called by name `server/emergent/index.js:1302`
- · **low** `macro_unused` — Macro emergent.sector.route is registered but never called by name `server/emergent/index.js:1306`
- · **low** `macro_unused` — Macro emergent.sector.health is registered but never called by name `server/emergent/index.js:1310`
- · **low** `macro_unused` — Macro emergent.sector.moduleMap is registered but never called by name `server/emergent/index.js:1314`
- _…and 812 more_

### invariant-guardian

_No findings._

### macro-usage

- · **low** `macro_zero_calls` — Macro chicken3.status is registered but has no static callers `server/server.js:9785`
- · **low** `macro_zero_calls` — Macro chicken3.session_optin is registered but has no static callers `server/server.js:9790`
- · **low** `macro_zero_calls` — Macro hlr.trace is registered but has no static callers `server/server.js:14132`
- · **low** `macro_zero_calls` — Macro hlr.list_traces is registered but has no static callers `server/server.js:14133`
- · **low** `macro_zero_calls` — Macro hlr.metrics is registered but has no static callers `server/server.js:14134`
- · **low** `macro_zero_calls` — Macro hlr.findings is registered but has no static callers `server/server.js:14135`
- · **low** `macro_zero_calls` — Macro hlm.clusters is registered but has no static callers `server/server.js:14153`
- · **low** `macro_zero_calls` — Macro hlm.gaps is registered but has no static callers `server/server.js:14157`
- · **low** `macro_zero_calls` — Macro hlm.redundancy is registered but has no static callers `server/server.js:14162`
- · **low** `macro_zero_calls` — Macro hlm.orphans is registered but has no static callers `server/server.js:14166`
- · **low** `macro_zero_calls` — Macro hlm.topology is registered but has no static callers `server/server.js:14171`
- · **low** `macro_zero_calls` — Macro hlm.domain_census is registered but has no static callers `server/server.js:14175`
- · **low** `macro_zero_calls` — Macro hlm.freshness is registered but has no static callers `server/server.js:14179`
- · **low** `macro_zero_calls` — Macro hlm.metrics is registered but has no static callers `server/server.js:14183`
- · **low** `macro_zero_calls` — Macro understanding.parse is registered but has no static callers `server/server.js:14211`
- · **low** `macro_zero_calls` — Macro understanding.compose is registered but has no static callers `server/server.js:14225`
- · **low** `macro_zero_calls` — Macro understanding.get is registered but has no static callers `server/server.js:14240`
- · **low** `macro_zero_calls` — Macro understanding.list is registered but has no static callers `server/server.js:14245`
- · **low** `macro_zero_calls` — Macro understanding.recompose is registered but has no static callers `server/server.js:14248`
- · **low** `macro_zero_calls` — Macro understanding.sweep is registered but has no static callers `server/server.js:14260`
- · **low** `macro_zero_calls` — Macro understanding.subject_kinds is registered but has no static callers `server/server.js:14262`
- · **low** `macro_zero_calls` — Macro understanding.record_evidence is registered but has no static callers `server/server.js:14280`
- · **low** `macro_zero_calls` — Macro understanding.evaluate_promotion is registered but has no static callers `server/server.js:14283`
- · **low** `macro_zero_calls` — Macro understanding.apply_promotion is registered but has no static callers `server/server.js:14286`
- · **low** `macro_zero_calls` — Macro understanding.consolidate is registered but has no static callers `server/server.js:14289`
- · **low** `macro_zero_calls` — Macro understanding.consolidation_candidates is registered but has no static callers `server/server.js:14292`
- · **low** `macro_zero_calls` — Macro understanding.lineage is registered but has no static callers `server/server.js:14295`
- · **low** `macro_zero_calls` — Macro understanding.evolution_tick is registered but has no static callers `server/server.js:14298`
- · **low** `macro_zero_calls` — Macro understanding.promoted_by_composer is registered but has no static callers `server/server.js:14301`
- · **low** `macro_zero_calls` — Macro understanding.evolution_stats is registered but has no static callers `server/server.js:14304`
- · **low** `macro_zero_calls` — Macro cognition.understand is registered but has no static callers `server/server.js:14315`
- · **low** `macro_zero_calls` — Macro cognition.live_understanding is registered but has no static callers `server/server.js:14326`
- · **low** `macro_zero_calls` — Macro forge.verify_constraints is registered but has no static callers `server/server.js:14335`
- · **low** `macro_zero_calls` — Macro council.understanding_for_proposal is registered but has no static callers `server/server.js:14341`
- · **low** `macro_zero_calls` — Macro chat.compose_thread_understanding is registered but has no static callers `server/server.js:14370`
- · **low** `macro_zero_calls` — Macro agents.create is registered but has no static callers `server/server.js:14400`
- · **low** `macro_zero_calls` — Macro agents.run is registered but has no static callers `server/server.js:14401`
- · **low** `macro_zero_calls` — Macro agents.pause is registered but has no static callers `server/server.js:14405`
- · **low** `macro_zero_calls` — Macro agents.resume is registered but has no static callers `server/server.js:14406`
- · **low** `macro_zero_calls` — Macro agents.destroy is registered but has no static callers `server/server.js:14407`
- · **low** `macro_zero_calls` — Macro agents.get is registered but has no static callers `server/server.js:14408`
- · **low** `macro_zero_calls` — Macro agents.list is registered but has no static callers `server/server.js:14409`
- · **low** `macro_zero_calls` — Macro agents.findings is registered but has no static callers `server/server.js:14410`
- · **low** `macro_zero_calls` — Macro agents.all_findings is registered but has no static callers `server/server.js:14411`
- · **low** `macro_zero_calls` — Macro agents.freeze is registered but has no static callers `server/server.js:14412`
- · **low** `macro_zero_calls` — Macro agents.thaw is registered but has no static callers `server/server.js:14413`
- · **low** `macro_zero_calls` — Macro agents.tick is registered but has no static callers `server/server.js:14414`
- · **low** `macro_zero_calls` — Macro agents.metrics is registered but has no static callers `server/server.js:14418`
- · **low** `macro_zero_calls` — Macro hypothesis.add_evidence is registered but has no static callers `server/server.js:14453`
- · **low** `macro_zero_calls` — Macro hypothesis.add_test is registered but has no static callers `server/server.js:14454`
- _…and 204 more_

### lens-health

- · **info** `lens_health_summary` — Scanned 203 lenses · 0 issues found

### dtu-lineage
> ⚠ failed: no_db 

_No findings._

### heartbeat-monitor

- · **info** `heartbeat_summary` — 27 heartbeats registered (static)

### secret-leak

- · **info** `secret_leak_summary` — Scanned 2844 files; flagged 0

### performance-hotspot

- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/durable.js:476`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/durable.js:481`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/creative-marketplace.js:251`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/creative-marketplace.js:320`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/creative-marketplace.js:1552`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/dtu-pipeline.js:338`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/dtu-pipeline.js:410`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/film-studio.js:136`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/film-studio.js:753`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/film-studio.js:762`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/lens-culture.js:1048`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/marketplace-lens-service.js:180`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/reconciliation.js:346`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/routes.js:1993`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/royalty-cascade.js:187`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/royalty-cascade.js:468`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/royalty-cascade.js:502`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/storage.js:156`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/stripe.js:551`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/economy/stripe.js:602`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/bootstrap-ingestion.js:787`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/bootstrap-ingestion.js:791`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/bootstrap-ingestion.js:801`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/bootstrap-ingestion.js:804`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/environment-sensor.js:63`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:453`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:459`
- ⚠️  **high** `perf_uncaught_sql_loop` — Likely N+1 — db.prepare(...).get/all inside a for/while loop `server/emergent/forge-template-engine.js:465`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:281`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:289`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:292`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:321`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:337`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:340`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:342`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/persistence.js:355`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:95`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1361`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1362`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1389`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1392`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1399`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1427`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1428`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1436`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1437`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1469`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1470`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1477`
- ⚠️  **high** `perf_sync_fs_in_handler` — Synchronous fs call (readFileSync / writeFileSync) inside async path `server/emergent/repair-cortex.js:1493`
- _…and 752 more_
