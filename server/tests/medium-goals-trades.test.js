import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";
import registerTradesActions from "../domains/trades.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params) {
  return ACTIONS.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => {
  registerGoalsActions(register);
  registerTradesActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});
const ctx = { actor: { userId: "user_a" } };

describe("goals templates and check-ins", () => {
  it("does not add a recurring goal unless asked, and drops check-ins with the objective", () => {
    const applied = call("goals", "templates", ctx, { op: "apply", templateId: "tpl_okr_quarter" });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.recurring, null);
    const id = applied.result.objective.id;
    const added = call("goals", "checkin", ctx, { op: "add", goalId: id, confidence: 0.7, progress: 40 });
    assert.equal(added.ok, true);
    call("goals", "alignmentTree", ctx, { op: "remove", id });
    const left = call("goals", "checkin", ctx, { op: "list" });
    const rows = left.result.checkins || left.result.list || [];
    assert.equal(rows.filter((c) => c.goalId === id).length, 0);
  });
});

describe("trades quotes and customers", () => {
  it("deletes a draft quote and a customer the caller owns", () => {
    const customer = call("trades", "customer-upsert", ctx, { name: "Ada" });
    const quote = call("trades", "quotes-create", ctx, {
      customerId: customer.result.customer.id,
      title: "Fence",
      lineItems: [{ desc: "posts", qty: 2, unitPrice: 10 }],
    });
    assert.equal(call("trades", "quotes-delete", ctx, { id: quote.result.quote.id }).ok, true);
    assert.equal(call("trades", "quotes-list", ctx, {}).result.quotes.length, 0);
    assert.equal(call("trades", "customer-delete", ctx, { id: customer.result.customer.id }).ok, true);
    assert.equal(call("trades", "customer-list", ctx, {}).result.customers.length, 0);
  });
});
