// Contract tests for the nonprofit lens — campaign + donation substrate
// in server/domains/nonprofit.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNonprofitActions from "../domains/nonprofit.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`nonprofit.${name}`);
  assert.ok(fn, `nonprofit.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerNonprofitActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("nonprofit.campaign management", () => {
  it("creates a campaign scoped per user", () => {
    call("campaign-create", ctxA, { name: "Winter Drive", goal: 10000 });
    assert.equal(call("campaign-list", ctxA, {}).result.count, 1);
    assert.equal(call("campaign-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless campaign", () => {
    assert.equal(call("campaign-create", ctxA, {}).ok, false);
  });
  it("logs donations and computes progress", () => {
    const c = call("campaign-create", ctxA, { name: "C", goal: 1000 }).result.campaign;
    call("donation-log", ctxA, { campaignId: c.id, amount: 250, donor: "Pat" });
    call("donation-log", ctxA, { campaignId: c.id, amount: 250, recurring: true });
    const list = call("campaign-list", ctxA, {});
    assert.equal(list.result.campaigns[0].raised, 500);
    assert.equal(list.result.campaigns[0].progressPct, 50);
    assert.equal(list.result.campaigns[0].donorCount, 2);
  });
  it("rejects non-positive donations and unknown campaigns", () => {
    const c = call("campaign-create", ctxA, { name: "C" }).result.campaign;
    assert.equal(call("donation-log", ctxA, { campaignId: c.id, amount: 0 }).ok, false);
    assert.equal(call("donation-log", ctxA, { campaignId: "nope", amount: 5 }).ok, false);
  });
  it("updates, deletes, and aggregates in the dashboard", () => {
    const c = call("campaign-create", ctxA, { name: "C", goal: 100 }).result.campaign;
    call("donation-log", ctxA, { campaignId: c.id, amount: 80, recurring: true });
    call("campaign-update", ctxA, { id: c.id, status: "complete" });
    const d = call("nonprofit-dashboard", ctxA, {});
    assert.equal(d.result.campaigns, 1);
    assert.equal(d.result.active, 0);
    assert.equal(d.result.totalRaised, 80);
    assert.equal(d.result.recurringDonors, 1);
    call("campaign-delete", ctxA, { id: c.id });
    assert.equal(call("campaign-list", ctxA, {}).result.count, 0);
  });
});
