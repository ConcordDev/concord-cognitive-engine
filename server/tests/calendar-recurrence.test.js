// server/tests/calendar-recurrence.test.js
//
// Tier-2 contract tests for the minimal RRULE expander. Covers the
// RFC 5545 subset we ship: FREQ + INTERVAL + COUNT + UNTIL + BYDAY
// + BYMONTHDAY. No external dep.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRrule, expand } from "../lib/calendar/recurrence.js";

describe("parseRrule", () => {
  it("parses FREQ + INTERVAL + COUNT", () => {
    const r = parseRrule("FREQ=DAILY;INTERVAL=2;COUNT=5");
    assert.equal(r.freq, "DAILY");
    assert.equal(r.interval, 2);
    assert.equal(r.count, 5);
  });

  it("parses BYDAY array", () => {
    const r = parseRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    assert.deepEqual(r.byDay, ["MO","WE","FR"]);
  });

  it("parses UNTIL as Date", () => {
    const r = parseRrule("FREQ=DAILY;UNTIL=20260601T000000Z");
    assert.equal(r.until.getUTCFullYear(), 2026);
    assert.equal(r.until.getUTCMonth(), 5);
  });

  it("returns null for empty / invalid", () => {
    assert.equal(parseRrule(""), null);
    assert.equal(parseRrule("garbage=true"), null);
  });

  it("strips RRULE: prefix", () => {
    const r = parseRrule("RRULE:FREQ=WEEKLY");
    assert.equal(r.freq, "WEEKLY");
  });
});

describe("expand: DAILY", () => {
  it("FREQ=DAILY;COUNT=3 produces 3 instances 1 day apart", () => {
    const start = new Date("2026-01-01T09:00:00Z");
    const r = expand(start, "FREQ=DAILY;COUNT=3");
    assert.equal(r.ok, true);
    assert.equal(r.occurrences.length, 3);
    const days = r.occurrences.map((o) => new Date(o.start * 1000).toISOString().slice(0, 10));
    assert.deepEqual(days, ["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("INTERVAL=2 skips every other day", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "FREQ=DAILY;INTERVAL=2;COUNT=3");
    const days = r.occurrences.map((o) => new Date(o.start * 1000).toISOString().slice(0, 10));
    assert.deepEqual(days, ["2026-01-01", "2026-01-03", "2026-01-05"]);
  });

  it("UNTIL cuts off the series", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "FREQ=DAILY;UNTIL=20260103T235959Z");
    assert.equal(r.occurrences.length, 3);
  });
});

describe("expand: WEEKLY", () => {
  it("FREQ=WEEKLY;COUNT=4 produces 4 weekly instances", () => {
    const r = expand(new Date("2026-01-05T09:00:00Z"), "FREQ=WEEKLY;COUNT=4");
    assert.equal(r.occurrences.length, 4);
    const days = r.occurrences.map((o) => new Date(o.start * 1000).toISOString().slice(0, 10));
    assert.deepEqual(days, ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
  });

  it("BYDAY=MO,WE,FR expands the right weekdays", () => {
    const r = expand(new Date("2026-01-05T09:00:00Z"), "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=2");
    // Should produce at least Mon/Wed/Fri across at least 2 weeks
    assert.ok(r.occurrences.length >= 3);
    const weekdays = r.occurrences.map((o) => new Date(o.start * 1000).getUTCDay());
    for (const d of weekdays) assert.ok([1,3,5].includes(d), `day ${d} not in [Mon,Wed,Fri]`);
  });
});

describe("expand: MONTHLY", () => {
  it("FREQ=MONTHLY;COUNT=3 produces 3 monthly instances", () => {
    const r = expand(new Date("2026-01-15T09:00:00Z"), "FREQ=MONTHLY;COUNT=3");
    assert.equal(r.occurrences.length, 3);
    const months = r.occurrences.map((o) => new Date(o.start * 1000).getUTCMonth());
    assert.deepEqual(months, [0, 1, 2]);
  });

  it("BYMONTHDAY=15 fixes the day-of-month", () => {
    const r = expand(new Date("2026-01-15T09:00:00Z"), "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3");
    const days = r.occurrences.map((o) => new Date(o.start * 1000).getUTCDate());
    assert.ok(days.every((d) => d === 15));
  });
});

describe("expand: YEARLY", () => {
  it("FREQ=YEARLY;COUNT=3 produces 3 annual instances", () => {
    const r = expand(new Date("2026-01-15T09:00:00Z"), "FREQ=YEARLY;COUNT=3");
    assert.equal(r.occurrences.length, 3);
    const years = r.occurrences.map((o) => new Date(o.start * 1000).getUTCFullYear());
    assert.deepEqual(years, [2026, 2027, 2028]);
  });
});

describe("expand: safety + windows", () => {
  it("maxOccurrences caps the result", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "FREQ=DAILY", { maxOccurrences: 10 });
    assert.equal(r.occurrences.length, 10);
  });

  it("windowEnd bounds an unlimited rule", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "FREQ=DAILY", {
      windowEnd: new Date("2026-01-05T00:00:00Z"),
      maxOccurrences: 100,
    });
    assert.ok(r.occurrences.length <= 5);
  });

  it("rejects unsupported FREQ", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "FREQ=HOURLY;COUNT=5");
    assert.equal(r.ok, false);
    assert.ok(String(r.error).startsWith("unsupported_freq"));
  });

  it("rejects invalid rrule", () => {
    const r = expand(new Date("2026-01-01T09:00:00Z"), "garbage");
    assert.equal(r.ok, false);
  });
});
