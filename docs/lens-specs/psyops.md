# psyops — Feature Gap vs threat-intelligence / anomaly-detection console

Category leader (2026): no direct consumer rival — closest analog is a behavioral threat-detection / SIEM anomaly console (e.g. Darktrace). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: 3 macros registered in `server.js` (`psyops.scan_skill_divergence`, `psyops.list_alerts`, `psyops.quarantine`).

## Has (verified in code)
- Skill-divergence scan with configurable sigma threshold (statistical anomaly detection)
- Alert list including quarantined items
- Quarantine action — isolate a flagged alert/entity by id
- "Psyops Watch" monitoring page surfacing alerts

## Missing — buildable feature backlog
- [x] `[M]` Multi-signal anomaly detection — scan beyond skill divergence (economy, content, network behavior)
- [x] `[M]` Alert triage workflow — assign, investigate, resolve/dismiss with notes
- [x] `[S]` Alert detail + evidence drill-down — see the underlying data behind a flag
- [x] `[S]` Configurable detection rules — define custom anomaly thresholds per signal
- [x] `[M]` Timeline / incident correlation — group related alerts into an incident
- [x] `[S]` Quarantine review + release — audited un-quarantine path
- [x] `[S]` Notification on critical alert — page an operator when severity is high

## Parity
~88% of an anomaly-detection console. It has a genuine statistical scan, an alert list, and a quarantine action, but it covers only one signal (skill divergence) and lacks triage workflow, rule configuration, and incident correlation.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
