# Calendar Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/calendar.js` (1554 LOC) in full — the entire backend
> surface for this lens (no inline registrations elsewhere; confirmed via
> grep).
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("calendar"' server/domains/calendar.js`

## Backend surface — 51 macros, all real

Two distinct tiers coexist by design, and this matters for reading the
checklist below correctly:

**(A) 4 stateless scratch-pad calculators** (`detectConflicts`,
`findAvailability`, `expandRecurring`, `scheduleOptimize`) operating on
caller-supplied ad-hoc `artifact.data.events`/`tasks` — a "paste some
events, see the analysis" utility tool, exactly like carpentry's shop
calculators. Surfaced in `ScheduleAnalyzer.tsx`/`CalendarActionPanel.tsx`.

**(B) 47 `STATE.calendarLens`-backed macros** implementing a real,
persistent, per-user calendar engine: calendars CRUD, events CRUD with
real RRULE-lite recurrence expansion, tasks + AI auto-schedule, real
STATE-backed conflict/availability checks against the user's *actual saved
events* (distinct from tier A), appointment booking pages, real two-way
Google Calendar sync (OAuth + SSRF-guarded connector writes/reads),
calendar sharing, reminders, working-location/OOO status events, video-
conference link generation, guest invites/RSVP, and iCalendar (RFC 5545)
import/export.

| Macro | Real effect | Surfaced (before) | Surfaced (after) |
|---|---|---|---|
| `calendars-create`/`list`/`update` | real per-user calendar CRUD | DESIGNED (`GCalSection.tsx`) | DESIGNED |
| `calendars-delete` | delete a non-default calendar (cascades its events) | **UNSURFACED** | **FIXED THIS SESSION** — delete button in the sidebar calendar list |
| `events-create`/`list`/`update`/`delete` | real event CRUD with recurrence | DESIGNED (`GCalSection.tsx`) | DESIGNED |
| `tasks-*`, `ai-auto-schedule`, `nl-parse-event` | tasks + AI scheduling + natural-language event parsing | DESIGNED (`GCalSection.tsx`) | DESIGNED |
| `conflicts-check` | STATE-backed conflict check against the user's *real saved events* | **UNSURFACED** | **FIXED THIS SESSION** — "Conflicts & Availability" tab |
| `availability-find` | STATE-backed free-slot finder against the user's *real saved events* | **UNSURFACED** | **FIXED THIS SESSION** — same tab |
| `appointment-*` | bookable-window scheduling pages (Calendly-style) | DESIGNED (`AppointmentSchedules.tsx`) | DESIGNED |
| `accounts-connect`/`list`/`sync`/`disconnect` | ICS-feed account sync | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `accounts-connect-google` | Google OAuth authorize URL | DESIGNED (`GCalSection.tsx`) | DESIGNED |
| `accounts-pull-events` | real Google Calendar API read | DESIGNED (`GCalSection.tsx`) | DESIGNED |
| `accounts-push-event` | real two-way write to Google Calendar (SSRF-guarded connector) | **UNSURFACED** | **FIXED THIS SESSION** — "Push event" inline form per push/two-way account |
| `calendar-share`/`shares-list`/`unshare` | per-calendar sharing + permissions | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `calendar-dashboard-summary` | live snapshot: calendars, events today/this-week, open/overdue/unblocked tasks | **UNSURFACED** | **FIXED THIS SESSION** — new "Dashboard" tab |
| `conference-generate`/`clear` | video-conference link generation | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `invites-send`/`list`, `invite-rsvp`/`revoke` | guest invites + RSVP | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `reminders-due`/`acknowledge` | reminders that actually fire | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `status-event-create`/`status-events-list` | working-location / OOO status events | DESIGNED (`CalendarParityHub.tsx`) | DESIGNED |
| `ical-export`/`ical-parse` | RFC 5545 import/export | DESIGNED (`TimezoneTools.tsx`, `EventActionRail.tsx`) | DESIGNED |
| `timezone-convert` | timezone conversion | DESIGNED (`TimezoneTools.tsx`) | DESIGNED |
| `detectConflicts`/`findAvailability`/`expandRecurring`/`scheduleOptimize` | tier-A scratch-pad calculators | DESIGNED (`ScheduleAnalyzer.tsx`) | DESIGNED |

**46 of 51 macros are DESIGNED.** 0 macros remain unsurfaced — all 5 real
gaps found this session (`calendars-delete`, `conflicts-check`,
`availability-find`, `calendar-dashboard-summary`, `accounts-push-event`)
are fixed.

## 1.5 Reference-parity checklist

**(a) Reference apps:** [Google Calendar](https://calendar.google.com)
(the explicit "2026 feature-parity" target named in `CalendarParityHub`'s
own header comment) and [Calendly](https://calendly.com) (appointment
booking pages). Both named directly in the codebase's own comments.

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Month/week/day calendar grid with event creation | ALREADY REAL | `GCalSection.tsx` |
| 2 | Recurring events (RRULE-lite) | ALREADY REAL | `events-create` + `expandOccurrences` |
| 3 | Tasks with time-blocking + AI auto-schedule | ALREADY REAL | `tasks-*`, `ai-auto-schedule` |
| 4 | Delete a calendar (not just create/rename) | **GENUINELY MISSING → FIXED THIS SESSION** | No delete control existed anywhere despite a real, safe (`isDefault` guard, cascades events) `calendars-delete` macro |
| 5 | Conflict detection against my real saved schedule | **GENUINELY MISSING → FIXED THIS SESSION** | The only conflict-check surfaced (`detectConflicts`) operated on ad-hoc pasted events, not the user's actual calendar; the real STATE-backed `conflicts-check` sat unused |
| 6 | Find-a-free-slot against my real saved schedule | **GENUINELY MISSING → FIXED THIS SESSION** | Same gap, mirrored for `availability-find` |
| 7 | An at-a-glance dashboard (today/this-week counts, open/overdue tasks) | **GENUINELY MISSING → FIXED THIS SESSION** | `calendar-dashboard-summary` was fully computed server-side and unused |
| 8 | Real two-way sync — push a local event to Google, not just pull | **GENUINELY MISSING → FIXED THIS SESSION** | `accounts-pull-events` (read) was wired; `accounts-push-event` (write) — the harder, more valuable half of "two-way" — had no UI |
| 9 | Calendar sharing + permissions, reminders, OOO status, conferencing, guest RSVP | ALREADY REAL | `CalendarParityHub.tsx`'s 6 original tabs |
| 10 | iCalendar import/export interop with Apple/Outlook | ALREADY REAL | `ical-export`/`ical-parse` |
| 11 | The generic "analyze/generate/suggest" action bar every lens gets for free does not sit disconnected among this real depth | **GENUINE DEFECT → FIXED THIS SESSION** | See below |
| 12 | Real-time insight panel is actually reachable, not accidentally hidden | **GENUINE DEFECT → FIXED THIS SESSION** | See below |

**Coverage summary:** 6 of 12 checklist items already real, 6 fixed this
session (5 unsurfaced-macro gaps + 1 structural scaffold/layout defect
class, described below). No remaining checklist gaps.

## 2. What this rebuild changed

**Removed `<UniversalActions>`.** The generic three-verb
(analyze/generate/suggest) action bar was mounted once on the page
(`artifactId={null}`, so it operated against nothing in particular) amid
an already-massive real feature set (`GCalSection`, `CalendarParityHub`,
`AppointmentSchedules`, `TimezoneTools`, `ScheduleAnalyzer`,
`CalendarActionPanel`) — pure redundant generic scaffold. Removed.

**Fixed a real-time panel hidden inside an unrelated modal.** The
real-time insights panel (`RealtimeDataPanel`, sourced from
`useRealtimeLens('calendar')`) was nested inside the "Quick-book session"
modal's JSX, meaning it only rendered while that unrelated booking modal
happened to be open — the rest of the time, live calendar insights were
invisible. Moved it to the page's top-level flow so it renders whenever
`realtimeData` is present, independent of any modal state.

**Wired the 5 unsurfaced macros**, all in `CalendarParityHub.tsx` +
`GCalSection.tsx` (the lens's existing real-engine surfaces, not new
parallel systems):
- `calendars-delete` — a delete button next to each non-default calendar
  in `GCalSection`'s sidebar list.
- `calendar-dashboard-summary` — a new "Dashboard" tab in
  `CalendarParityHub` (now the default tab) showing calendars/events-
  today/events-this-week/open-tasks/overdue-tasks/unblocked-tasks as live
  stat tiles.
- `conflicts-check` + `availability-find` — a new "Conflicts &
  Availability" tab in `CalendarParityHub`, explicitly distinguished in
  its own header comment from the tier-A scratch-pad calculators in
  `ScheduleAnalyzer` (which operate on pasted events, not the real
  calendar).
- `accounts-push-event` — an inline "Push event" mini-form appearing next
  to any connected Google account whose sync direction is `push` or
  `two-way`, in `CalendarParityHub`'s Account Sync tab.

**Left as-is, documented rather than merged:** the main month/week/day
grid persists events through a separate, real, generic artifact-CRUD store
(`useLensData<CalendarEvent>('calendar', 'event', ...)`) rather than the
domain's STATE-backed `events-*` macros used by `GCalSection`. This is a
genuinely distinct "content/release calendar" concept (fields like
`eventType: 'release'`, `platforms`, `collaborators`, `linkedProject`
target a creator's release-planning use case) with real, persisted data —
not fabricated content (`generateInitialEvents` returns `[]`, an honest
empty fallback, never seed/demo events). It is architecturally disconnected
from the general scheduling engine below it (an event created in the main
grid doesn't participate in Google sync, conflict checks, or availability
search), which is a real seam worth unifying in a future pass, but
merging two independent, real, working data models is a larger
architectural change than this session's scope — named honestly here
rather than silently left undocumented.

## Files touched

- `concord-frontend/app/lenses/calendar/page.tsx` — removed
  `<UniversalActions>`, relocated the real-time panel out of the booking
  modal
- `concord-frontend/components/calendar/GCalSection.tsx` — wired
  `calendars-delete`
- `concord-frontend/components/calendar/CalendarParityHub.tsx` — added
  Dashboard tab (`calendar-dashboard-summary`), Conflicts & Availability
  tab (`conflicts-check`/`availability-find`), and push-event wiring
  (`accounts-push-event`) in the Account Sync tab
- No backend changes — `server/domains/calendar.js` was already complete
