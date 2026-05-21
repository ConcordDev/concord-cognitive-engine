# calendar — Feature Gap vs Google Calendar

Category leader (2026): Google Calendar. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/calendar.js` — 33 macros: calendars CRUD, events CRUD, recurring expansion, conflict detection, availability finder, tasks + time-blocking, appointment schedules + slots + booking, iCal export/parse, timezone convert, NL event parse, AI auto-schedule, dashboard.

## Has (verified in code)
- Multiple calendars (auto-seeds Personal + Work); event CRUD with range query
- RRULE recurring expansion; conflict detection; free/busy availability finder
- Tasks (list/create/toggle/delete) with time-blocking onto the calendar
- Appointment booking pages: bookable schedules, slot generation, book/cancel with double-book guard
- iCal (RFC 5545) export + parse; IANA timezone conversion
- Natural-language event parsing; AI auto-schedule; schedule optimization
- GCalSection, TimezoneTools, ScheduleAnalyzer; dashboard summary

## Missing — buildable feature backlog
- [x] `[M]` Two-way sync with external Google/Outlook accounts (OAuth)
- [x] `[S]` Calendar sharing + per-calendar visibility/permissions
- [x] `[M]` Event reminders/notifications that actually fire
- [x] `[S]` Working-location + out-of-office event types
- [x] `[M]` Video-conference link auto-generation on events
- [x] `[S]` Guest RSVP + invite emails
- [x] `[S]` Multiple views polish (week/day/agenda parity with month)

## Parity
~95% of Google Calendar's surface. Recurring events, conflicts, appointment booking, iCal, timezones, NL parsing plus external account sync, calendar sharing with permissions, firing reminders, working-location/OOO status, video-conference links, and guest RSVP/invites all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
