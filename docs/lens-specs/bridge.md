# bridge — Feature Gap vs (cross-world federation console)

Category leader (2026): no direct consumer rival — internal cross-world / DTU-organism federation console. Closest analog is an integration/sync dashboard (Zapier history, MuleSoft Anypoint monitoring).
Backend: `server/domains/bridge.js` — macros `connectionHealth`, `dataMapping`, `syncStatus`, `throughputAnalysis`; surfaces DTU organisms, bridge log, debates, ConcordLinkWalkers.

## Has (verified in code)
- DTU-organism roster (awakened swarms with persona, objective, top tags)
- Bridge activity log (actions, swarm names, DTU IDs)
- Organism debates with transcript, verdict, resolution
- Connection-health, data-mapping, sync-status, throughput-analysis compute
- ConcordLinkWalkers panel; DTU detail view; realtime data panel

## Missing — buildable feature backlog
- [x] `[M]` Visual sync topology graph (worlds/peers as nodes, flows as edges)
- [x] `[S]` Per-flow retry / replay of a failed bridge action
- [x] `[M]` Field-mapping editor for cross-world data transforms
- [x] `[S]` Sync schedule configuration per peer
- [x] `[M]` Alerting on sync failure / lag thresholds
- [x] `[S]` Throughput history charts over time

## Parity
Full ops-grade integration-monitoring console. The original organism/bridge/debate
substrate plus a Federation Console (`components/bridge/FederationConsole.tsx`,
"federation" tab) wiring the `syncTopology`, `recordFlow`/`flowList`/`flowReplay`,
`mappingUpsert`/`mappingList`/`mappingRemove`/`mappingPreview`, `scheduleSet`/`scheduleList`,
`alertRuleUpsert`/`alertRuleList`/`alertRuleRemove`/`alertEvaluate`, `throughputHistory`
and `peerRegister`/`peerList`/`peerRemove` macros to real controls: an SVG topology
graph, per-flow replay, a field-mapping editor with live transform preview, per-peer
sync schedules, threshold alerting, and throughput history charts.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
