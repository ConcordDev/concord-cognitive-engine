// Calendar time zones (S1 / F1 — one true time): an event stores a true
// UTC instant plus the IANA zone it was authored in; recurrence expansion
// converts each occurrence's wall time with the offset in force on that
// date, so a series holds its wall clock across DST changes.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);
const list = (from, to) => call("events-list", { rangeStart: from, rangeEnd: to }).result.events;

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("event zone storage", () => {
  it("stores the authored zone and mirrors it onto the recurrence rule", () => {
    const r = call("events-create", {
      title: "Design review", start: "2026-10-28T18:00:00.000Z", end: "2026-10-28T19:00:00.000Z",
      tz: "America/New_York", recurrence: { freq: "weekly" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.tz, "America/New_York");
    assert.equal(r.result.event.recurrence.tz, "America/New_York");
    assert.equal(r.result.event.start, "2026-10-28T18:00:00.000Z"); // 2 PM EDT as a true instant
  });

  it("drops a bogus zone instead of storing it", () => {
    const r = call("events-create", { title: "X", start: "2026-10-28T18:00:00.000Z", tz: "Not/AZone" });
    assert.equal(r.result.event.tz, null);
    const bad = call("events-create", {
      title: "Y", start: "2026-10-28T18:00:00.000Z", recurrence: { freq: "weekly", tz: "Not/AZone" },
    });
    assert.equal(bad.result.event.recurrence.tz, null);
  });
});

describe("zone-aware expansion", () => {
  it("weekly 2 PM New York holds 2 PM wall clock across the Nov 1 DST change", () => {
    call("events-create", {
      title: "Standup", start: "2026-10-28T18:00:00.000Z", end: "2026-10-28T18:30:00.000Z",
      tz: "America/New_York", recurrence: { freq: "weekly" },
    });
    const occ = list("2026-10-26", "2026-11-16").filter((e) => e.title === "Standup");
    assert.deepEqual(occ.map((o) => o.occurrenceStart), [
      "2026-10-28T18:00:00.000Z", // EDT (UTC-4)
      "2026-11-04T19:00:00.000Z", // EST (UTC-5) — same wall clock
      "2026-11-11T19:00:00.000Z",
    ]);
  });

  it("London series crosses the end of BST without drifting", () => {
    call("events-create", {
      title: "London sync", start: "2026-10-21T13:00:00.000Z", end: "2026-10-21T14:00:00.000Z",
      recurrence: { freq: "weekly", tz: "Europe/London" },
    });
    const occ = list("2026-10-19", "2026-11-09").filter((e) => e.title === "London sync");
    assert.deepEqual(occ.map((o) => o.occurrenceStart), [
      "2026-10-21T13:00:00.000Z", // 14:00 BST
      "2026-10-28T14:00:00.000Z", // 14:00 GMT
      "2026-11-04T14:00:00.000Z",
    ]);
  });

  it("date-only until is the wall date in the event zone, inclusive", () => {
    call("events-create", {
      title: "Course", start: "2026-10-28T18:00:00.000Z", end: "2026-10-28T19:00:00.000Z",
      tz: "America/New_York", recurrence: { freq: "weekly", until: "2026-11-11" },
    });
    const occ = list("2026-10-01", "2026-12-31").filter((e) => e.title === "Course");
    assert.deepEqual(occ.map((o) => o.occurrenceStart), [
      "2026-10-28T18:00:00.000Z",
      "2026-11-04T19:00:00.000Z",
      "2026-11-11T19:00:00.000Z",
    ]);
  });

  it("legacy rules without a zone keep the fixed-offset behaviour", () => {
    call("events-create", {
      title: "Legacy", start: "2026-10-28T18:00:00.000Z", end: "2026-10-28T19:00:00.000Z",
      recurrence: { freq: "weekly", tzOffset: 240 },
    });
    const occ = list("2026-10-01", "2026-11-15").filter((e) => e.title === "Legacy");
    assert.deepEqual(occ.map((o) => o.occurrenceStart), [
      "2026-10-28T18:00:00.000Z",
      "2026-11-04T18:00:00.000Z",
      "2026-11-11T18:00:00.000Z",
    ]);
  });
});

describe("timezone-convert", () => {
  it("21:11 UTC renders 14:11 in Los Angeles", () => {
    const r = call("timezone-convert", { isoString: "2026-10-28T21:11:00.000Z", fromTz: "UTC", toTz: "America/Los_Angeles" });
    assert.equal(r.ok, true);
    assert.match(r.result.inToTz, /14:11/);
  });
});
