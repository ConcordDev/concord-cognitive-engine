// server/tests/electrical-full-build.test.js
// Electrical full lens build (GB-1088 wave 1) — Review 5's findings:
// F6 invoices were the family's only record with no exit (invoiceList +
// invoiceMarkPaid only), so an invoice stood permanently once created;
// F4's server half — the safety inspection must count every row it is
// given (the FE dropped unnamed rows before sending; that fix is in
// NecCodeCalc, this suite pins the counting contract it relies on).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerElectricalActions from "../domains/electrical.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`electrical.${name}`);
  if (!fn) throw new Error(`electrical.${name} not registered`);
  return fn(ctx, { id: null, domain: "electrical", data: params, meta: {} }, params);
}

before(() => { registerElectricalActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("electrical full build — F6 invoice exit", () => {
  it("deletes an invoice; the list and summary no longer carry it", () => {
    const est = call("estimateCreate", ctxA, { client: "Acme" });
    call("estimateAddLine", ctxA, { estimateId: est.result.id, lineType: "labor", hours: 1, rate: 161 });
    const inv = call("estimateToInvoice", ctxA, { estimateId: est.result.id });
    assert.equal(inv.ok, true);

    const del = call("invoiceDelete", ctxA, { invoiceId: inv.result.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);

    const list = call("invoiceList", ctxA);
    assert.equal(list.result.invoices.length, 0);
    assert.equal(list.result.summary.count, 0);
    assert.equal(list.result.summary.totalBilled, 0);
  });

  it("refuses a missing invoice and never touches another user's", () => {
    const est = call("estimateCreate", ctxA, { client: "Acme" });
    const inv = call("estimateToInvoice", ctxA, { estimateId: est.result.id });
    const missing = call("invoiceDelete", ctxA, { invoiceId: "inv_nope" });
    assert.equal(missing.ok, false);
    const other = call("invoiceDelete", ctxB, { invoiceId: inv.result.id });
    assert.equal(other.ok, false, "a different user's delete must not land");
    assert.equal(call("invoiceList", ctxA).result.invoices.length, 1);
  });
});

describe("electrical full build — F4 inspection counting contract", () => {
  it("counts every row it is given — Review 5's fixture, honestly totalled", () => {
    // The pass's fixture as the fixed FE now sends it: one passed row
    // (positional label for its blank name) + one named critical failure.
    const r = call("safetyInspection", ctxA, { inspectionItems: [
      { name: "Item 1", necCode: "", passed: true, critical: false, notes: "" },
      { name: "Panel clearance", necCode: "110.26", passed: false, critical: true, notes: "" },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.passed, 1);
    assert.equal(r.result.passRate, 50);
    assert.equal(r.result.criticalFailures, 1);
    assert.match(r.result.overallResult, /^FAIL/);
  });
});
