/**
 * Open invoices can be voided. Paid invoices take a credit note.
 * An expense stays on the list when voided, with a reversing journal entry.
 * Run: node --test server/tests/medium-invoice-expense.test.js
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccountingActions from "../domains/accounting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`accounting.${name}`);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  return fn({ actor: { userId: "acct_u" }, userId: "acct_u" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAccountingActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

describe("medium invoice and expense corrections", () => {
  it("voids an open invoice and credits a paid one", () => {
    const created = call("invoice-create", { customerName: "QA", total: 40, issuedAt: "2026-11-01", dueAt: "2026-11-15" });
    assert.equal(created.ok, true);
    const id = created.result.invoice.id;
    const voided = call("invoice-void", { id });
    assert.equal(voided.ok, true);
    assert.equal(voided.result.invoice.status, "void");
    assert.equal(call("invoice-mark-paid", { id }).ok, false);

    const paid = call("invoice-create", { customerName: "QA", total: 12, issuedAt: "2026-11-02", dueAt: "2026-11-16" });
    const paidId = paid.result.invoice.id;
    assert.equal(call("invoice-mark-paid", { id: paidId }).result.invoice.status, "paid");
    assert.equal(call("invoice-void", { id: paidId }).error, "paid invoice needs a credit note");
    const note = call("invoice-credit-note", { id: paidId, amount: 12 });
    assert.equal(note.ok, true);
    assert.equal(note.result.invoice.status, "credited");
    assert.equal(note.result.creditNote.number, `CN-${paid.result.invoice.number}`);
    const listed = call("invoice-list", { status: "void" });
    assert.equal(listed.result.invoices.length, 1);
    assert.equal(listed.result.invoices[0].id, id);
  });

  it("keeps a voided expense and posts the reversing entry", () => {
    const coa = call("coa-list");
    const expense = coa.result.accounts.find((a) => a.category === "expense");
    assert.ok(expense);
    const created = call("expenses-create", { accountId: expense.id, amount: 18, date: "2026-11-03", vendor: "QA shop", memo: "bolts" });
    assert.equal(created.ok, true);
    assert.equal(created.result.expense.status, "posted");
    const updated = call("expenses-update", { id: created.result.expense.id, memo: "bolts and washers" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.entry, null);
    assert.equal(updated.result.expense.memo, "bolts and washers");
    const voided = call("expenses-void", { id: created.result.expense.id });
    assert.equal(voided.ok, true);
    assert.equal(voided.result.expense.status, "void");
    assert.ok(voided.result.reversal.id);
    const rows = call("expenses-list").result.expenses;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "void");
  });
});
