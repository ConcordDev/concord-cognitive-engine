// Scheduler bench server contract (S9 / F9): the bench runs on
// ai-auto-schedule over the real store. Its work window takes the
// caller's zone like availability-find does — 9 AM must mean 9 AM
// where the user is, not 09:00Z.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

beforeEach(() => {
  globalThis._concordSTATE = {};
  call("tasks-create", { title: "Write report", estimateMin: 30, priority: "high" });
});

describe("ai-auto-schedule", () => {
  it("places the task at 9 AM in the caller's zone (13:00Z in EDT), not 09:00Z", () => {
    const r = call("ai-auto-schedule", { day: "2026-10-28", tz: "America/New_York" });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheduledCount, 1);
    assert.equal(r.result.proposals[0].proposedStart, "2026-10-28T13:00:00.000Z");
    assert.equal(r.result.tz, "America/New_York");
  });

  it("without a zone, the legacy UTC window stands", () => {
    const r = call("ai-auto-schedule", { day: "2026-10-28" });
    assert.equal(r.result.proposals[0].proposedStart, "2026-10-28T09:00:00.000Z");
    assert.equal(r.result.tz, "UTC");
  });

  it("a busy block at 9 AM in the zone pushes the proposal past it", () => {
    call("events-create", { title: "Standup", start: "2026-10-28T13:00:00.000Z", end: "2026-10-28T14:00:00.000Z", tz: "America/New_York" });
    const r = call("ai-auto-schedule", { day: "2026-10-28", tz: "America/New_York" });
    assert.equal(r.result.proposals[0].proposedStart, "2026-10-28T14:00:00.000Z");
  });
});
