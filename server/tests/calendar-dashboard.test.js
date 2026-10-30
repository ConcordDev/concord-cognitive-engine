// Dashboard truth (S7 / F7): the tiles must count the same store the
// grid shows, over the user's actual day and calendar week. The macro
// used to expand occurrences from NOW, so everything earlier today
// vanished from "Events today" (tiles read 0–2 against 3–4 real events).
//
// Seeds use explicit UTC instants on the zone's current calendar day:
// 10:00Z and 15:00Z fall on the same New York calendar day as their UTC
// date in both EDT and EST, so the assertions hold whenever they run.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

const TZ = "America/New_York";
function todayKeyIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

describe("calendar-dashboard-summary", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; });

  it("counts events from the START of today, not from now (the F7 undercount)", () => {
    const day = todayKeyIn(TZ);
    // 10:00Z = early morning New York — already past for most of the
    // day, invisible to the old from-now window, visible on the grid.
    call("events-create", { title: "Early standup", start: `${day}T10:00:00.000Z`, end: `${day}T11:00:00.000Z`, tz: TZ });
    call("events-create", { title: "Midday review", start: `${day}T15:00:00.000Z`, end: `${day}T16:00:00.000Z`, tz: TZ });
    call("events-create", { title: "Evening wrap", start: `${day}T23:30:00.000Z`, end: `${day}T23:59:00.000Z`, tz: TZ });
    const r = call("calendar-dashboard-summary", { tz: TZ });
    assert.equal(r.ok, true);
    assert.equal(r.result.eventsToday, 3);
    assert.ok(r.result.eventsThisWeek >= 3);
  });

  it("an event two weeks out is in neither tile; task/calendar counts stay real", () => {
    const start = new Date(Date.now() + 14 * 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    call("events-create", { title: "Far away", start: start.toISOString(), end: end.toISOString() });
    call("tasks-create", { title: "Write the thing" });
    const r = call("calendar-dashboard-summary", { tz: TZ });
    assert.equal(r.result.eventsToday, 0);
    assert.equal(r.result.eventsThisWeek, 0);
    assert.equal(r.result.openTasks, 1);
    assert.ok(r.result.calendarCount >= 1);
  });

  it("a recurring daily event counts once today and across the week", () => {
    const day = todayKeyIn(TZ);
    call("events-create", {
      title: "Daily standup", start: `${day}T14:00:00.000Z`, end: `${day}T14:30:00.000Z`, tz: TZ,
      recurrence: { freq: "daily", interval: 1 },
    });
    const r = call("calendar-dashboard-summary", { tz: TZ });
    assert.equal(r.result.eventsToday, 1);
    assert.ok(r.result.eventsThisWeek >= 1 && r.result.eventsThisWeek <= 7);
  });
});
