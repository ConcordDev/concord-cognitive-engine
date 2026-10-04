import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFinanceActions from "../domains/finance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`finance.${name}`);
  assert.ok(fn, `finance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFinanceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("finance wallet receipts", () => {
  it("stores a cited wallet receipt and does not invent one without a DTU id", () => {
    const refused = call("receipt-record", ctxA, {
      amount: 1.25,
      batchId: "batch_1",
      source: "wallet-request",
      sourceId: "req_1",
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "citedDtuId required");
    assert.equal(call("receipt-list", ctxA).result.count, 0);

    const bad = call("receipt-record", ctxA, {
      citedDtuId: "not an id",
      amount: 1.25,
      batchId: "batch_1",
      source: "wallet-request",
      sourceId: "req_1",
    });
    assert.equal(bad.ok, false);
    assert.equal(call("receipt-list", ctxA).result.count, 0);

    const saved = call("receipt-record", ctxA, {
      citedDtuId: "dtu_9",
      amount: 1.25,
      batchId: "batch_1",
      source: "wallet-request",
      sourceId: "req_1",
      counterparty: "user_b",
      note: "lunch",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.receipt.citedDtuId, "dtu_9");
    assert.equal(saved.result.receipt.amount, 1.25);
    assert.equal(saved.result.receipt.batchId, "batch_1");
    const list = call("receipt-list", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.receipts[0].id, saved.result.receipt.id);
    assert.equal(call("receipt-list", ctxB).result.count, 0);
  });

  it("stores a marketplace order receipt without moving Concord Coin", () => {
    const saved = call("receipt-record", ctxA, {
      citedDtuId: "dtu_mkt_1",
      amount: 20,
      batchId: "batch_mkt",
      source: "marketplace-order",
      sourceId: "ord_1",
      counterparty: "seller_1",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.receipt.source, "marketplace-order");
    assert.equal(saved.result.receipt.citedDtuId, "dtu_mkt_1");
    assert.equal(call("receipt-list", ctxA).result.receipts[0].sourceId, "ord_1");
  });

  it("refuses a receipt that is not a wallet ledger source", () => {
    const r = call("receipt-record", ctxA, {
      citedDtuId: "dtu_9",
      amount: 1,
      batchId: "batch_1",
      source: "cash",
      sourceId: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "source invalid");
    assert.equal(call("receipt-list", ctxA).result.count, 0);
  });
});
