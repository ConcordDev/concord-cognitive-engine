# admin — Feature Gap vs Datadog / Grafana

Category leader (2026): Datadog (closest analog for an internal ops console — no direct consumer rival). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/admin.js` (486 LOC) + REST `/api/admin/*` dashboard/metrics; mounts MonitoringPanel, BackupHealth, CDNStatus, CodeEngineStatus, RepairDashboard, LiveSystemHealth, NervousSystem.

## Has (verified in code)
- System dashboard: version, uptime, heap/RSS memory, node version
- DTU census (regular/mega/hyper/shadow), session counts, organ health
- LLM/Ollama readiness, queue depths, plugin registry, search-index status
- Chicken2 metrics (continuity, homeostasis, contradiction load), backup health
- CDN status, code-engine status, repair dashboard, live system health stream

## Missing — buildable feature backlog
- [ ] `[M]` Historical time-series charts with selectable ranges (only point-in-time)
- [ ] `[M]` Alert rules + thresholds editable from the UI (alerts live only in prometheus yml)
- [ ] `[M]` Per-user / per-tenant admin actions: suspend, role-change, quota edit
- [ ] `[S]` Log search/tail panel with severity filter
- [ ] `[M]` Distributed-trace / request-waterfall view for slow endpoints
- [ ] `[S]` Feature-flag toggles surfaced in UI
- [ ] `[M]` Incident timeline + on-call acknowledgement workflow

## Parity
~50% of Datadog's ops-console surface. Rich live snapshot of the substrate, but no time-series history, no editable alerting, and no tenant-management actions.
