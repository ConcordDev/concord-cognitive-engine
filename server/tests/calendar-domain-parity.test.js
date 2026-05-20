// Contract tests for server/domains/calendar.js — pure-compute helpers
// plus RFC 5545 iCal interop + IANA timezone conversion.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCalendarActions from "../domains/calendar.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`calendar.${name}`);
  if (!fn) throw new Error(`calendar.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCalendarActions(register); });
beforeEach(() => { /* hermetic */ });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("calendar.detectConflicts", () => {
  it("flags overlapping events with overlap duration", () => {
    const events = [
      { name: "A", start: "2026-05-16T10:00:00Z", end: "2026-05-16T11:00:00Z" },
      { name: "B", start: "2026-05-16T10:30:00Z", end: "2026-05-16T11:30:00Z" },
    ];
    const r = call("detectConflicts", ctxA, { data: { events } }, {});
    assert.equal(r.result.conflictCount, 1);
    assert.equal(r.result.conflicts[0].overlapMinutes, 30);
  });

  it("conflictFree when no overlap", () => {
    const events = [
      { name: "A", start: "2026-05-16T10:00:00Z", end: "2026-05-16T11:00:00Z" },
      { name: "B", start: "2026-05-16T12:00:00Z", end: "2026-05-16T13:00:00Z" },
    ];
    const r = call("detectConflicts", ctxA, { data: { events } }, {});
    assert.equal(r.result.conflictFree, true);
  });
});

describe("calendar.ical-export (RFC 5545)", () => {
  it("rejects missing events", () => {
    const r = call("ical-export", ctxA, {}, {});
    assert.equal(r.ok, false);
  });

  it("generates valid VCALENDAR with VEVENT + DTSTART/DTEND/SUMMARY", () => {
    const events = [
      { uid: "abc-123@example.com", summary: "Team standup", start: "2026-05-16T15:00:00Z", end: "2026-05-16T15:30:00Z", location: "Zoom" },
    ];
    const r = call("ical-export", ctxA, { data: { events } }, { calendarName: "My Calendar" });
    assert.equal(r.ok, true);
    assert.match(r.result.ics, /BEGIN:VCALENDAR\r\n/);
    assert.match(r.result.ics, /VERSION:2\.0\r\n/);
    assert.match(r.result.ics, /X-WR-CALNAME:My Calendar\r\n/);
    assert.match(r.result.ics, /BEGIN:VEVENT\r\n/);
    assert.match(r.result.ics, /UID:abc-123@example\.com\r\n/);
    assert.match(r.result.ics, /DTSTART:20260516T150000Z\r\n/);
    assert.match(r.result.ics, /DTEND:20260516T153000Z\r\n/);
    assert.match(r.result.ics, /SUMMARY:Team standup\r\n/);
    assert.match(r.result.ics, /LOCATION:Zoom\r\n/);
    assert.match(r.result.ics, /END:VEVENT\r\n/);
    assert.match(r.result.ics, /END:VCALENDAR\r\n$/);
    assert.equal(r.result.eventCount, 1);
    assert.equal(r.result.spec, "RFC 5545");
  });

  it("escapes special characters per RFC 5545 §3.3.11", () => {
    const events = [{
      summary: "Lunch, then meeting; finally: gym",
      description: "Line 1\nLine 2",
      start: "2026-05-16T12:00:00Z",
    }];
    const r = call("ical-export", ctxA, { data: { events } }, {});
    // commas + semicolons escaped, newlines → \n
    assert.match(r.result.ics, /SUMMARY:Lunch\\, then meeting\\; finally:/);
    assert.match(r.result.ics, /DESCRIPTION:Line 1\\nLine 2/);
  });

  it("folds lines longer than 75 octets per RFC 5545 §3.1", () => {
    const longSummary = "A".repeat(200);
    const r = call("ical-export", ctxA, { data: { events: [{ summary: longSummary, start: "2026-05-16T10:00:00Z" }] } }, {});
    // After SUMMARY: marker, folded lines should begin with " "
    const summaryLine = r.result.ics.split("\r\n").filter((l) => l.startsWith("SUMMARY:") || l.startsWith(" A"));
    assert.ok(summaryLine.length >= 3); // initial + ≥2 fold continuations
  });

  it("adds attendees + organizer per RFC 5545", () => {
    const events = [{
      summary: "Sync", start: "2026-05-16T10:00:00Z",
      organizerEmail: "alice@example.com",
      attendeeEmails: ["bob@example.com", "carol@example.com"],
    }];
    const r = call("ical-export", ctxA, { data: { events } }, {});
    assert.match(r.result.ics, /ORGANIZER:mailto:alice@example\.com\r\n/);
    assert.match(r.result.ics, /ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bob@example\.com\r\n/);
    assert.match(r.result.ics, /ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:carol@example\.com\r\n/);
  });

  it("skips events with invalid start dates rather than aborting", () => {
    const events = [
      { summary: "Bad", start: "not-a-date" },
      { summary: "Good", start: "2026-05-16T10:00:00Z" },
    ];
    const r = call("ical-export", ctxA, { data: { events } }, {});
    assert.equal(r.result.eventCount, 1);
    assert.match(r.result.ics, /SUMMARY:Good\r\n/);
  });
});

describe("calendar.ical-parse (RFC 5545 round-trip)", () => {
  it("rejects non-VCALENDAR input", () => {
    assert.equal(call("ical-parse", ctxA, { ics: "not an ics" }).ok, false);
    assert.equal(call("ical-parse", ctxA, { ics: "" }).ok, false);
  });

  it("parses a valid VCALENDAR + extracts events", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "X-WR-CALNAME:Work",
      "X-WR-TIMEZONE:America/Los_Angeles",
      "BEGIN:VEVENT",
      "UID:evt-1@test",
      "DTSTAMP:20260516T100000Z",
      "DTSTART:20260516T150000Z",
      "DTEND:20260516T160000Z",
      "SUMMARY:Demo",
      "DESCRIPTION:Important call",
      "LOCATION:Conf Room A",
      "ORGANIZER:mailto:alice@example.com",
      "ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:bob@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = call("ical-parse", ctxA, { ics });
    assert.equal(r.ok, true);
    assert.equal(r.result.calendarName, "Work");
    assert.equal(r.result.timezone, "America/Los_Angeles");
    assert.equal(r.result.events.length, 1);
    const e = r.result.events[0];
    assert.equal(e.uid, "evt-1@test");
    assert.equal(e.summary, "Demo");
    assert.equal(e.description, "Important call");
    assert.equal(e.location, "Conf Room A");
    assert.equal(e.start, "2026-05-16T15:00:00Z");
    assert.equal(e.end, "2026-05-16T16:00:00Z");
    assert.equal(e.organizerEmail, "alice@example.com");
    assert.deepEqual(e.attendeeEmails, ["bob@example.com"]);
  });

  it("unfolds continuation lines (RFC 5545 §3.1)", () => {
    // Per RFC 5545: the leading SP/HT on the continuation line is the
    // FOLDING marker and is REMOVED during unfolding. The producer is
    // responsible for placing any space character in the original
    // content before the line break.
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260516T100000Z",
      "SUMMARY:This is a very long ",  // trailing space is content
      " summary that wraps",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = call("ical-parse", ctxA, { ics });
    assert.equal(r.result.events[0].summary, "This is a very long summary that wraps");
  });

  it("round-trip: export then parse preserves UID + SUMMARY + start/end", () => {
    const original = [{
      uid: "rt-test@concord", summary: "Round trip",
      start: "2026-05-16T15:00:00Z", end: "2026-05-16T16:00:00Z",
      location: "Concord HQ",
    }];
    const exported = call("ical-export", ctxA, { data: { events: original } }, {});
    const parsed = call("ical-parse", ctxA, { ics: exported.result.ics });
    assert.equal(parsed.result.events.length, 1);
    const e = parsed.result.events[0];
    assert.equal(e.uid, "rt-test@concord");
    assert.equal(e.summary, "Round trip");
    assert.equal(e.location, "Concord HQ");
    assert.equal(e.start, "2026-05-16T15:00:00Z");
    assert.equal(e.end, "2026-05-16T16:00:00Z");
  });
});

describe("calendar.timezone-convert (IANA via Intl.DateTimeFormat)", () => {
  it("rejects missing iso", () => {
    assert.equal(call("timezone-convert", ctxA, {}).ok, false);
  });

  it("rejects unknown IANA timezone", () => {
    const r = call("timezone-convert", ctxA, { isoString: "2026-05-16T15:00:00Z", fromTz: "UTC", toTz: "Mars/Olympus_Mons" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown IANA timezone/);
  });

  it("converts UTC → America/Los_Angeles correctly (May = PDT, UTC-7)", () => {
    const r = call("timezone-convert", ctxA, {
      isoString: "2026-05-16T15:00:00Z",
      fromTz: "UTC", toTz: "America/Los_Angeles",
    });
    assert.equal(r.ok, true);
    // 15:00 UTC = 08:00 PDT
    assert.match(r.result.inToTz, /08:00:00$/);
  });

  it("converts UTC → Asia/Tokyo correctly (JST = UTC+9)", () => {
    const r = call("timezone-convert", ctxA, {
      isoString: "2026-05-16T15:00:00Z",
      fromTz: "UTC", toTz: "Asia/Tokyo",
    });
    // 15:00 UTC = 00:00 next day JST
    assert.match(r.result.inToTz, /2026-05-17,? 00:00:00$/);
  });
});

// ═════════════════════════════════════════════════════════════════
//  Google Calendar + Notion Calendar + Fantastical 2026 parity —
//  multi-calendar events, recurrence, tasks, time blocking,
//  natural-language parse, availability, AI auto-schedule.
// ═════════════════════════════════════════════════════════════════

const ctxCal = { actor: { userId: "cal_u" }, userId: "cal_u" };

describe("calendar — 2026 parity macros", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("calendars-list auto-seeds Personal + Work", () => {
    const r = call("calendars-list", ctxCal);
    assert.equal(r.ok, true);
    assert.equal(r.result.calendars.length, 2);
    assert.ok(r.result.calendars.find(c => c.name === "Personal" && c.isDefault));
  });

  it("calendars-create + cannot delete default", () => {
    call("calendars-list", ctxCal);
    const c = call("calendars-create", ctxCal, { name: "Side projects" });
    assert.equal(c.ok, true);
    const def = call("calendars-list", ctxCal).result.calendars.find(x => x.isDefault);
    const del = call("calendars-delete", ctxCal, { id: def.id });
    assert.equal(del.ok, false);
    assert.match(del.error, /default/);
  });

  it("events-create + events-list within a range", () => {
    call("calendars-list", ctxCal);
    const ev = call("events-create", ctxCal, { title: "Standup", start: "2026-06-01T09:00:00Z", end: "2026-06-01T09:30:00Z" });
    assert.equal(ev.ok, true);
    assert.match(ev.result.event.number, /^EV-\d{6}$/);
    const list = call("events-list", ctxCal, { rangeStart: "2026-05-30T00:00:00Z", rangeEnd: "2026-06-05T00:00:00Z" });
    assert.equal(list.result.events.length, 1);
    assert.equal(list.result.events[0].occurrenceStart, "2026-06-01T09:00:00Z");
  });

  it("recurring weekly event expands to multiple occurrences", () => {
    call("calendars-list", ctxCal);
    call("events-create", ctxCal, {
      title: "Weekly sync", start: "2026-06-01T10:00:00Z", end: "2026-06-01T11:00:00Z",
      recurrence: { freq: "weekly", interval: 1, count: 4 },
    });
    const list = call("events-list", ctxCal, { rangeStart: "2026-06-01T00:00:00Z", rangeEnd: "2026-07-15T00:00:00Z" });
    assert.equal(list.result.events.length, 4);
  });

  it("conflicts-check flags an overlapping slot", () => {
    call("calendars-list", ctxCal);
    call("events-create", ctxCal, { title: "Busy", start: "2026-06-02T14:00:00Z", end: "2026-06-02T15:00:00Z" });
    const r = call("conflicts-check", ctxCal, { start: "2026-06-02T14:30:00Z", end: "2026-06-02T15:30:00Z" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasConflict, true);
    assert.equal(r.result.conflicts[0].title, "Busy");
  });

  it("availability-find returns free gaps around busy blocks", () => {
    call("calendars-list", ctxCal);
    call("events-create", ctxCal, { title: "Mtg", start: "2026-06-03T11:00:00Z", end: "2026-06-03T12:00:00Z" });
    const r = call("availability-find", ctxCal, { day: "2026-06-03", durationMin: 30, workStartHour: 9, workEndHour: 17 });
    assert.equal(r.ok, true);
    // expect a gap before 11:00 and after 12:00
    assert.ok(r.result.freeSlots.length >= 2);
  });

  it("tasks-create + time-block drops it onto the calendar", () => {
    call("calendars-list", ctxCal);
    const t = call("tasks-create", ctxCal, { title: "Write spec", estimateMin: 90, priority: "high" });
    assert.equal(t.ok, true);
    const tb = call("tasks-time-block", ctxCal, { taskId: t.result.task.id, start: "2026-06-04T13:00:00Z" });
    assert.equal(tb.ok, true);
    assert.equal(tb.result.event.title, "⏳ Write spec");
    // event end should be start + 90min
    assert.equal(tb.result.event.end, "2026-06-04T14:30:00.000Z");
    assert.equal(tb.result.task.blockedEventId, tb.result.event.id);
  });

  it("tasks-toggle flips status", () => {
    globalThis._concordSTATE = { dtus: new Map() };
    const t = call("tasks-create", ctxCal, { title: "X" }).result.task;
    assert.equal(call("tasks-toggle", ctxCal, { id: t.id }).result.task.status, "done");
    assert.equal(call("tasks-toggle", ctxCal, { id: t.id }).result.task.status, "todo");
  });

  it("nl-parse-event parses Fantastical-style text", () => {
    const r = call("nl-parse-event", ctxCal, { text: "Team standup every Monday at 9am on Google Meet for 30 min" });
    assert.equal(r.ok, true);
    assert.equal(r.result.parsed.recurrence.freq, "weekly");
    assert.equal(r.result.parsed.durationMin, 30);
    assert.match(r.result.parsed.title, /Team standup/i);
    // 9am → hour 9
    assert.equal(new Date(r.result.parsed.start).getHours(), 9);
  });

  it("nl-parse-event handles 'tomorrow at 2pm'", () => {
    const r = call("nl-parse-event", ctxCal, { text: "Dentist tomorrow at 2pm" });
    assert.equal(r.ok, true);
    assert.equal(new Date(r.result.parsed.start).getHours(), 14);
    assert.equal(r.result.parsed.recurrence, null);
  });

  it("ai-auto-schedule proposes slots for open tasks around events", () => {
    call("calendars-list", ctxCal);
    call("events-create", ctxCal, { title: "Lunch", start: "2026-06-10T12:00:00Z", end: "2026-06-10T13:00:00Z" });
    call("tasks-create", ctxCal, { title: "Deep work", estimateMin: 60, priority: "high" });
    call("tasks-create", ctxCal, { title: "Email", estimateMin: 30, priority: "low" });
    const r = call("ai-auto-schedule", ctxCal, { day: "2026-06-10", workStartHour: 9, workEndHour: 17 });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheduledCount, 2);
    // High priority first
    assert.equal(r.result.proposals[0].title, "Deep work");
    // No proposal should overlap the lunch event
    for (const p of r.result.proposals) {
      const ps = new Date(p.proposedStart).getTime(), pe = new Date(p.proposedEnd).getTime();
      const ls = new Date("2026-06-10T12:00:00Z").getTime(), le = new Date("2026-06-10T13:00:00Z").getTime();
      assert.ok(pe <= ls || ps >= le, "proposal must not overlap lunch");
    }
  });

  it("calendar-dashboard-summary aggregates events + tasks", () => {
    call("calendars-list", ctxCal);
    call("tasks-create", ctxCal, { title: "A" });
    const r = call("calendar-dashboard-summary", ctxCal);
    assert.equal(r.ok, true);
    assert.equal(r.result.calendarCount, 2);
    assert.equal(r.result.openTasks, 1);
  });

  it("appointment schedule create / list / delete", () => {
    const sc = call("appointment-schedule-create", ctxCal, { title: "Office hours", durationMin: 30, startHour: 9, endHour: 12 });
    assert.equal(sc.ok, true);
    assert.equal(sc.result.schedule.durationMin, 30);
    assert.equal(call("appointment-schedule-list", ctxCal).result.count, 1);
    assert.equal(call("appointment-schedule-delete", ctxCal, { id: sc.result.schedule.id }).ok, true);
    assert.equal(call("appointment-schedule-list", ctxCal).result.count, 0);
  });

  it("appointment-slots generates duration-stepped slots on available weekdays", () => {
    const sc = call("appointment-schedule-create", ctxCal, { title: "OH", durationMin: 30, startHour: 9, endHour: 11, weekdays: [1, 2, 3, 4, 5] }).result.schedule;
    // pick a far-future Monday
    const slots = call("appointment-slots", ctxCal, { scheduleId: sc.id, date: "2099-01-05" }); // Mon
    assert.equal(slots.ok, true);
    assert.equal(slots.result.slots.length, 4); // 9:00 9:30 10:00 10:30
    assert.ok(slots.result.slots.every(s => s.available));
    const weekend = call("appointment-slots", ctxCal, { scheduleId: sc.id, date: "2099-01-03" }); // Sat
    assert.equal(weekend.result.slots.length, 0);
  });

  it("appointment-book reserves a slot and blocks double-booking", () => {
    const sc = call("appointment-schedule-create", ctxCal, { title: "OH", durationMin: 30, startHour: 9, endHour: 11 }).result.schedule;
    const booked = call("appointment-book", ctxCal, { scheduleId: sc.id, slotStart: "2099-01-05T09:00:00", bookerName: "Dana" });
    assert.equal(booked.ok, true);
    assert.equal(call("appointment-book", ctxCal, { scheduleId: sc.id, slotStart: "2099-01-05T09:00:00", bookerName: "Other" }).ok, false);
    const slots = call("appointment-slots", ctxCal, { scheduleId: sc.id, date: "2099-01-05" });
    assert.equal(slots.result.slots.find(s => s.slotStart === "2099-01-05T09:00:00").available, false);
    assert.equal(call("appointment-bookings", ctxCal, { scheduleId: sc.id }).result.bookings.length, 1);
    assert.equal(call("appointment-cancel-booking", ctxCal, { scheduleId: sc.id, bookingId: booked.result.booking.id }).ok, true);
    assert.equal(call("appointment-bookings", ctxCal, { scheduleId: sc.id }).result.bookings.length, 0);
  });
});
