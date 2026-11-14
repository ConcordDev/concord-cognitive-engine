// GB-1539 bounds enforcement — FIX-billing-006 (caps the earlier
// words-refusals lacked) and FIX-docs-007 (number-cell coercion).
// Billing: the walked seat count / trial / coupon / tax surfaces
// already refused negatives in words from an earlier partial; what
// was missing was the ceiling side — a 99999-day trial, 999999 seats,
// a $99,999,999 fixed coupon. Those now refuse in the policy shape.
// Validation only; no money paths touched (money OFF).
// Docs: a number cell written with a non-numeric, negative or
// over-cap value was silently coerced to 0 — for quantity/amount
// columns that reads as data loss. It now refuses with the column
// named (NUMBER class: finite, 0 to 1,000,000); an emptied cell
// still clears to 0 as before.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBillingActions from "../domains/billing.js";
import registerDocsActions from "../domains/docs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerBillingActions(register); registerDocsActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_bill_a" }, userId: "bnd_bill_a" };

describe("billing caps (FIX-billing-006)", () => {
  it("a 99999-day trial refuses with invalid_input (duration cap)", () => {
    const r = call("billing", "plan-create", ctxA, { name: "Pro", amount: 10, trialDays: 99999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /trialDays/);
  });

  it("a sane trial still creates", () => {
    const r = call("billing", "plan-create", ctxA, { name: "Pro", amount: 10, trialDays: 14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.trialDays, 14);
  });

  it("999999 seats refuse (quantity cap); 25 seats subscribe", () => {
    const plan = call("billing", "plan-create", ctxA, { name: "Team", amount: 20 });
    const bad = call("billing", "subscription-create", ctxA, { planId: plan.result.plan.id, quantity: 999999 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    const good = call("billing", "subscription-create", ctxA, { planId: plan.result.plan.id, quantity: 25 });
    assert.equal(good.ok, true);
    assert.equal(good.result.subscription.quantity, 25);
  });

  it("a fixed coupon over the money cap refuses; a percent coupon at 100 works", () => {
    const bad = call("billing", "coupon-create", ctxA, { code: "WHALE", kind: "fixed", value: 99999999 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    const good = call("billing", "coupon-create", ctxA, { code: "FULL", kind: "percent", value: 100 });
    assert.equal(good.ok, true);
  });

  it("maxRedemptions over the quantity cap refuses", () => {
    const r = call("billing", "coupon-create", ctxA, { code: "MANY", kind: "percent", value: 10, maxRedemptions: 999999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });
});

describe("docs number cells (FIX-docs-007)", () => {
  function makeDb(ctx) {
    const r = call("docs", "db-create", ctx, {
      name: "Inventory",
      columns: [{ name: "Item", type: "text" }, { name: "Qty", type: "number" }],
    });
    assert.equal(r.ok, true);
    const db = r.result.database;
    return { id: db.id, qtyCol: db.columns.find((c) => c.type === "number").id, itemCol: db.columns.find((c) => c.type === "text").id };
  }

  it("a non-numeric number cell refuses with the column named — not coerced to 0", () => {
    const { id, qtyCol, itemCol } = makeDb(ctxA);
    const r = call("docs", "db-row-add", ctxA, { id, cells: { [itemCol]: "Bolts", [qtyCol]: "abc" } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /Qty/);
    const detail = call("docs", "db-detail", ctxA, { id });
    assert.equal(detail.result.database.rows.length, 0);
  });

  it("a negative and an over-cap number cell refuse", () => {
    const { id, qtyCol } = makeDb(ctxA);
    assert.equal(call("docs", "db-row-add", ctxA, { id, cells: { [qtyCol]: -4 } }).error, "invalid_input");
    assert.equal(call("docs", "db-row-add", ctxA, { id, cells: { [qtyCol]: 99999999999 } }).error, "invalid_input");
  });

  it("a real quantity stores; an update to 'abc' refuses and keeps the old value", () => {
    const { id, qtyCol } = makeDb(ctxA);
    const added = call("docs", "db-row-add", ctxA, { id, cells: { [qtyCol]: 42 } });
    assert.equal(added.ok, true);
    assert.equal(added.result.row.cells[qtyCol], 42);
    const rowId = added.result.row.id;
    const bad = call("docs", "db-row-update", ctxA, { id, rowId, cells: { [qtyCol]: "abc" } });
    assert.equal(bad.ok, false);
    const detail = call("docs", "db-detail", ctxA, { id });
    assert.equal(detail.result.database.rows[0].cells[qtyCol], 42);
  });

  it("an emptied number cell still clears to 0", () => {
    const { id, qtyCol } = makeDb(ctxA);
    const added = call("docs", "db-row-add", ctxA, { id, cells: { [qtyCol]: "" } });
    assert.equal(added.ok, true);
    assert.equal(added.result.row.cells[qtyCol], 0);
  });
});
