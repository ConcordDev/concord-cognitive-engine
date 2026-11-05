// Consulting build (GB-1088 Wave 1) — pins for the R5 first-pass findings:
//   F6  retainer-bill closes the retainer→invoice loop: it mints a real
//       invoice in the shared collection/numbering, the period carries the
//       invoice reference, and the invoice behaves like any other
//       (listed, collectable, exportable without "undefined" fields).
//   F5  proposal-list exposes sectionCount/filledCount beside the content
//       completeness, so a surface can count creation-time sections.
//   F7  expenses carry an explicit billable-to-client flag (default off,
//       never pre-checked) with a billable total in expense-list.

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

describe("consulting build — F6 retainer billing produces an invoice", () => {
  it("bill period → invoice in the shared collection, period references it", () => {
    const r = call("retainer-create", ctxA, { client: "Acme", monthlyAmount: 1000, cadence: "monthly", startDate: "2026-11-01" }).result.retainer;
    const billed = call("retainer-bill", ctxA, { id: r.id, hoursUsed: 5, billedAt: "2026-11-01" });
    assert.equal(billed.ok, true);
    assert.equal(billed.result.invoice.number, "INV-0001");
    assert.equal(billed.result.invoice.total, 1000);
    assert.equal(billed.result.invoice.retainerId, r.id);
    assert.equal(billed.result.invoice.engagementId, null);
    assert.equal(billed.result.invoice.client, "Acme");
    assert.equal(billed.result.invoice.dueDate, "2026-12-01");
    assert.equal(billed.result.period.invoiceId, billed.result.invoice.id);
    assert.equal(billed.result.period.invoiceNumber, "INV-0001");
    // The invoice is a real invoice: listed, outstanding, exportable.
    const list = call("invoice-list", ctxA, {}).result;
    assert.equal(list.count, 1);
    assert.equal(list.outstanding, 1000);
    const doc = call("invoice-export", ctxA, { id: billed.result.invoice.id }).result.document;
    assert.ok(doc.includes("INV-0001"));
    assert.ok(!doc.includes("undefined"), "export never prints undefined fields");
    // And collectable through the ordinary path.
    call("invoice-mark-paid", ctxA, { id: billed.result.invoice.id });
    assert.equal(call("invoice-list", ctxA, {}).result.collected, 1000);
    // Numbering continues the shared sequence for time-based invoices.
    const e = call("engagement-create", ctxA, { name: "E", rate: 100 }).result.engagement;
    call("time-log", ctxA, { engagementId: e.id, hours: 1 });
    const inv2 = call("invoice-create", ctxA, { engagementId: e.id }).result.invoice;
    assert.equal(inv2.number, "INV-0002");
  });
});

describe("consulting build — F5 proposal section counts", () => {
  it("proposal-list reports sectionCount and filledCount", () => {
    const p = call("proposal-create", ctxA, { title: "P", sections: ["executive-summary", "scope-of-work", "pricing"] }).result.proposal;
    let listed = call("proposal-list", ctxA, {}).result.proposals[0];
    assert.equal(listed.sectionCount, 3);
    assert.equal(listed.filledCount, 0);
    assert.equal(listed.completeness, 0);
    call("proposal-update-section", ctxA, { id: p.id, sectionKey: "pricing", content: "$10k fixed." });
    listed = call("proposal-list", ctxA, {}).result.proposals[0];
    assert.equal(listed.filledCount, 1);
    assert.equal(listed.completeness, 33);
  });
});

describe("consulting build — F7 expense billable control", () => {
  it("billable is explicit (default false) and totals separately", () => {
    const e = call("engagement-create", ctxA, { name: "E", rate: 100 }).result.engagement;
    call("expense-create", ctxA, { engagementId: e.id, description: "Flight", amount: 200 });
    call("expense-create", ctxA, { engagementId: e.id, description: "Hotel", amount: 300, billable: true });
    const list = call("expense-list", ctxA, {}).result;
    assert.equal(list.total, 500);
    assert.equal(list.billable, 300);
    assert.equal(list.expenses.find((x) => x.description === "Flight").billable, false);
    assert.equal(list.expenses.find((x) => x.description === "Hotel").billable, true);
  });
});
