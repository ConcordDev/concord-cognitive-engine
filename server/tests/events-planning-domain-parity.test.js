// Contract tests for the events lens — event-planning substrate in
// server/domains/events.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEventsActions from "../domains/events.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`events.${name}`);
  assert.ok(fn, `events.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEventsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newEvent(ctx = ctxA, over = {}) {
  return call("event-create", ctx, { name: "Summer Gala", type: "social", date: "2099-07-04", budget: 10000, ...over }).result.event;
}

describe("events.event CRUD", () => {
  it("creates an event scoped per user", () => {
    const e = newEvent();
    assert.equal(e.status, "planning");
    assert.equal(call("event-list", ctxA, {}).result.count, 1);
    assert.equal(call("event-list", ctxB, {}).result.count, 0);
  });
  it("rejects an unnamed event; unknown type falls back to social", () => {
    assert.equal(call("event-create", ctxA, {}).ok, false);
    assert.equal(call("event-create", ctxA, { name: "X", type: "weird" }).result.event.type, "social");
  });
  it("updates and deletes an event", () => {
    const e = newEvent();
    call("event-update", ctxA, { id: e.id, status: "confirmed", budget: 12000 });
    assert.equal(call("event-detail", ctxA, { id: e.id }).result.event.status, "confirmed");
    call("event-delete", ctxA, { id: e.id });
    assert.equal(call("event-list", ctxA, {}).result.count, 0);
  });
});

describe("events.tasks", () => {
  it("adds, toggles and deletes planning tasks", () => {
    const e = newEvent();
    const t = call("task-add", ctxA, { eventId: e.id, title: "Book caterer" }).result.task;
    assert.equal(call("task-toggle", ctxA, { eventId: e.id, taskId: t.id }).result.done, true);
    call("task-delete", ctxA, { eventId: e.id, taskId: t.id });
    assert.equal(call("event-detail", ctxA, { id: e.id }).result.event.tasks.length, 0);
  });
  it("rejects a titleless task", () => {
    const e = newEvent();
    assert.equal(call("task-add", ctxA, { eventId: e.id }).ok, false);
  });
});

describe("events.vendors", () => {
  it("adds vendors and tracks remaining budget", () => {
    const e = newEvent();
    call("vendor-add", ctxA, { eventId: e.id, name: "Caterer", role: "catering", cost: 4000 });
    call("vendor-add", ctxA, { eventId: e.id, name: "DJ", role: "music", cost: 1500 });
    const d = call("event-detail", ctxA, { id: e.id });
    assert.equal(d.result.vendorCost, 5500);
    assert.equal(d.result.budgetRemaining, 4500);
  });
  it("removes a vendor", () => {
    const e = newEvent();
    const v = call("vendor-add", ctxA, { eventId: e.id, name: "Florist", cost: 800 }).result.vendor;
    call("vendor-remove", ctxA, { eventId: e.id, vendorId: v.id });
    assert.equal(call("event-detail", ctxA, { id: e.id }).result.event.vendors.length, 0);
  });
});

describe("events.dashboard", () => {
  it("aggregates events, upcoming, budget and open tasks", () => {
    const e = newEvent();
    call("task-add", ctxA, { eventId: e.id, title: "T1" });
    newEvent(ctxA, { name: "Second", budget: 5000 });
    const d = call("events-dashboard", ctxA, {});
    assert.equal(d.result.totalEvents, 2);
    assert.equal(d.result.totalBudget, 15000);
    assert.equal(d.result.openTasks, 1);
  });
});

describe("events — production calculators still intact", () => {
  it("budgetReconcile still responds", () => {
    assert.equal(call("budgetReconcile", ctxA, {}).ok, true);
  });
});
