// GB-1539 bounds enforcement — FIX-home-improvement-004 (project name)
// and FIX-home-improvement-005 (budget + inventory asset numbers).
// The walks: a 300-character project name was accepted; Budget and the
// asset numeric field accepted -1 and 99999999999 silently (the server
// floored negatives with Math.max(0, …)). All three surfaces now
// refuse out-of-policy values with invalid_input; in-policy writes
// store the value the user actually gave.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHomeImprovementActions from "../domains/homeimprovement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`home-improvement.${name}`);
  if (!fn) throw new Error(`home-improvement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHomeImprovementActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_hi_a" }, userId: "bnd_hi_a" };

describe("home-improvement bounds (FIX-home-improvement-004/005)", () => {
  it("a 300-character project name refuses with invalid_input", () => {
    const r = call("project-add", ctxA, { name: "x".repeat(300), budget: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("budget -1 refuses — it is NOT floored to 0", () => {
    const r = call("project-add", ctxA, { name: "Kitchen", budget: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("budget 99999999999 refuses (money cap)", () => {
    const r = call("project-add", ctxA, { name: "Kitchen", budget: 99999999999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("an in-policy project stores its real budget", () => {
    const r = call("project-add", ctxA, { name: "Kitchen", budget: 25000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.project.budget, 25000);
  });

  it("expense amount -1 refuses; a real expense logs", () => {
    const p = call("project-add", ctxA, { name: "Bath", budget: 8000 });
    const pid = p.result.project.id;
    const bad = call("expense-log", ctxA, { projectId: pid, label: "Tile", amount: -1 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    const good = call("expense-log", ctxA, { projectId: pid, label: "Tile", amount: 450 });
    assert.equal(good.ok, true);
    assert.equal(good.result.expense.amount, 450);
  });

  it("asset purchasePrice -1 and 99999999999 refuse; a real price stores", () => {
    assert.equal(call("inventory-add", ctxA, { name: "Fridge", purchasePrice: -1 }).error, "invalid_input");
    assert.equal(call("inventory-add", ctxA, { name: "Fridge", purchasePrice: 99999999999 }).error, "invalid_input");
    const ok = call("inventory-add", ctxA, { name: "Fridge", purchasePrice: 1200 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.asset.purchasePrice, 1200);
  });
});
