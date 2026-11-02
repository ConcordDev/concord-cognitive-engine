// Calendar + task lifecycles (S3 / F3): the macros the Add buttons wire to.
// Create → appear → toggle → time-block → delete, with failure cases.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCalendarActions from "../domains/calendar.js";

const map = new Map();
registerCalendarActions((_d, n, fn) => map.set(n, fn));
const ctx = { actor: { userId: "cal-u1" }, userId: "cal-u1" };
const call = (n, p) => map.get(n)(ctx, { data: p }, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("calendar lifecycle", () => {
  it("create → listed with its colour → toggle hides → delete removes it and its events", () => {
    const created = call("calendars-create", { name: "Studio", color: "#34a853" });
    assert.equal(created.ok, true);
    const cal = created.result.calendar;
    assert.equal(cal.name, "Studio");
    assert.equal(cal.color, "#34a853");
    assert.equal(cal.isDefault, false);

    let list = call("calendars-list", {}).result.calendars;
    assert.ok(list.some((c) => c.id === cal.id), "new calendar appears in calendars-list");

    const upd = call("calendars-update", { id: cal.id, visible: false });
    assert.equal(upd.ok, true);
    list = call("calendars-list", {}).result.calendars;
    assert.equal(list.find((c) => c.id === cal.id).visible, false);

    call("events-create", { title: "Session", start: "2026-10-28T18:00:00.000Z", calendarId: cal.id });
    const del = call("calendars-delete", { id: cal.id });
    assert.equal(del.ok, true);
    list = call("calendars-list", {}).result.calendars;
    assert.ok(!list.some((c) => c.id === cal.id));
    const evs = call("events-list", { rangeStart: "2026-10-01", rangeEnd: "2026-11-30" }).result.events;
    assert.equal(evs.filter((e) => e.title === "Session").length, 0, "its events are removed with it");
  });

  it("rejects an empty name and protects the default calendar", () => {
    assert.equal(call("calendars-create", { name: "  " }).ok, false);
    const def = call("calendars-list", {}).result.calendars.find((c) => c.isDefault);
    assert.ok(def);
    const del = call("calendars-delete", { id: def.id });
    assert.equal(del.ok, false);
    assert.match(del.error, /default/);
  });
});

describe("task lifecycle", () => {
  it("create → toggle done → time-block lands on the calendar → delete", () => {
    const created = call("tasks-create", { title: "Mix the demo", estimateMin: 45, priority: "high" });
    assert.equal(created.ok, true);
    const task = created.result.task;
    assert.equal(task.status, "todo");
    assert.equal(task.estimateMin, 45);

    const listed = call("tasks-list", { status: "all" }).result.tasks;
    assert.ok(listed.some((t) => t.id === task.id));

    const blocked = call("tasks-time-block", { taskId: task.id, start: "2026-10-29T15:00:00.000Z" });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.result.event.end, "2026-10-29T15:45:00.000Z");
    assert.equal(blocked.result.task.blockedEventId, blocked.result.event.id);
    const evs = call("events-list", { rangeStart: "2026-10-29", rangeEnd: "2026-10-30" }).result.events;
    assert.ok(evs.some((e) => e.id === blocked.result.event.id), "the block is a real calendar event");

    const toggled = call("tasks-toggle", { id: task.id });
    assert.equal(toggled.result.task.status, "done");

    assert.equal(call("tasks-delete", { id: task.id }).ok, true);
    assert.ok(!call("tasks-list", { status: "all" }).result.tasks.some((t) => t.id === task.id));
  });

  it("rejects an empty title; time-block of a missing task fails honestly", () => {
    assert.equal(call("tasks-create", { title: "" }).ok, false);
    assert.equal(call("tasks-time-block", { taskId: "task_nope", start: "2026-10-29T15:00:00.000Z" }).ok, false);
  });

  it("AI auto-schedule proposes a placement for a real open task", () => {
    call("tasks-create", { title: "Write release notes", estimateMin: 30, priority: "high" });
    const r = call("ai-auto-schedule", { day: "2026-10-29" });
    assert.equal(r.ok, true);
    const proposals = r.result.proposals || r.result.placements || [];
    assert.ok(proposals.length >= 1, "a real task gets a proposal");
    assert.equal(proposals[0].title, "Write release notes");
  });
});
