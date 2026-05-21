# parenting — Feature Gap vs Huckleberry

Category leader (2026): Huckleberry / BabyCenter (baby tracking + sleep). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/parenting.js` — ~32 macros: children CRUD, feed/sleep/diaper/pump logging + history + stats, growth log + percentile, milestone checklist/record/progress, medicine log, activity log, day timeline, dashboard, CPSC child-safety recall feed.

## Has (verified in code)
- Children CRUD; feed, sleep, diaper, pumping session logging with history + stats
- Sleep "sweet-spot" analysis + routine optimizer; day timeline view
- Growth logging with percentile calculation; WHO-style growth tracking
- Milestone checklist, record, and progress tracking; immunization tracker
- Medication log, activity log, 6 mode tabs (milestones/schedules/health/activities/growth/education)
- Live CPSC child-product recall feed ingested as DTUs; parenting dashboard

## Missing — buildable feature backlog
- [ ] `[M]` Sleep schedule predictor — predict next nap/bedtime windows from logged patterns (Huckleberry's "SweetSpot" core)
- [ ] `[S]` Visual growth percentile charts — plot weight/height/head against WHO curves
- [ ] `[M]` Multi-caregiver sync — shared baby log across parents/nanny in real time
- [ ] `[S]` Quick-entry widgets + timers — one-tap start/stop nursing and sleep timers
- [ ] `[M]` Personalized expert content — age-targeted articles and developmental tips
- [ ] `[S]` Trends + insights — weekly summary of feeds/sleep/diapers with anomalies flagged
- [ ] `[S]` Pediatric appointment + vaccine reminders with calendar export

## Parity
~60% of Huckleberry's feature surface. The logging substrate is genuinely complete (feed/sleep/diaper/pump/growth/milestones), but it lacks the predictive sleep-schedule engine, visual percentile charts, and multi-caregiver real-time sync that define the leader.
