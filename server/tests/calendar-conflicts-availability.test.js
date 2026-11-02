// One conflict truth (S2 / F2): every surface reads conflicts-check over
// the real store. Pairwise mode powers the standalone analyzer; the
// tz-aware availability window powers the free-slot offers.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

beforeEach(() => {
  globalThis._concordSTATE = {};
  call("events-create", { title: "Alpha", start: "2026-10-28T14:00:00.000Z", end: "2026-10-28T15:00:00.000Z" });
  call("events-create", { title: "Beta", start: "2026-10-28T14:30:00.000Z", end: "2026-10-28T15:30:00.000Z" });
  call("events-create", { title: "Gamma", start: "2026-10-28T16:00:00.000Z", end: "2026-10-28T17:00:00.000Z" });
});

describe("conflicts-check", () => {
  it("names the conflicting event for a proposed window, honouring excludeEventId", () => {
    const beta = call("events-list", { rangeStart: "2026-10-28", rangeEnd: "2026-10-29" }).result.events.find((e) => e.title === "Beta");
    const r = call("conflicts-check", { start: "2026-10-28T14:30:00.000Z", end: "2026-10-28T15:30:00.000Z", excludeEventId: beta.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.conflicts.map((c) => c.title), ["Alpha"]);
  });

  it("pairwise mode reports the one overlapping pair with its overlap", () => {
    const r = call("conflicts-check", { start: "2026-10-28T00:00:00.000Z", end: "2026-10-28T23:59:59.000Z", pairwise: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.pairs.length, 1);
    const pair = r.result.pairs[0];
    assert.deepEqual([pair.a.title, pair.b.title], ["Alpha", "Beta"]);
    assert.equal(pair.overlapMinutes, 30);
  });

  it("without pairwise, no pairs field is added (existing callers unaffected)", () => {
    const r = call("conflicts-check", { start: "2026-10-28T14:30:00.000Z", end: "2026-10-28T15:30:00.000Z" });
    assert.equal(r.result.pairs, undefined);
    assert.equal(r.result.hasConflict, true);
  });
});

describe("availability-find", () => {
  it("computes the work window in the given zone, not UTC", () => {
    const r = call("availability-find", { day: "2026-10-28", durationMin: 30, workStartHour: 9, workEndHour: 18, tz: "America/New_York" });
    assert.equal(r.ok, true);
    // 9 AM–6 PM New York = 13:00Z–23:00Z. Busy: 14:00–15:30Z, 16:00–17:00Z.
    assert.deepEqual(r.result.freeSlots, [
      { start: "2026-10-28T13:00:00.000Z", end: "2026-10-28T14:00:00.000Z" },
      { start: "2026-10-28T15:30:00.000Z", end: "2026-10-28T16:00:00.000Z" },
      { start: "2026-10-28T17:00:00.000Z", end: "2026-10-28T22:00:00.000Z" },
    ]);
    assert.equal(r.result.tz, "America/New_York");
  });

  it("without a zone, the legacy UTC window stands", () => {
    const r = call("availability-find", { day: "2026-10-28", durationMin: 30, workStartHour: 9, workEndHour: 18 });
    assert.equal(r.result.freeSlots[0].start, "2026-10-28T09:00:00.000Z");
  });

  it("rejects a bogus zone back to the UTC window rather than failing", () => {
    const r = call("availability-find", { day: "2026-10-28", durationMin: 30, tz: "Not/AZone" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tz, "UTC");
  });
});
