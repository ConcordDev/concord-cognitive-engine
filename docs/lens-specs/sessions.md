# sessions — Feature Gap vs a workflow / task-session manager

Category leader (2026): no direct consumer rival — closest analog is a cross-app workflow/session manager (browser session managers, IDE workspace restore). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/sessions.js` — multi-step session substrate; page uses `sessions.list_mine`, `sessions.get`, `sessions.close` macros.

## Has (verified in code)
- Lists every session across all lenses for the caller, real data end-to-end
- Status grouping + filter chips: all/open/paused/completed/abandoned with counts
- Per-session row: title, lens, current step, transition count, last-updated time-ago
- Actions: Resume (jump to the lens), Complete, Abandon
- Empty-state CTA pointing to session-aware lenses; mobile tab bar; refresh

## Missing — buildable feature backlog
- [x] `[M]` Session detail view — see the full step history / transitions of one session
- [x] `[S]` Search + sort sessions — by lens, title, age
- [x] `[S]` Pause action — the UI offers Complete/Abandon but not an explicit pause
- [x] `[S]` Session timeline / step breadcrumb — visualize progress within a session
- [x] `[S]` Rename / annotate a session
- [x] `[S]` Stale-session reminders — nudge to resume or close long-idle sessions
- [x] `[S]` Bulk close abandoned sessions

## Parity
~95% of a session-manager's feature surface. The cross-lens session index plus a per-session detail/step-history view, search + sort, pause/resume, a step-breadcrumb timeline, rename/annotate, stale-session reminders, and bulk-close all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
