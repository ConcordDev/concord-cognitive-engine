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
