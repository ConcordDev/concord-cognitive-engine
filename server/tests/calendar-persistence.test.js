// server/tests/calendar-persistence.test.js
//
// DB-level contract tests for the calendar substrate (migration 217).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createCalendar, getCalendar, listCalendarsForOwner, ensureDefaultCalendar,
  updateCalendar, deleteCalendar,
  createEvent, getEvent, updateEvent, softDeleteEvent, listEventsInRange, expandEvent,
  addAttendee, setRsvp, listAttendees, removeAttendee,
  addReminder, listReminders, pendingReminders, markReminderFired,
  setOverride,
} from "../lib/calendar/persistence.js";
import { detectConflicts, findAvailability, dayBounds } from "../lib/calendar/scheduling.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/217_calendar.js");
  m.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("calendar-persistence: calendars", () => {
  it("ensureDefaultCalendar creates Personal on first call, returns existing on second", () => {
    const a = ensureDefaultCalendar(db, "u_def");
    const b = ensureDefaultCalendar(db, "u_def");
    assert.ok(a?.id);
    assert.equal(a.id, b.id);
    assert.equal(a.kind, "personal");
  });

  it("createCalendar with custom kind/color round-trips", () => {
    const r = createCalendar(db, { ownerId: "u_c", name: "Work", kind: "work", color: "#ff0000" });
    assert.equal(r.ok, true);
    const cal = getCalendar(db, r.id);
    assert.equal(cal.kind, "work");
    assert.equal(cal.color, "#ff0000");
  });

  it("listCalendarsForOwner returns my calendars only", () => {
    createCalendar(db, { ownerId: "u_list", name: "A" });
    createCalendar(db, { ownerId: "u_list", name: "B" });
    createCalendar(db, { ownerId: "u_other", name: "Theirs" });
    const list = listCalendarsForOwner(db, "u_list");
    const names = list.map((c) => c.name);
    assert.ok(names.includes("A") && names.includes("B"));
    assert.ok(!names.includes("Theirs"));
  });

  it("updateCalendar patches color + visibility", () => {
    const c = createCalendar(db, { ownerId: "u_upd", name: "Tmp" });
    updateCalendar(db, c.id, { color: "#00ff00", visibility: "team" });
    const cal = getCalendar(db, c.id);
    assert.equal(cal.color, "#00ff00");
    assert.equal(cal.visibility, "team");
  });

  it("deleteCalendar gated by owner", () => {
    const c = createCalendar(db, { ownerId: "u_del", name: "Doomed" });
    const denied = deleteCalendar(db, c.id, "u_other");
    assert.equal(denied.ok, false); assert.equal(denied.reason, "forbidden");
    const okR = deleteCalendar(db, c.id, "u_del");
    assert.equal(okR.ok, true);
  });
});

