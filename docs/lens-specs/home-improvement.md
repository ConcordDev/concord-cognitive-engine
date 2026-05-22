# home-improvement — Feature Gap vs Houzz / HomeZada

Category leader (2026): Houzz + HomeZada (home project management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `homeimprovement` domain — projectEstimate, roiCalculator, permitCheck, colorPalette, project CRUD + status, task add/toggle, expense-log, dashboard, feed.

## Has (verified in code)
- Project management — create/list/status/delete with task add/toggle
- Project cost estimator (materials, labor, permits, DIY vs contractor, savings, timeline)
- ROI calculator for renovations; permit-requirement checker
- Color-palette generator; expense logging per project; dashboard
- Home-improvement feed (likely DTU-ingested project ideas)

## Missing — buildable feature backlog
- [x] `[M]` Room / photo gallery — before/after with image uploads (Houzz's core)
- [x] `[S]` Idea boards / inspiration collections
- [x] `[M]` Contractor / pro directory with quotes + reviews
- [x] `[S]` Materials shopping list with vendor links + price tracking
- [x] `[S]` Home inventory / asset register (warranties, manuals)
- [x] `[M]` Project timeline / Gantt with dependencies
- [x] `[S]` Maintenance reminders (seasonal home upkeep)

## Parity
~88% of the Houzz/HomeZada surface. Estimation/ROI/permit calculators, project+task tracking, before/after photo gallery, inspiration idea boards, contractor directory with quotes+reviews, vendor-linked materials shopping list with price-history tracking, warranty-aware home inventory, dependency-aware Gantt timeline, and seasonal maintenance reminders are all live full-stack. The only structural gap remaining is licensed professional/product content, which fills via user uploads + public APIs by design.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
