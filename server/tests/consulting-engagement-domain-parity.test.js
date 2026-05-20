// Contract tests for the consulting lens — engagement / time-tracking
// substrate in server/domains/consulting.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerConsultingActions from "../domains/consulting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`consulting.${name}`);
  assert.ok(fn, `consulting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerConsultingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("consulting.engagement management", () => {
  it("creates an engagement scoped per user", () => {
    call("engagement-create", ctxA, { name: "Redesign", client: "Acme", rate: 200, budgetHours: 100 });
    assert.equal(call("engagement-list", ctxA, {}).result.count, 1);
    assert.equal(call("engagement-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless engagement", () => {
    assert.equal(call("engagement-create", ctxA, {}).ok, false);
  });
  it("logs time and computes billed + utilization", () => {
    const e = call("engagement-create", ctxA, { name: "E", rate: 100, budgetHours: 10 }).result.engagement;
    const log = call("time-log", ctxA, { engagementId: e.id, hours: 4, note: "kickoff" });
    assert.equal(log.result.billed, 400);
    const list = call("engagement-list", ctxA, {});
    assert.equal(list.result.engagements[0].loggedHours, 4);
    assert.equal(list.result.engagements[0].billed, 400);
    assert.equal(list.result.engagements[0].utilizationPct, 40);
  });
  it("rejects non-positive hours and unknown engagements", () => {
    const e = call("engagement-create", ctxA, { name: "E" }).result.engagement;
    assert.equal(call("time-log", ctxA, { engagementId: e.id, hours: 0 }).ok, false);
    assert.equal(call("time-log", ctxA, { engagementId: "nope", hours: 2 }).ok, false);
  });
  it("updates, deletes, and aggregates in the dashboard", () => {
    const e = call("engagement-create", ctxA, { name: "E", rate: 150 }).result.engagement;
    call("time-log", ctxA, { engagementId: e.id, hours: 2 });
    call("engagement-update", ctxA, { id: e.id, status: "complete" });
    const d = call("consulting-dashboard", ctxA, {});
    assert.equal(d.result.engagements, 1);
    assert.equal(d.result.active, 0);
    assert.equal(d.result.loggedHours, 2);
    assert.equal(d.result.billed, 300);
    call("engagement-delete", ctxA, { id: e.id });
    assert.equal(call("engagement-list", ctxA, {}).result.count, 0);
  });
});
