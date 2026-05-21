# command-center — Feature Gap vs Datadog / PagerDuty (ops cockpit)

Category leader (2026): no direct consumer rival — internal whole-system ops cockpit. Closest analog is a Datadog/PagerDuty mission-control dashboard.
Backend: REST aggregator — `/api/cognitive/status`, `/api/dtus/*`, `/api/federation/{status,peers,escalation}`, `/api/shield/{status,threats,predictions}`, `/api/affect/state`, `/api/organism/pipeline/status`, `/api/loaf/status`; guidance + undo timeline endpoints.

## Has (verified in code)
- ConcordVitals: system version, uptime, heap/RSS, DTU census (regular/mega/hyper/shadow)
- LLM/Ollama readiness; cognitive status; affect state
- Federation: peers, status, escalation stats; shield: threats, predictions, status
- Organism pipeline status; shadow-DTU pending queue
- Guidance: ActionPreviewModal, ActivityFeed, UndoTimeline, SystemGuidePanel
- Pause/resume controls; navigation to deep lenses

## Missing — buildable feature backlog
- [x] `[M]` Time-series history for every vital (only point-in-time snapshots)
- [x] `[M]` Alerting rules + acknowledgement / on-call escalation workflow
- [x] `[S]` Customizable widget layout / saved dashboards
- [x] `[M]` Incident timeline with status updates + postmortem notes
- [x] `[S]` Cross-vital correlation view (what changed together)
- [x] `[S]` Threshold-coloring + at-a-glance health rollup score
- [x] `[M]` Runbook actions wired to one-click remediation

## Parity
~90% of an ops-cockpit's surface. Broad live aggregation across the whole substrate plus time-series vital history, an alert-rules engine with acknowledgement/on-call, saved dashboards, incident timeline + postmortems, cross-vital correlation, threshold coloring + health rollup, and one-click runbook remediation all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
