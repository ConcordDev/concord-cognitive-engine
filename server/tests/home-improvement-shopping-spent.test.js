// FIX-home-improvement-010 — purchased shopping items never reached
// Budget "Spent": project-list and the dashboard aggregated only the
// manual expense log, and shopping-toggle flipped a flag nothing read.
// These tests drive the real actions: a purchase must move the project's
// spent (when assigned), the unassigned total (when not), and the
// dashboard's totalSpent — and un-purchasing must take it back out.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHomeImprovementActions from "../domains/homeimprovement.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`home-improvement.${name}`);
  if (!fn) throw new Error(`home-improvement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerHomeImprovementActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function buyAndPurchase(ctx, params) {
  const add = call("shopping-add", ctx, params);
  assert.equal(add.ok, true);
  const t = call("shopping-toggle", ctx, { id: add.result.item.id });
  assert.equal(t.ok, true);
  assert.equal(t.result.item.purchased, true);
  return add.result.item;
}

describe("purchased shopping rolls into Budget spent (FIX-home-improvement-010)", () => {
  it("an unassigned $9 x 2 purchase shows in unassignedShoppingSpent and the dashboard total", () => {
    buyAndPurchase(ctxA, { name: "qa-zt4-item-c", price: 9, qty: 2 });
    const list = call("project-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.unassignedShoppingSpent, 18);
    const dash = call("home-improvement-dashboard", ctxA, {});
    assert.equal(dash.result.totalSpent, 18);
    assert.equal(dash.result.shoppingSpent, 18);
  });

  it("a project-assigned purchase rolls into that project's spent, not the unassigned bucket", () => {
    const proj = call("project-add", ctxA, { name: "Bath", budget: 500 }).result.project;
    buyAndPurchase(ctxA, { name: "Tile", price: 40, qty: 1, projectId: proj.id });
    const list = call("project-list", ctxA, {});
    const p = list.result.projects.find((x) => x.id === proj.id);
    assert.equal(p.spent, 40);
    assert.equal(p.shoppingSpent, 40);
    assert.equal(list.result.unassignedShoppingSpent, 0);
  });

  it("un-purchasing removes the amount from spent again", () => {
    const item = buyAndPurchase(ctxA, { name: "Paint", price: 25, qty: 1 });
    assert.equal(call("home-improvement-dashboard", ctxA, {}).result.totalSpent, 25);
    call("shopping-toggle", ctxA, { id: item.id });
    assert.equal(call("home-improvement-dashboard", ctxA, {}).result.totalSpent, 0);
    assert.equal(call("project-list", ctxA, {}).result.unassignedShoppingSpent, 0);
  });

  it("expenses still count alongside purchases (no double count of either)", () => {
    const proj = call("project-add", ctxA, { name: "Deck", budget: 900 }).result.project;
    call("expense-log", ctxA, { projectId: proj.id, amount: 30, label: "Permit" });
    buyAndPurchase(ctxA, { name: "Boards", price: 12, qty: 2, projectId: proj.id });
    const p = call("project-list", ctxA, {}).result.projects.find((x) => x.id === proj.id);
    assert.equal(p.spent, 54);
  });
});
