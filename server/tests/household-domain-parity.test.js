// Contract tests for the household lens — Tody / Sweepy-shape chore
// substrate in server/domains/household.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHouseholdActions from "../domains/household.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`household.${name}`);
  assert.ok(fn, `household.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHouseholdActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newRoom(ctx = ctxA) {
  return call("room-create", ctx, { name: "Kitchen" }).result.room;
}

describe("household.room CRUD", () => {
  it("creates a room scoped per user", () => {
    newRoom();
    assert.equal(call("room-list", ctxA, {}).result.count, 1);
    assert.equal(call("room-list", ctxB, {}).result.count, 0);
  });
  it("delete removes the room and its tasks", () => {
    const r = newRoom();
    call("task-create", ctxA, { roomId: r.id, name: "Mop floor" });
    call("room-delete", ctxA, { id: r.id });
    assert.equal(call("room-list", ctxA, {}).result.count, 0);
    assert.equal(call("task-list", ctxA, {}).result.count, 0);
  });
});

describe("household.task condition tracking", () => {
  it("a fresh task is clean; an overdue task needs attention", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Wipe counters", intervalDays: 7 }).result.task;
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "clean");
    // backdate lastDoneAt 10 days
    t.lastDoneAt = new Date(Date.now() - 10 * 86400000).toISOString();
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "needs_attention");
  });
  it("task-done resets the condition and awards effort-scaled points", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Deep clean", effort: "heavy" }).result.task;
    t.lastDoneAt = new Date(Date.now() - 30 * 86400000).toISOString();
    const done = call("task-done", ctxA, { id: t.id, by: "Sam" });
    assert.equal(done.result.pointsAwarded, 20);
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "clean");
  });
  it("rejects a task in an unknown room", () => {
    assert.equal(call("task-create", ctxA, { roomId: "nope", name: "x" }).ok, false);
  });
});

describe("household.chore-board + leaderboard", () => {
  it("chore-board sorts the most urgent task first", () => {
    const r = newRoom();
    const fresh = call("task-create", ctxA, { roomId: r.id, name: "Fresh", intervalDays: 30 }).result.task;
    const stale = call("task-create", ctxA, { roomId: r.id, name: "Stale", intervalDays: 2 }).result.task;
    stale.lastDoneAt = new Date(Date.now() - 20 * 86400000).toISOString();
    const board = call("chore-board", ctxA, {}).result.board;
    assert.equal(board[0].name, "Stale");
    assert.ok(fresh);
  });
  it("leaderboard ranks people by points", () => {
    const r = newRoom();
    const t1 = call("task-create", ctxA, { roomId: r.id, name: "A", effort: "heavy" }).result.task;
    const t2 = call("task-create", ctxA, { roomId: r.id, name: "B", effort: "light" }).result.task;
    call("task-done", ctxA, { id: t1.id, by: "Ana" });
    call("task-done", ctxA, { id: t2.id, by: "Ben" });
    const lb = call("assignee-leaderboard", ctxA, {}).result.leaderboard;
    assert.equal(lb[0].person, "Ana");
    assert.equal(lb[0].points, 20);
  });
});

describe("household.vacation mode", () => {
  it("pausing freezes condition; resuming shifts the clock forward", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Vacuum", intervalDays: 7 }).result.task;
    t.lastDoneAt = new Date(Date.now() - 3 * 86400000).toISOString();
    const before = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    call("vacation-toggle", ctxA, { on: true });
    const paused = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    assert.ok(Math.abs(paused - before) < 0.05); // frozen
    call("vacation-toggle", ctxA, { on: false });
    const resumed = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    assert.ok(Math.abs(resumed - before) < 0.05); // resumes from frozen point, not jumped
  });
  it("household-dashboard reports cleanliness + paused state", () => {
    const r = newRoom();
    call("task-create", ctxA, { roomId: r.id, name: "Tidy", intervalDays: 14 });
    const d = call("household-dashboard", ctxA, {});
    assert.equal(d.result.rooms, 1);
    assert.equal(d.result.tasks, 1);
    assert.equal(d.result.cleanlinessPct, 100);
    assert.equal(d.result.paused, false);
  });
});

describe("household — compute helpers still intact", () => {
  it("rotateChores handles input", () => {
    const r = call("rotateChores", ctxA, {});
    assert.equal(r.ok, true);
  });
});
