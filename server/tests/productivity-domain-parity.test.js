// Contract tests for the productivity Todoist + TickTick 2026-parity
// task-manager macros (tasks, projects, labels, smart views, habits,
// focus, Eisenhower, karma).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProductivityActions from "../domains/productivity.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`productivity.${name}`);
  assert.ok(fn, `productivity.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerProductivityActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("productivity.task-* CRUD", () => {
  it("add requires content, scoped per user", () => {
    assert.equal(call("task-add", ctxA, {}).ok, false);
    call("task-add", ctxA, { content: "Write report" });
    assert.equal(call("task-list", ctxA, {}).result.count, 1);
    assert.equal(call("task-list", ctxB, {}).result.count, 0);
  });

  it("complete a non-recurring task; reopen", () => {
    const t = call("task-add", ctxA, { content: "One-off" }).result.task;
    const c = call("task-complete", ctxA, { id: t.id });
    assert.equal(c.result.task.done, true);
    assert.equal(c.result.spawned, null);
    assert.equal(call("task-list", ctxA, {}).result.count, 0);
    call("task-complete", ctxA, { id: t.id, reopen: true });
    assert.equal(call("task-list", ctxA, {}).result.count, 1);
  });

  it("completing a recurring task spawns the next occurrence", () => {
    const t = call("task-add", ctxA, { content: "Standup", recurring: "daily", dueDate: today() }).result.task;
    const c = call("task-complete", ctxA, { id: t.id });
    assert.ok(c.result.spawned);
    assert.equal(c.result.spawned.dueDate, dayOffset(1));
    assert.equal(call("task-list", ctxA, {}).result.count, 1); // the spawned one
  });
});

describe("productivity.subtasks", () => {
  it("add + toggle subtasks", () => {
    const t = call("task-add", ctxA, { content: "Parent" }).result.task;
    const sub = call("subtask-add", ctxA, { taskId: t.id, content: "Step 1" }).result.subtask;
    call("subtask-toggle", ctxA, { taskId: t.id, id: sub.id });
    assert.equal(call("task-detail", ctxA, { id: t.id }).result.task.subtasks[0].done, true);
  });
});

describe("productivity.projects + labels", () => {
  it("project task counts; deleting unassigns tasks", () => {
    const p = call("project-create", ctxA, { name: "Work" }).result.project;
    call("task-add", ctxA, { content: "Task", projectId: p.id });
    assert.equal(call("project-list", ctxA, {}).result.projects[0].taskCount, 1);
    assert.equal(call("project-detail", ctxA, { id: p.id }).result.tasks.length, 1);
    call("project-delete", ctxA, { id: p.id });
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].projectId, null);
  });

  it("labels count tagged tasks", () => {
    call("label-create", ctxA, { name: "urgent" });
    call("task-add", ctxA, { content: "Tagged", labels: ["urgent"] });
    assert.equal(call("label-list", ctxA, {}).result.labels[0].taskCount, 1);
  });
});

describe("productivity.smart views", () => {
  it("today-view splits overdue and due-today", () => {
    call("task-add", ctxA, { content: "Late", dueDate: dayOffset(-2) });
    call("task-add", ctxA, { content: "Now", dueDate: today() });
    call("task-add", ctxA, { content: "Later", dueDate: dayOffset(5) });
    const tv = call("today-view", ctxA, {});
    assert.equal(tv.result.tasks.length, 2);
    assert.equal(tv.result.overdue, 1);
    assert.equal(tv.result.dueToday, 1);
  });

  it("eisenhower-matrix routes by urgency and importance", () => {
    call("task-add", ctxA, { content: "Crisis", priority: 1, dueDate: today() });
    call("task-add", ctxA, { content: "Plan", priority: 2, dueDate: dayOffset(20) });
    call("task-add", ctxA, { content: "Noise", priority: 4, dueDate: dayOffset(30) });
    const m = call("eisenhower-matrix", ctxA, {}).result.quadrants;
    assert.equal(m.do_first.length, 1);
    assert.equal(m.schedule.length, 1);
    assert.equal(m.eliminate.length, 1);
  });
});

describe("productivity.habits", () => {
  it("checkin builds a streak", () => {
    const h = call("habit-create", ctxA, { name: "Read" }).result.habit;
    call("habit-checkin", ctxA, { id: h.id, date: dayOffset(-1) });
    const r = call("habit-checkin", ctxA, { id: h.id, date: today() });
    assert.equal(r.result.streak, 2);
    assert.equal(r.result.doneToday, true);
    assert.equal(call("habit-list", ctxA, {}).result.habits[0].streak, 2);
  });
});

describe("productivity.focus + karma", () => {
  it("focus sessions accumulate", () => {
    call("focus-log", ctxA, { durationMin: 25 });
    call("focus-log", ctxA, { durationMin: 50 });
    const fs = call("focus-stats", ctxA, {});
    assert.equal(fs.result.totalSessions, 2);
    assert.equal(fs.result.totalMinutes, 75);
  });

  it("karma rewards completions by priority", () => {
    const t1 = call("task-add", ctxA, { content: "P1", priority: 1 }).result.task;
    const t2 = call("task-add", ctxA, { content: "P4", priority: 4 }).result.task;
    call("task-complete", ctxA, { id: t1.id });
    call("task-complete", ctxA, { id: t2.id });
    const k = call("karma", ctxA, {});
    assert.equal(k.result.karma, 12); // 8 + 4
    assert.equal(k.result.completions, 2);
  });
});

describe("productivity.dashboard + stats", () => {
  it("stats track completions and streak", () => {
    const t = call("task-add", ctxA, { content: "Done today" }).result.task;
    call("task-complete", ctxA, { id: t.id });
    const st = call("productivity-stats", ctxA, {});
    assert.equal(st.result.completedToday, 1);
    assert.equal(st.result.streak, 1);
  });

  it("dashboard aggregates", () => {
    call("task-add", ctxA, { content: "Due", dueDate: today() });
    call("project-create", ctxA, { name: "P" });
    call("focus-log", ctxA, { durationMin: 25 });
    const d = call("productivity-dashboard", ctxA, {});
    assert.equal(d.result.activeTasks, 1);
    assert.equal(d.result.dueToday, 1);
    assert.equal(d.result.focusMinutesToday, 25);
  });
});
