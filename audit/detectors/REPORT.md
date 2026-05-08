# Detector report

Generated: `2026-05-08T22:28:56.376Z`  Consumer: `all`  Total findings: **1275**

| severity | count |
|---|---|
| critical | 0 |
| high | 0 |
| medium | 0 |
| low | 812 |
| info | 463 |

## Detectors

| id | ok | total | critical | high | medium | low | duration |
|---|---|---|---|---|---|---|---|
| stale-code | yes | 211 | 0 | 0 | 0 | 11 | 22739ms |
| invariant-guardian | yes | 0 | 0 | 0 | 0 | 0 | 4042ms |
| macro-usage | yes | 255 | 0 | 0 | 0 | 0 | 11415ms |
| lens-health | yes | 1 | 0 | 0 | 0 | 0 | 1141ms |
| dtu-lineage | no (no_db) | 0 | 0 | 0 | 0 | 0 | 0ms |
| heartbeat-monitor | yes | 1 | 0 | 0 | 0 | 0 | 398ms |
| secret-leak | yes | 1 | 0 | 0 | 0 | 0 | 3959ms |
| performance-hotspot | yes | 802 | 0 | 0 | 0 | 801 | 2382ms |
| historical-trend | yes | 1 | 0 | 0 | 0 | 0 | 9ms |
| predictive-growth | yes | 1 | 0 | 0 | 0 | 0 | 27ms |
| architectural-hub | yes | 2 | 0 | 0 | 0 | 0 | 2701ms |

### stale-code

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
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/approve has no frontend caller `server/economy/creator-economy-routes.js:381`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/dispute has no frontend caller `server/economy/creator-economy-routes.js:399`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/resolve has no frontend caller `server/economy/creator-economy-routes.js:418`
- · **info** `route_orphan` — Route GET /api/economy/commissions/my/:role has no frontend caller `server/economy/creator-economy-routes.js:434`
- · **info** `route_orphan` — Route GET /api/economy/commissions/:requestId has no frontend caller `server/economy/creator-economy-routes.js:449`
- · **info** `route_orphan` — Route POST /api/economy/commissions/:requestId/message has no frontend caller `server/economy/creator-economy-routes.js:462`
- · **info** `route_orphan` — Route POST /api/economy/global/submit has no frontend caller `server/economy/creator-economy-routes.js:485`
- · **info** `route_orphan` — Route POST /api/economy/global/review/:submissionId has no frontend caller `server/economy/creator-economy-routes.js:500`
- · **info** `route_orphan` — Route POST /api/economy/global/finalize/:submissionId has no frontend caller `server/economy/creator-economy-routes.js:521`
- · **info** `route_orphan` — Route POST /api/economy/global/challenge has no frontend caller `server/economy/creator-economy-routes.js:533`
- · **info** `route_orphan` — Route POST /api/economy/global/challenge/:challengeId/resolve has no frontend caller `server/economy/creator-economy-routes.js:552`
- · **info** `route_orphan` — Route GET /api/economy/global/feed has no frontend caller `server/economy/creator-economy-routes.js:568`
- · **info** `route_orphan` — Route GET /api/economy/global/stats has no frontend caller `server/economy/creator-economy-routes.js:582`
- · **info** `route_orphan` — Route POST /api/economy/global/health-check/:dtuId has no frontend caller `server/economy/creator-economy-routes.js:594`
- · **info** `route_orphan` — Route POST /api/economy/global/demote/:dtuId has no frontend caller `server/economy/creator-economy-routes.js:606`
- · **info** `route_orphan` — Route GET /api/economy/micro-cc/rates has no frontend caller `server/economy/creator-economy-routes.js:622`
- · **info** `route_orphan` — Route GET /api/economy/micro-cc/convert has no frontend caller `server/economy/creator-economy-routes.js:628`
- · **info** `route_orphan` — Route POST /api/economy/micro-cc/calculate-fee has no frontend caller `server/economy/creator-economy-routes.js:651`
- · **info** `route_orphan` — Route POST /api/economy/micro-cc/stripe-convert has no frontend caller `server/economy/creator-economy-routes.js:679`
- · **info** `route_orphan` — Route POST /api/stripe/webhook has no frontend caller `server/economy/routes.js:632`
- _…and 161 more_

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

- · **info** `secret_leak_summary` — Scanned 2883 files; flagged 0

### performance-hotspot

- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:325`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:349`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:374`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:390`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:449`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:459`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:462`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:470`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:475`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:487`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:503`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:526`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:640`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:663`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:853`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:920`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:942`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/durable.js:987`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/api-billing.js:240`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/api-billing.js:482`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/api-billing.js:574`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/api-billing.js:607`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/chargeback-handler.js:74`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/chargeback-handler.js:83`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/coin-service.js:145`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/coin-service.js:198`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:152`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:195`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:216`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:249`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:296`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:335`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:382`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:408`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:449`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:483`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:549`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:562`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/commission-service.js:604`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:393`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:963`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:976`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1100`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1225`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1387`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1400`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1418`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1496`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1513`
- · **low** `perf_select_star_hot` — SELECT * — better to project explicit columns `server/economy/creative-marketplace.js:1531`
- _…and 752 more_

### historical-trend

- · **info** `historical_trend_summary` — Only 1 history rows — need ≥5 for slope analysis

### predictive-growth

- · **info** `predictive_growth_summary` — 30 samples · 0 tables observed · heap 5MB

### architectural-hub

- · **info** `architectural_hub_summary` — Scanned 1523 server modules · 0 hubs · 0 hub-of-hubs · 0 cycles
- · **info** `architectural_leaf_utility` — Module server/logger.js fan-in=176 fan-out=0 (leaf utility — wide use is by design) `server/logger.js`
