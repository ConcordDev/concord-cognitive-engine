// Finance → Books handoff, on the real domain pair.
//
// The Finance lens persists an ingested transaction in STATE.financeLens.ledger
// and saves it as a DTU. Accounting's `je-post` then persists a balanced
// double-entry journal entry that NAMES that DTU and the Finance row it came
// from. `ledger-list` reads both back, so a reload and a process restart both
// show the same entry.
//
// Nothing here moves money. No wallet macro is on this path.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFinanceActions from "../domains/finance.js";
import registerAccountingActions from "../domains/accounting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, domain, type: "domain_action", data: params, meta: {} }, params);
}

before(() => {
  registerFinanceActions(register);
  registerAccountingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/** Ingest a Finance ledger row and read it back, the way the feed does. */
function ingest(ctx, description, amount, category) {
  const r = call("finance", "transactions-ingest", ctx, { description, amount, category, date: "2026-10-04" });
  assert.equal(r.ok, true);
  const id = r.result.transaction.id;
  const listed = call("finance", "transactions-list", ctx, { limit: 50 });
  const row = listed.result.transactions.find((t) => t.id === id);
  assert.ok(row, `ingested row ${id} not readable back`);
  return row;
}

/**
 * Save a Finance row as a DTU in the real store, so `je-post` has something
 * to resolve. Mirrors what dtu.create persists for the feed's ledger entries.
 */
function saveAsDtu(userId, row) {
  const id = `dtu_fin_${row.id}`;
  globalThis._concordSTATE.dtus.set(id, {
    id,
    tier: "regular",
    machine: { kind: "ledger_entry", date: row.date, description: row.description, amount: row.amount },
    creator_id: userId,
    source: "finance-lens:ledger-entry",
  });
  return id;
}

describe("finance ledger row to accounting books", () => {
  it("carries the DTU cite and the finance row id through the post", () => {
    const row = ingest(ctxA, "Blue Bottle Coffee", -4.2, "Dining");

    // The books must have a cash account to post against; seedDefaultCoA runs
    // on the first coa-list call for this user.
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    assert.ok(cash && expense, "default chart of accounts must seed cash and an expense");
    const dtuId = saveAsDtu("user_a", row);

    const posted = call("accounting", "je-post", ctxA, {
      date: row.date,
      memo: row.description,
      citedDtuId: dtuId,
      source: "finance-ledger-entry",
      sourceId: row.id,
      lines: [
        { accountId: expense.id, debit: 4.2, credit: 0, memo: row.description },
        { accountId: cash.id, debit: 0, credit: 4.2, memo: row.description },
      ],
    });
    assert.equal(posted.ok, true);
    const entry = posted.result.entry;
    assert.equal(entry.number, "JE-00001");
    assert.equal(entry.citedDtuId, dtuId);
    assert.equal(entry.source, "finance-ledger-entry");
    assert.equal(entry.sourceId, row.id);
    assert.equal(entry.totalDebit, 4.2);
    assert.equal(entry.totalCredit, 4.2);

    const ledger = call("accounting", "ledger-list", ctxA, { limit: 50 });
    assert.equal(ledger.result.total, 2);
    for (const r of ledger.result.rows) {
      assert.equal(r.citedDtuId, dtuId);
      assert.equal(r.source, "finance-ledger-entry");
      assert.equal(r.sourceId, row.id);
    }

    // The audit trail names the provenance, not just the amount.
    const audit = globalThis._concordSTATE.accountingLens.auditLog.get("user_a");
    assert.ok(audit.some((a) => a.summary.includes(dtuId)), "audit must name the cited DTU");

    // Another user sees neither the entry nor the finance row.
    assert.equal(call("accounting", "ledger-list", ctxB, { limit: 50 }).result.total, 0);
  });

  it("refuses a post whose cite is not a DTU id", () => {
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    const before = call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total;
    const r = call("accounting", "je-post", ctxA, {
      citedDtuId: "not an id",
      lines: [
        { accountId: expense.id, debit: 1, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 1 },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "citedDtuId invalid");
    assert.equal(call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total, before);
  });

  it("refuses a cite that resolves to no DTU", () => {
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    const before = call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total;
    const r = call("accounting", "je-post", ctxA, {
      citedDtuId: "dtu_never_existed",
      source: "finance-ledger-entry",
      lines: [
        { accountId: expense.id, debit: 1, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 1 },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cited DTU not found: dtu_never_existed");
    assert.equal(call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total, before);
  });

  it("refuses a cite owned by somebody else", () => {
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    globalThis._concordSTATE.dtus.set("dtu_bells", { id: "dtu_bells", creator_id: "user_b", machine: { kind: "ledger_entry" } });
    const before = call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total;
    const r = call("accounting", "je-post", ctxA, {
      citedDtuId: "dtu_bells",
      source: "finance-ledger-entry",
      lines: [
        { accountId: expense.id, debit: 1, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 1 },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cited DTU not owned by caller");
    assert.equal(call("accounting", "ledger-list", ctxA, { limit: 50 }).result.total, before);
  });

  it("still refuses an unbalanced entry from finance", () => {
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    const row = ingest(ctxA, "Unbalanced attempt", 4.2, "Dining");
    const r = call("accounting", "je-post", ctxA, {
      citedDtuId: saveAsDtu("user_a", row),
      source: "finance-ledger-entry",
      lines: [
        { accountId: expense.id, debit: 4.2, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 1 },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /^unbalanced/);
  });

  it("leaves a hand-built entry without a cite", () => {
    const coa = call("accounting", "coa-list", ctxA).result.accounts;
    const cash = coa.find((a) => a.code === "1000");
    const expense = coa.find((a) => a.category === "expense");
    const r = call("accounting", "je-post", ctxA, {
      memo: "no provenance",
      lines: [
        { accountId: expense.id, debit: 2, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 2 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.citedDtuId, null);
    assert.equal(r.result.entry.source, "accounting-workbench");
    const rows = call("accounting", "ledger-list", ctxA, { limit: 50 }).result.rows
      .filter((x) => x.memo === "no provenance");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].citedDtuId, null);
    assert.equal(rows[0].source, "accounting-workbench");
  });

  it("keeps the finance ledger row separate from the books", () => {
    const row = ingest(ctxA, "Rent", -1800, "Bills");
    // The Finance row exists and knows nothing about the journal.
    assert.equal(row.amount, -1800);
    assert.equal(row.citedDtuId, undefined);
    const listed = call("finance", "transactions-list", ctxA, { limit: 100 });
    assert.ok(listed.result.transactions.some((t) => t.id === row.id));
    // Deleting the finance row does not touch what the books already hold.
    assert.equal(call("finance", "transactions-delete", ctxA, { id: row.id }).ok, true);
    assert.equal(call("finance", "transactions-list", ctxA, { limit: 100 })
      .result.transactions.some((t) => t.id === row.id), false);
  });
});