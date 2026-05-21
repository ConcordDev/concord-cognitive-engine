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
- [ ] `[M]` Time-series history for every vital (only point-in-time snapshots)
- [ ] `[M]` Alerting rules + acknowledgement / on-call escalation workflow
- [ ] `[S]` Customizable widget layout / saved dashboards
- [ ] `[M]` Incident timeline with status updates + postmortem notes
- [ ] `[S]` Cross-vital correlation view (what changed together)
- [ ] `[S]` Threshold-coloring + at-a-glance health rollup score
- [ ] `[M]` Runbook actions wired to one-click remediation

## Parity
~52% of an ops-cockpit's surface. Genuinely broad live aggregation across the whole substrate (DTUs, federation, shield, cognition, organisms) plus undo/guidance, but lacks time-series history, alerting/on-call, and incident management.
