# calendar — Feature Completeness Spec

Rival app(s): Google Calendar, Notion Calendar (Cron) (2026)
Sources:
- https://calendar.google.com/ (events, multi-view, recurring, appointment schedules, working location, conflict detection)
- https://www.notion.so/product/calendar (Cron — keyboard-first scheduling, timezones, availability sharing)

## Features

### Calendars & events
- [x] Calendars — list (auto-seeds Personal + Work) / create / update / delete (macro: calendar.calendars-*)
- [x] Events — list (range query) / create / update / delete (macro: calendar.events-*)
- [x] Recurring expansion — RRULE-style expansion (macro: calendar.expandRecurring)
- [x] Conflict detection — overlap + duration (macro: calendar.detectConflicts / conflicts-check)
- [x] Availability finder — free/busy windows (macro: calendar.findAvailability / availability-find)

### Tasks
- [x] Tasks — list / create / toggle / delete (macro: calendar.tasks-*)
- [x] Time-block a task onto the calendar (macro: calendar.tasks-time-block)

### Appointment schedules (Google Calendar 2026 booking pages)
- [x] Create a bookable schedule — duration, weekdays, hours window (macro: calendar.appointment-schedule-create)
- [x] List / delete schedules (macro: calendar.appointment-schedule-list / appointment-schedule-delete)
- [x] Generate open slots for a date — duration-stepped, weekday-gated, past-time-excluded (macro: calendar.appointment-slots)
- [x] Book a slot — double-booking guarded (macro: calendar.appointment-book)
- [x] List + cancel bookings (macro: calendar.appointment-bookings / appointment-cancel-booking)

### Interop & intelligence
- [x] iCal export + parse — RFC 5545 (macro: calendar.ical-export / ical-parse)
- [x] Timezone conversion — IANA zones (macro: calendar.timezone-convert)
- [x] Schedule optimization (macro: calendar.scheduleOptimize)
- [x] Natural-language event parsing (macro: calendar.nl-parse-event)
- [x] AI auto-schedule (macro: calendar.ai-auto-schedule)
- [x] Dashboard summary — calendars / events-this-week / open + overdue tasks (macro: calendar.calendar-dashboard-summary)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Two-way sync with external Google/Outlook accounts | OAuth + provider APIs | iCal import/export round-trips the schedule; appointment schedules are publishable booking pages |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/calendar.js` clean. 33 macros
  (calendars/events + tasks + appointment schedules + interop/AI).
- 2026-05-20: Tests — `tests/calendar-domain-parity.test.js` 31/31 green
  (conflict detection / iCal interop / timezone / calendars+events+tasks /
  appointment schedule create-list-delete / slot generation weekday-gated /
  booking + double-book guard + cancel).
- 2026-05-20: Frontend — new `AppointmentSchedules` panel (create schedules,
  browse open slots by date, book + manage reservations) mounted in the
  calendar lens page. `npx tsc --noEmit` exit 0.
