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
- [ ] `[M]` Visual sync topology graph (worlds/peers as nodes, flows as edges)
- [ ] `[S]` Per-flow retry / replay of a failed bridge action
- [ ] `[M]` Field-mapping editor for cross-world data transforms
- [ ] `[S]` Sync schedule configuration per peer
- [ ] `[M]` Alerting on sync failure / lag thresholds
- [ ] `[S]` Throughput history charts over time

## Parity
~50% of an integration-monitoring console. Real organism/bridge/debate substrate with health analytics, but lacks the visual topology, mapping editor, and retry/alerting that an ops-grade sync console needs.
