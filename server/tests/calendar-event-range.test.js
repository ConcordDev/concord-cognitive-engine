// INC-84: calendar events must not be creatable or editable into an
// inverted range (end at or before start). Downstream consumers —
// conflict checks, availability search, occurrence expansion — all
// assume a positive duration, so an inverted event silently poisoned
// each of them. All-day events may end at the instant they start
// (single-day); timed events may not.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-range-u1" }, userId: "cal-range-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);
const list = (from, to) => call("events-list", { rangeStart: from, rangeEnd: to }).result.events;

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("calendar event range validation (INC-84)", () => {
  it("events-create rejects an end before the start and stores nothing", () => {
    const r = call("events-create", { title: "Backwards", start: "2026-06-01T10:00:00Z", end: "2026-06-01T09:00:00Z" });
    assert.equal(r.ok, false);
    assert.match(r.error, /end must be after start/);
    assert.equal(list("2026-05-01", "2026-07-01").length, 0);
  });

  it("events-create rejects a zero-duration timed event", () => {
    const r = call("events-create", { title: "Instant", start: "2026-06-01T10:00:00Z", end: "2026-06-01T10:00:00Z" });
    assert.equal(r.ok, false);
    assert.match(r.error, /end must be after start/);
  });

  it("events-create allows a single-day all-day event (end == start)", () => {
    const r = call("events-create", { title: "Holiday", start: "2026-06-01T00:00:00Z", end: "2026-06-01T00:00:00Z", allDay: true });
    assert.equal(r.ok, true);
  });

  it("events-create still defaults a missing end to start + 1h", () => {
    const r = call("events-create", { title: "Defaulted", start: "2026-06-01T10:00:00Z" });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.end, "2026-06-01T11:00:00.000Z");
  });

  it("events-update rejects an inverting edit and leaves the stored event untouched", () => {
    const ev = call("events-create", { title: "Standup", start: "2026-06-02T09:00:00Z", end: "2026-06-02T09:30:00Z" }).result.event;
    const r = call("events-update", { id: ev.id, end: "2026-06-02T08:00:00Z" });
    assert.equal(r.ok, false);
    assert.match(r.error, /end must be after start/);
    const stored = list("2026-06-01", "2026-06-03")[0];
    assert.equal(stored.occurrenceEnd, "2026-06-02T09:30:00Z");
  });

  it("events-update still accepts a valid shortening", () => {
    const ev = call("events-create", { title: "Long", start: "2026-06-03T09:00:00Z", end: "2026-06-03T11:00:00Z" }).result.event;
    const r = call("events-update", { id: ev.id, end: "2026-06-03T10:00:00Z" });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.end, "2026-06-03T10:00:00Z");
  });

  it("a 'this'-scope override cannot invert a single occurrence", () => {
    const ev = call("events-create", {
      title: "Gym", start: "2026-10-05T07:00:00.000Z", end: "2026-10-05T08:00:00.000Z",
      recurrence: { freq: "weekly", byDay: ["MO", "WE", "FR"] },
    }).result.event;
    const r = call("events-update", {
      id: ev.id, scope: "this", occurrenceKey: "2026-10-07T07:00:00.000Z",
      start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T08:00:00.000Z",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /end must be after start/);
  });
});
