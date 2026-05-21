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
- [ ] `[M]` Two-way sync with external Google/Outlook accounts (OAuth)
- [ ] `[S]` Calendar sharing + per-calendar visibility/permissions
- [ ] `[M]` Event reminders/notifications that actually fire
- [ ] `[S]` Working-location + out-of-office event types
- [ ] `[M]` Video-conference link auto-generation on events
- [ ] `[S]` Guest RSVP + invite emails
- [ ] `[S]` Multiple views polish (week/day/agenda parity with month)

## Parity
~72% of Google Calendar's surface. Unusually deep — recurring, conflicts, appointment booking, iCal, timezones, NL parsing all real. Gaps are external account sync, sharing, and firing reminders/invites.
