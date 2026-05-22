// Contract tests for the materials lens — saved-materials shortlist
// substrate in server/domains/materials.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMaterialsActions from "../domains/materials.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`materials.${name}`);
  assert.ok(fn, `materials.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMaterialsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("materials.shortlist CRUD", () => {
  it("adds a material scoped per user", () => {
    call("shortlist-add", ctxA, { name: "Ti-6Al-4V", category: "alloy", density: 4.43, tensileStrengthMPa: 1170 });
    assert.equal(call("shortlist-list", ctxA, {}).result.count, 1);
    assert.equal(call("shortlist-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless or duplicate material", () => {
    assert.equal(call("shortlist-add", ctxA, {}).ok, false);
    call("shortlist-add", ctxA, { name: "Steel", refId: "steel" });
    assert.equal(call("shortlist-add", ctxA, { name: "Steel 2", refId: "steel" }).ok, false);
  });
  it("removes a material", () => {
    const m = call("shortlist-add", ctxA, { name: "Aluminum" }).result.material;
    call("shortlist-remove", ctxA, { id: m.id });
    assert.equal(call("shortlist-list", ctxA, {}).result.count, 0);
  });
});

describe("materials.shortlist-compare", () => {
  it("picks the best material per property", () => {
    call("shortlist-add", ctxA, { name: "Titanium", density: 4.5, tensileStrengthMPa: 1000, costPerKg: 35 });
    call("shortlist-add", ctxA, { name: "Aluminum", density: 2.7, tensileStrengthMPa: 310, costPerKg: 3 });
    const c = call("shortlist-compare", ctxA, {});
    assert.equal(c.ok, true);
    const density = c.result.comparison.find((x) => x.key === "density");
    assert.equal(density.best, "Aluminum"); // lower density better
    const strength = c.result.comparison.find((x) => x.key === "tensileStrengthMPa");
    assert.equal(strength.best, "Titanium"); // higher strength better
  });
  it("rejects comparison with fewer than 2 materials", () => {
    call("shortlist-add", ctxA, { name: "Solo" });
    assert.equal(call("shortlist-compare", ctxA, {}).ok, false);
  });
});

describe("materials.shortlist-dashboard", () => {
  it("aggregates by category", () => {
    call("shortlist-add", ctxA, { name: "A", category: "alloy" });
    call("shortlist-add", ctxA, { name: "B", category: "alloy" });
    call("shortlist-add", ctxA, { name: "C", category: "ceramic" });
    const d = call("shortlist-dashboard", ctxA, {});
    assert.equal(d.result.shortlisted, 3);
    assert.equal(d.result.byCategory.alloy, 2);
  });
});

describe("materials — analysis macros still intact", () => {
  it("compareProperties still responds", () => {
    assert.equal(call("compareProperties", ctxA, {}).ok, true);
  });
});
