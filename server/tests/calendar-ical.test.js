// server/tests/calendar-ical.test.js
//
// RFC 5545 round-trip tests for the iCal export/import path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventsToIcs, parseIcs, icsEscape, icsUnescape, foldIcsLine, icsUtc } from "../lib/calendar/ical.js";

describe("ics helpers", () => {
  it("icsEscape preserves text + escapes special chars", () => {
    assert.equal(icsEscape("hello\nworld"), "hello\\nworld");
    assert.equal(icsEscape("a;b,c\\d"), "a\\;b\\,c\\\\d");
  });

  it("icsUnescape is the inverse of icsEscape", () => {
    const s = "Title with ; comma, and\nnewline\\backslash";
    assert.equal(icsUnescape(icsEscape(s)), s);
  });

  it("foldIcsLine wraps lines longer than 75 octets", () => {
    const line = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldIcsLine(line);
    assert.ok(folded.includes("\r\n "), "should insert CRLF + space continuations");
    for (const segment of folded.split("\r\n")) {
      assert.ok(segment.length <= 75);
    }
  });

  it("icsUtc formats Date as YYYYMMDDTHHMMSSZ", () => {
    const d = new Date(Date.UTC(2026, 0, 15, 14, 30, 0));
    assert.equal(icsUtc(d), "20260115T143000Z");
  });
});

describe("eventsToIcs", () => {
  it("emits a valid VCALENDAR with VEVENT children", () => {
    const events = [{
      id: "evt:1", title: "Sprint review",
      startAt: Math.floor(Date.UTC(2026, 0, 20, 10, 0, 0) / 1000),
      endAt: Math.floor(Date.UTC(2026, 0, 20, 11, 0, 0) / 1000),
    }];
    const r = eventsToIcs(events, { calendarName: "Test cal", tz: "America/Los_Angeles" });
    assert.ok(r.ics.startsWith("BEGIN:VCALENDAR"));
    assert.ok(r.ics.includes("BEGIN:VEVENT"));
    assert.ok(r.ics.includes("SUMMARY:Sprint review"));
    assert.ok(r.ics.includes("DTSTART:20260120T100000Z"));
    assert.ok(r.ics.includes("DTEND:20260120T110000Z"));
    assert.ok(r.ics.includes("X-WR-CALNAME:Test cal"));
    assert.equal(r.eventCount, 1);
  });

  it("emits VALUE=DATE for all-day events", () => {
    const r = eventsToIcs([{
      id: "evt:2", title: "Holiday", allDay: true,
      startAt: Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000),
      endAt: Math.floor(Date.UTC(2026, 0, 2, 0, 0, 0) / 1000),
    }]);
    assert.ok(r.ics.includes("DTSTART;VALUE=DATE:20260101"));
  });

  it("includes RRULE when present", () => {
    const r = eventsToIcs([{
      id: "evt:3", title: "Standup",
      startAt: Math.floor(Date.UTC(2026, 0, 5, 9, 0, 0) / 1000),
      endAt: Math.floor(Date.UTC(2026, 0, 5, 9, 15, 0) / 1000),
      rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
    }]);
    assert.ok(r.ics.includes("RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR"));
  });

  it("attaches ORGANIZER + ATTENDEE lines", () => {
    const r = eventsToIcs([{
      id: "evt:4", title: "1-1",
      startAt: Math.floor(Date.UTC(2026, 0, 5, 14, 0, 0) / 1000),
      endAt: Math.floor(Date.UTC(2026, 0, 5, 14, 30, 0) / 1000),
      organizerEmail: "boss@co.com",
      attendeeEmails: ["alice@co.com", "bob@co.com"],
    }]);
    assert.ok(r.ics.includes("ORGANIZER:mailto:boss@co.com"));
    assert.ok(r.ics.includes("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:alice@co.com"));
    assert.ok(r.ics.includes("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bob@co.com"));
  });
});

describe("parseIcs", () => {
  it("rejects non-VCALENDAR input", () => {
    const r = parseIcs("hello world");
    assert.equal(r.ok, false);
  });

  it("round-trips a single event through emit + parse", () => {
    const startAt = Math.floor(Date.UTC(2026, 0, 20, 10, 0, 0) / 1000);
    const endAt = startAt + 3600;
    const emit = eventsToIcs([{
      id: "evt:rt", title: "Round-trip",
      description: "A description with; semicolon",
      location: "Concord HQ",
      startAt, endAt,
    }]);
    const parsed = parseIcs(emit.ics);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0].summary, "Round-trip");
    assert.equal(parsed.events[0].description, "A description with; semicolon");
    assert.equal(parsed.events[0].location, "Concord HQ");
    assert.ok(parsed.events[0].start.startsWith("2026-01-20T10:00"));
  });

  it("handles line unfolding (CRLF + space continuation)", () => {
    const longDesc = "x".repeat(200);
    const emit = eventsToIcs([{
      id: "evt:long", title: "Long desc", description: longDesc,
      startAt: Math.floor(Date.UTC(2026, 0, 5, 9, 0, 0) / 1000),
      endAt: Math.floor(Date.UTC(2026, 0, 5, 10, 0, 0) / 1000),
    }]);
    const parsed = parseIcs(emit.ics);
    assert.equal(parsed.events[0].description, longDesc);
  });

  it("extracts X-WR-CALNAME + X-WR-TIMEZONE", () => {
    const emit = eventsToIcs([{ id: "x", title: "x", startAt: 1, endAt: 2 }], { calendarName: "Meta", tz: "UTC" });
    const parsed = parseIcs(emit.ics);
    assert.equal(parsed.calendarName, "Meta");
    assert.equal(parsed.timezone, "UTC");
  });
});
