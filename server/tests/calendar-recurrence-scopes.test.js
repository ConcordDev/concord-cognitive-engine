// Calendar recurrence engine: weekday rules, nth-weekday months, skipped
// month-ends, and Google-style "this / following / all" edits and deletes.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);
const list = (from, to) => call("events-list", { rangeStart: from, rangeEnd: to }).result.events;
const days = (evs) => evs.map((e) => e.occurrenceStart.slice(0, 10));

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("recurrence rules", () => {
  it("weekly on Mon/Wed/Fri", () => {
    call("events-create", { title: "Gym", start: "2026-10-05T07:00:00.000Z", end: "2026-10-05T08:00:00.000Z", recurrence: { freq: "weekly", byDay: ["MO", "WE", "FR"] } });
    assert.deepEqual(days(list("2026-10-01", "2026-10-12T23:00:00Z")), ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"]);
  });

  it("monthly on the 31st skips months without one (no roll-over into the next month)", () => {
    call("events-create", { title: "Close books", start: "2026-01-31T15:00:00.000Z", recurrence: { freq: "monthly" } });
    assert.deepEqual(days(list("2026-01-01", "2026-06-30")), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("monthly on the 3rd Tuesday, and on the last Friday", () => {
    call("events-create", { title: "Board", start: "2026-10-20T18:00:00.000Z", recurrence: { freq: "monthly", monthlyMode: "nthWeekday" } });
    call("events-create", { title: "Payday", start: "2026-10-30T12:00:00.000Z", recurrence: { freq: "monthly", monthlyMode: "nthWeekday", lastWeek: true } });
    const evs = list("2026-10-01", "2027-01-31");
    assert.deepEqual(days(evs.filter((e) => e.title === "Board")), ["2026-10-20", "2026-11-17", "2026-12-15", "2027-01-19"]);
    assert.deepEqual(days(evs.filter((e) => e.title === "Payday")), ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"]);
  });

  it("count limits the series and until is inclusive of that day", () => {
    call("events-create", { title: "Course", start: "2026-10-05T09:00:00.000Z", recurrence: { freq: "daily", count: 3 } });
    call("events-create", { title: "Sprint", start: "2026-10-05T10:00:00.000Z", recurrence: { freq: "weekly", until: "2026-10-19" } });
    const evs = list("2026-10-01", "2026-12-01");
    assert.equal(evs.filter((e) => e.title === "Course").length, 3);
    assert.deepEqual(days(evs.filter((e) => e.title === "Sprint")), ["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
});

describe("scoped edits and deletes", () => {
  const make = () => call("events-create", { title: "Standup", start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T14:15:00.000Z", recurrence: { freq: "daily" } }).result.event;

  it("edit 'this' changes one occurrence only", () => {
    const e = make();
    const r = call("events-update", { id: e.id, scope: "this", occurrenceKey: "2026-10-07T14:00:00.000Z", title: "Standup (demo day)", start: "2026-10-07T16:00:00.000Z", end: "2026-10-07T16:30:00.000Z" });
    assert.equal(r.ok, true);
    const evs = list("2026-10-05", "2026-10-08T23:00:00Z");
    assert.deepEqual(evs.map((x) => x.title), ["Standup", "Standup", "Standup (demo day)", "Standup"]);
    const moved = evs[2];
    assert.equal(moved.occurrenceStart, "2026-10-07T16:00:00.000Z");
    assert.equal(moved.isException, true);
  });

  it("edit 'following' splits the series", () => {
    const e = make();
    call("events-update", { id: e.id, scope: "following", occurrenceKey: "2026-10-08T14:00:00.000Z", title: "Standup v2" });
    const evs = list("2026-10-05", "2026-10-10T23:00:00Z");
    assert.deepEqual(evs.map((x) => x.title), ["Standup", "Standup", "Standup", "Standup v2", "Standup v2", "Standup v2"]);
  });

  it("delete 'this' skips one date; 'following' ends the series; 'all' removes it", () => {
    const e = make();
    call("events-delete", { id: e.id, scope: "this", occurrenceKey: "2026-10-06T14:00:00.000Z" });
    assert.deepEqual(days(list("2026-10-05", "2026-10-07T23:00:00Z")), ["2026-10-05", "2026-10-07"]);
    call("events-delete", { id: e.id, scope: "following", occurrenceKey: "2026-10-07T14:00:00.000Z" });
    assert.deepEqual(days(list("2026-10-05", "2026-10-20")), ["2026-10-05"]);
    call("events-delete", { id: e.id });
    assert.equal(list("2026-10-01", "2026-10-20").length, 0);
  });

  it("refuses a single-occurrence change without an occurrence", () => {
    const e = make();
    assert.equal(call("events-update", { id: e.id, scope: "this", title: "x" }).ok, false);
    assert.equal(call("events-delete", { id: e.id, scope: "this" }).ok, false);
  });

  it("changing the rule keeps existing exceptions", () => {
    const e = make();
    call("events-delete", { id: e.id, scope: "this", occurrenceKey: "2026-10-06T14:00:00.000Z" });
    call("events-update", { id: e.id, recurrence: { freq: "daily", interval: 1, count: 4 } });
    assert.deepEqual(days(list("2026-10-01", "2026-10-31")), ["2026-10-05", "2026-10-07", "2026-10-08"]);
  });
});

describe("author time zone", () => {
  it("a Tuesday 8pm New York event repeats on Tuesdays, not on the UTC Wednesday", () => {
    // 2026-10-06 20:00 EDT = 2026-10-07T00:00Z (a Wednesday in UTC)
    call("events-create", { title: "Book club", start: "2026-10-07T00:00:00.000Z", end: "2026-10-07T01:00:00.000Z", recurrence: { freq: "weekly", byDay: ["TU"], tzOffset: 240 } });
    const evs = list("2026-10-01", "2026-10-22");
    assert.deepEqual(evs.map((e) => e.occurrenceStart), ["2026-10-07T00:00:00.000Z", "2026-10-14T00:00:00.000Z", "2026-10-21T00:00:00.000Z"]);
  });
});
