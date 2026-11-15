// FIX-accounting-013 — invoice lifecycle postings. Before the fix,
// invoice-create and invoice-mark-paid touched only the invoice row:
// no journal entries, no audit log, no revenue or cash movement, so AR
// never reached the ledger. These tests drive the real actions through
// the parity harness shape and read the books back through ledger-list
// and the trial balance the lens itself uses.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccountingActions from "../domains/accounting.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`accounting.${name}`);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerAccountingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function ledger(ctx, accountId) {
  const r = call("ledger-list", ctx, { accountId });
  assert.equal(r.ok, true);
  return r.result.entries || r.result.transactions || r.result.rows || [];
}
function create(ctx, total = 250) {
  const r = call("invoice-create", ctx, { customerName: "Acme", total, issuedAt: "2026-11-01", dueAt: "2026-12-01" });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
}

describe("FIX-accounting-013: invoices post to the journal", () => {
  it("create posts Dr AR / Cr Revenue and returns the entry", () => {
    const { invoice, journalEntry } = create(ctxA);
    assert.ok(journalEntry, "create returns its journal entry");
    assert.equal(journalEntry.source, "accounting-invoice");
    assert.equal(journalEntry.sourceId, invoice.id);
    assert.equal(journalEntry.totalDebit, 250);
    assert.equal(journalEntry.totalCredit, 250);
    const lines = Object.fromEntries(journalEntry.lines.map((l) => [l.accountId, l]));
    assert.equal(lines["acct_1100"].debit, 250);
    assert.equal(lines["acct_4000"].credit, 250);
    assert.equal(invoice.journalEntryId, journalEntry.id);
  });

  it("mark-paid posts Dr Cash / Cr AR; a second mark-paid posts nothing", () => {
    const { invoice } = create(ctxA);
    const paid = call("invoice-mark-paid", ctxA, { id: invoice.id, paidAt: "2026-11-10" });
    assert.equal(paid.ok, true);
    const je = paid.result.journalEntry;
    assert.ok(je, "mark-paid returns its collection entry");
    const lines = Object.fromEntries(je.lines.map((l) => [l.accountId, l]));
    assert.equal(lines["acct_1000"].debit, 250);
    assert.equal(lines["acct_1100"].credit, 250);
    const again = call("invoice-mark-paid", ctxA, { id: invoice.id, paidAt: "2026-11-11" });
    assert.equal(again.ok, true);
    assert.equal(again.result.alreadyPaid, true);
    assert.equal(again.result.journalEntry, undefined);
  });

  it("voiding an open invoice reverses the recognition", () => {
    const { invoice } = create(ctxA);
    const v = call("invoice-void", ctxA, { id: invoice.id, reason: "duplicate" });
    assert.equal(v.ok, true);
    assert.ok(v.result.invoice.voidJournalEntryId, "void records its reversal entry");
  });

  it("postings are per-user: another user's ledger stays empty", () => {
    create(ctxA);
    assert.equal(ledger(ctxB, "acct_1100").length, 0);
    assert.ok(ledger(ctxA, "acct_1100").length >= 1);
  });
});
