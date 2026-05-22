// Contract tests for the market lens — competitor / market-research
// substrate in server/domains/market.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketActions from "../domains/market.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`market.${name}`);
  assert.ok(fn, `market.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("market.competitor management", () => {
  it("adds a competitor scoped per user", () => {
    call("competitor-add", ctxA, { name: "RivalCo", segment: "saas", marketSharePct: 30, threatLevel: "high" });
    assert.equal(call("competitor-list", ctxA, {}).result.count, 1);
    assert.equal(call("competitor-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless competitor; unknown threat falls back to medium", () => {
    assert.equal(call("competitor-add", ctxA, {}).ok, false);
    assert.equal(call("competitor-add", ctxA, { name: "X", threatLevel: "weird" }).result.competitor.threatLevel, "medium");
  });
  it("lists sorted by market share, descending, and filters by segment", () => {
    call("competitor-add", ctxA, { name: "Small", segment: "a", marketSharePct: 5 });
    call("competitor-add", ctxA, { name: "Big", segment: "a", marketSharePct: 40 });
    call("competitor-add", ctxA, { name: "Other", segment: "b", marketSharePct: 20 });
    const all = call("competitor-list", ctxA, {});
    assert.equal(all.result.competitors[0].name, "Big");
    assert.equal(call("competitor-list", ctxA, { segment: "a" }).result.count, 2);
  });
  it("updates and deletes a competitor", () => {
    const c = call("competitor-add", ctxA, { name: "C" }).result.competitor;
    call("competitor-update", ctxA, { id: c.id, threatLevel: "high", marketSharePct: 12 });
    assert.equal(call("competitor-list", ctxA, {}).result.competitors[0].threatLevel, "high");
    call("competitor-delete", ctxA, { id: c.id });
    assert.equal(call("competitor-list", ctxA, {}).result.count, 0);
  });
  it("dashboard aggregates threat + tracked share + segments", () => {
    call("competitor-add", ctxA, { name: "A", segment: "x", marketSharePct: 25, threatLevel: "high" });
    call("competitor-add", ctxA, { name: "B", segment: "x", marketSharePct: 15 });
    const d = call("market-dashboard", ctxA, {});
    assert.equal(d.result.competitors, 2);
    assert.equal(d.result.highThreat, 1);
    assert.equal(d.result.trackedSharePct, 40);
    assert.equal(d.result.segments.x, 2);
  });
});
