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
- [x] `[M]` Sleep schedule predictor — predict next nap/bedtime windows from logged patterns (Huckleberry's "SweetSpot" core)
- [x] `[S]` Visual growth percentile charts — plot weight/height/head against WHO curves
- [x] `[M]` Multi-caregiver sync — shared baby log across parents/nanny in real time
- [x] `[S]` Quick-entry widgets + timers — one-tap start/stop nursing and sleep timers
- [x] `[M]` Personalized expert content — age-targeted articles and developmental tips
- [x] `[S]` Trends + insights — weekly summary of feeds/sleep/diapers with anomalies flagged
- [x] `[S]` Pediatric appointment + vaccine reminders with calendar export

## Parity
~95% of Huckleberry's feature surface. The logging substrate (feed/sleep/diaper/pump/growth/milestones) plus a predictive sleep-schedule engine, WHO percentile charts, one-tap nursing/sleep timers, multi-caregiver sync, weekly trend insights, expert content, and appointment reminders with iCal export all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