describe("calendar-persistence: events", () => {
  let calId;
  before(() => {
    calId = createCalendar(db, { ownerId: "u_evt", name: "Events test" }).id;
  });

  it("createEvent persists + getEvent round-trips", () => {
    const startAt = Math.floor(Date.UTC(2026, 1, 1, 10, 0, 0) / 1000);
    const r = createEvent(db, {
      calendarId: calId, organizerId: "u_evt",
      title: "First event", startAt, endAt: startAt + 3600,
    });
    assert.equal(r.ok, true);
    const evt = getEvent(db, r.id);
    assert.equal(evt.title, "First event");
    assert.equal(evt.start_at, startAt);
  });

  it("rejects endAt before startAt", () => {
    const r = createEvent(db, {
      calendarId: calId, organizerId: "u_evt", title: "Bad",
      startAt: 100, endAt: 50,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "endAt_before_startAt");
  });

  it("updateEvent patches start_at + title", () => {
    const start = Math.floor(Date.UTC(2026, 1, 5, 14, 0, 0) / 1000);
    const r = createEvent(db, { calendarId: calId, organizerId: "u_evt", title: "Old", startAt: start, endAt: start + 1800 });
    updateEvent(db, r.id, { title: "New", startAt: start + 3600 });
    const evt = getEvent(db, r.id);
    assert.equal(evt.title, "New");
    assert.equal(evt.start_at, start + 3600);
  });

  it("softDeleteEvent removes from list but not from row count", () => {
    const r = createEvent(db, { calendarId: calId, organizerId: "u_evt", title: "Will die", startAt: 100, endAt: 200 });
    softDeleteEvent(db, r.id);
    assert.equal(getEvent(db, r.id), null);
  });

  it("listEventsInRange filters by window", () => {
    const cal = createCalendar(db, { ownerId: "u_win", name: "Win" }).id;
    const t0 = Math.floor(Date.UTC(2026, 2, 1) / 1000);
    createEvent(db, { calendarId: cal, organizerId: "u_win", title: "A", startAt: t0, endAt: t0 + 3600 });
    createEvent(db, { calendarId: cal, organizerId: "u_win", title: "B", startAt: t0 + 86400, endAt: t0 + 86400 + 3600 });
    createEvent(db, { calendarId: cal, organizerId: "u_win", title: "C", startAt: t0 + 7 * 86400, endAt: t0 + 7 * 86400 + 3600 });
    const list = listEventsInRange(db, { ownerId: "u_win", windowStartTs: t0 - 3600, windowEndTs: t0 + 2 * 86400 });
    const titles = list.map((e) => e.title).sort();
    assert.deepEqual(titles, ["A", "B"]);
  });
});

describe("calendar-persistence: recurring expansion via expandEvent", () => {
  it("expands DAILY rule into instances within window", () => {
    const calId = createCalendar(db, { ownerId: "u_rec", name: "Rec" }).id;
    const startAt = Math.floor(Date.UTC(2026, 3, 1, 9, 0, 0) / 1000);
    const r = createEvent(db, {
      calendarId: calId, organizerId: "u_rec", title: "Daily standup",
      startAt, endAt: startAt + 900, // 15 min
      rrule: "FREQ=DAILY;COUNT=5",
    });
    const event = getEvent(db, r.id);
    const expanded = expandEvent(db, event, {
      windowStartTs: startAt - 86400,
      windowEndTs: startAt + 10 * 86400,
    });
    assert.equal(expanded.length, 5);
    assert.ok(expanded.every((e) => e.is_recurring_instance));
  });

  it("applies overrides (cancellation skips an instance)", () => {
    const calId = createCalendar(db, { ownerId: "u_ov", name: "Ovr" }).id;
    const startAt = Math.floor(Date.UTC(2026, 4, 1, 9, 0, 0) / 1000);
    const r = createEvent(db, {
      calendarId: calId, organizerId: "u_ov", title: "Weekly",
      startAt, endAt: startAt + 1800,
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    // Cancel the 2nd instance
    setOverride(db, {
      parentEventId: r.id,
      originalStartAt: startAt + 7 * 86400,
      status: "cancelled",
      createdBy: "u_ov",
    });
    const event = getEvent(db, r.id);
    const expanded = expandEvent(db, event, {
      windowStartTs: startAt - 1,
      windowEndTs: startAt + 30 * 86400,
    });
    assert.equal(expanded.length, 3);
  });
});

describe("calendar-persistence: attendees + RSVP", () => {
  let evtId;
  before(() => {
    const cal = createCalendar(db, { ownerId: "u_att", name: "Attendees" }).id;
    evtId = createEvent(db, { calendarId: cal, organizerId: "u_att", title: "Meeting", startAt: 1000, endAt: 2000 }).id;
  });

  it("addAttendee accepts userId OR email", () => {
    const a = addAttendee(db, { eventId: evtId, userId: "u_alice", invitedBy: "u_att" });
    assert.equal(a.ok, true);
    const b = addAttendee(db, { eventId: evtId, email: "bob@external.com", name: "Bob", invitedBy: "u_att" });
    assert.equal(b.ok, true);
    const list = listAttendees(db, evtId);
    assert.equal(list.length, 2);
  });

  it("addAttendee requires userId OR email", () => {
    const r = addAttendee(db, { eventId: evtId, invitedBy: "u_att" });
    assert.equal(r.ok, false);
  });

  it("setRsvp updates an existing attendee's rsvp", () => {
    const ok = setRsvp(db, { eventId: evtId, userId: "u_alice", rsvp: "accepted" });
    assert.equal(ok.ok, true);
    const list = listAttendees(db, evtId);
    assert.equal(list.find((a) => a.user_id === "u_alice").rsvp, "accepted");
  });

  it("removeAttendee deletes by userId or email", () => {
    removeAttendee(db, { eventId: evtId, email: "bob@external.com" });
    const list = listAttendees(db, evtId);
    assert.ok(!list.find((a) => a.email === "bob@external.com"));
  });
});

describe("calendar-persistence: reminders", () => {
  it("addReminder precomputes fire_at from event.start_at - minutesBefore*60", () => {
    const cal = createCalendar(db, { ownerId: "u_rem", name: "Rem" }).id;
    const startAt = Math.floor(Date.now() / 1000) + 7200; // 2h from now
    const evt = createEvent(db, { calendarId: cal, organizerId: "u_rem", title: "Soon", startAt, endAt: startAt + 1800 });
    const r = addReminder(db, { eventId: evt.id, userId: "u_rem", minutesBefore: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.fireAt, startAt - 30 * 60);
  });

  it("pendingReminders surfaces only unfired, due reminders", () => {
    const cal = createCalendar(db, { ownerId: "u_pen", name: "Pen" }).id;
    const past = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const evt = createEvent(db, { calendarId: cal, organizerId: "u_pen", title: "Past", startAt: past, endAt: past + 1800 });
    addReminder(db, { eventId: evt.id, userId: "u_pen", minutesBefore: 15 });
    const pending = pendingReminders(db, "u_pen");
    assert.ok(pending.length >= 1);
    assert.equal(pending[0].title, "Past");
  });

  it("markReminderFired flips state", () => {
    const cal = createCalendar(db, { ownerId: "u_fired", name: "Fired" }).id;
    const evt = createEvent(db, { calendarId: cal, organizerId: "u_fired", title: "T", startAt: 100, endAt: 200 });
    const r = addReminder(db, { eventId: evt.id, userId: "u_fired", minutesBefore: 5 });
    assert.equal(markReminderFired(db, r.id), true);
    const after = pendingReminders(db, "u_fired");
    assert.ok(!after.find((x) => x.id === r.id));
  });
});

describe("scheduling: detectConflicts + findAvailability + dayBounds", () => {
  it("detectConflicts finds overlap pairs", () => {
    const events = [
      { id: "a", title: "A", startAt: 100, endAt: 200 },
      { id: "b", title: "B", startAt: 150, endAt: 250 },
      { id: "c", title: "C", startAt: 300, endAt: 400 },
    ];
    const r = detectConflicts(events);
    assert.equal(r.conflictCount, 1);
    assert.equal(r.conflicts[0].eventA.id, "a");
    assert.equal(r.conflicts[0].eventB.id, "b");
    assert.equal(r.conflicts[0].overlapMinutes, 1);
  });

  it("findAvailability returns free slots ≥ slotMinutes between events", () => {
    const dayStartTs = 1000;
    const dayEndTs = 1000 + 8 * 3600;          // 8h workday
    const events = [
      { startAt: 1000 + 3600, endAt: 1000 + 2 * 3600 },     // 1h busy block at hour 1-2
      { startAt: 1000 + 5 * 3600, endAt: 1000 + 6 * 3600 }, // 1h busy block at hour 5-6
    ];
    const r = findAvailability(events, { dayStartTs, dayEndTs, slotMinutes: 30 });
    assert.ok(r.slots.length >= 3); // before first, between, after second
    assert.ok(r.totalFreeMinutes > 0);
  });

  it("dayBounds maps YYYY-MM-DD + working hours into UTC seconds", () => {
    const b = dayBounds("2026-06-15", 9, 17);
    assert.ok(b.dayStartTs > 0);
    assert.equal(b.dayEndTs - b.dayStartTs, 8 * 3600);
  });
});
