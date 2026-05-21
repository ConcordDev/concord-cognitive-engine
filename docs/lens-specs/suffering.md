# suffering — Feature Gap vs Productboard / pain-point analysis tools

Category leader (2026): Productboard / Dovetail (customer pain-point + root-cause analysis). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `suffering` domain macros (`painPointMapping`, `rootCause`, `interventionDesign`) — pure-compute analysis; plus `/api/status` for the engine's own Chicken2 wellbeing metrics.

## Has (verified in code)
- Pain-point mapping macro (maps reported pains to severity/frequency).
- Root-cause analysis macro (decomposes a pain into contributing causes).
- Intervention design macro (proposes mitigations).
- Engine-self wellbeing dashboard — suffering / homeostasis / contradiction-load / functional-decline metrics from `/api/status`.
- Metric artifact CRUD, realtime panel, analyze action, feature panel.

## Missing — buildable feature backlog
- [ ] `[M]` Pain-point board / prioritization matrix (impact vs effort) like Productboard.
- [ ] `[M]` Theming / clustering of related pain points into themes.
- [ ] `[S]` Severity/frequency scoring with sortable ranked list.
- [ ] `[M]` Intervention tracking — link an intervention to a pain and track resolution status over time.
- [ ] `[M]` Trend view — pain metrics over time, not just current values.
- [ ] `[S]` Evidence/quote attachments per pain point.
- [ ] `[M]` Root-cause tree visualization (fishbone / 5-whys diagram).
- [ ] `[S]` Export analysis as a report.

## Parity
~40% of Productboard. The three analysis macros plus the engine-self wellbeing readout are a genuine concept, but it lacks a prioritization board, theming, intervention tracking, and trend views that make pain-point tools actionable.
