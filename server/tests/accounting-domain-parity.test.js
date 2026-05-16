// Tier-2 contract tests for accounting lens parity macros
// (chart-of-accounts / journal-entry / ledger / balance-sheet / AR aging).
// Pins double-entry invariant, per-user scoping, and posting validation.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccountingActions from "../domains/accounting.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`accounting.${name}`);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerAccountingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("accounting — chart of accounts", () => {
  it("seeds default 14-account CoA on first list", () => {
    const r = call("coa-list", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.accounts.length, 14);
    // Verify all 6 categories represented
    const categories = new Set(r.result.accounts.map((a) => a.category));
    assert.equal(categories.size, 6);
  });

  it("create rejects duplicate code", () => {
    call("coa-list", ctxA); // seed
    const r = call("coa-create", ctxA, { code: "1000", name: "Dup", category: "asset" });
    assert.equal(r.ok, false);
    assert.match(r.error, /already exists/);
  });

  it("create rejects invalid category", () => {
    const r = call("coa-create", ctxA, { code: "9000", name: "X", category: "bogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /category invalid/);
  });

  it("INVARIANT: CoA is scoped per-user (different default seeds don't leak)", () => {
    call("coa-list", ctxA);
    call("coa-create", ctxA, { code: "9999", name: "A-only", category: "asset" });
    const b = call("coa-list", ctxB);
    const aOnly = b.result.accounts.find((a) => a.code === "9999");
    assert.equal(aOnly, undefined);
  });

  it("archive flips state", () => {
    call("coa-list", ctxA);
    const a = call("coa-archive", ctxA, { id: "acct_1000" });
    assert.equal(a.result.account.archived, true);
    const b = call("coa-archive", ctxA, { id: "acct_1000" });
    assert.equal(b.result.account.archived, false);
  });
});

describe("accounting — journal entry posting", () => {
  beforeEach(() => {
    call("coa-list", ctxA); // seed
  });

  it("posts a balanced 2-line entry", () => {
    const r = call("je-post", ctxA, {
      date: "2026-05-16",
      memo: "Office supplies purchase",
      lines: [
        { accountId: "acct_6000", debit: 50, credit: 0, memo: "" },
        { accountId: "acct_1000", debit: 0, credit: 50, memo: "" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.totalDebit, 50);
    assert.equal(r.result.entry.totalCredit, 50);
    assert.match(r.result.entry.number, /^JE-\d{5}$/);
  });

  it("INVARIANT: rejects unbalanced entry (debits != credits)", () => {
    const r = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 100, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 50 },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unbalanced/);
  });

  it("rejects line with both debit and credit", () => {
    const r = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 100, credit: 100 },
        { accountId: "acct_1000", debit: 0, credit: 0 },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /both debit and credit/);
  });

  it("rejects unknown account id", () => {
    const r = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_NOTREAL", debit: 50, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 50 },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown account/);
  });

  it("rejects entries with fewer than 2 lines", () => {
    const r = call("je-post", ctxA, {
      lines: [{ accountId: "acct_6000", debit: 50, credit: 0 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2 lines/);
  });

  it("entry numbers auto-increment", () => {
    const r1 = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 10, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 10 },
      ],
    });
    const r2 = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 20, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 20 },
      ],
    });
    assert.equal(r1.result.entry.number, "JE-00001");
    assert.equal(r2.result.entry.number, "JE-00002");
  });
});

describe("accounting — ledger", () => {
  beforeEach(() => {
    call("coa-list", ctxA);
    call("je-post", ctxA, {
      date: "2026-05-01",
      lines: [
        { accountId: "acct_6000", debit: 100, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 100 },
      ],
    });
    call("je-post", ctxA, {
      date: "2026-05-10",
      lines: [
        { accountId: "acct_6100", debit: 500, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 500 },
      ],
    });
  });

  it("returns all rows across entries", () => {
    const r = call("ledger-list", ctxA);
    assert.equal(r.result.total, 4); // 2 entries × 2 lines each
  });

  it("filters by accountId", () => {
    const r = call("ledger-list", ctxA, { accountId: "acct_1000" });
    assert.equal(r.result.total, 2);
    for (const row of r.result.rows) {
      assert.equal(row.accountId, "acct_1000");
    }
  });

  it("INVARIANT: ledger scoped per-user", () => {
    const b = call("ledger-list", ctxB);
    assert.equal(b.result.total, 0);
  });
});

describe("accounting — balance sheet", () => {
  it("computed sheet balances after a posted entry", () => {
    call("coa-list", ctxA);
    // Owner contributes $10,000 cash to start the business
    call("je-post", ctxA, {
      date: "2026-05-01",
      lines: [
        { accountId: "acct_1000", debit: 10000, credit: 0, memo: "owner contribution" },
        { accountId: "acct_3000", debit: 0, credit: 10000, memo: "owner contribution" },
      ],
    });
    const r = call("balance-sheet-compute", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.balanced, true);
    assert.equal(r.result.totals.assets, 10000);
    assert.equal(r.result.totals.equity, 10000);
  });

  it("net income flows into equity (revenue - expense)", () => {
    call("coa-list", ctxA);
    // Sale of $1000 for cash; cost of goods $400
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_1000", debit: 1000, credit: 0 },
        { accountId: "acct_4000", debit: 0, credit: 1000 },
      ],
    });
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_5000", debit: 400, credit: 0 },
        { accountId: "acct_1200", debit: 0, credit: 400 },
      ],
    });
    const r = call("balance-sheet-compute", ctxA);
    const re = r.result.equity.find((e) => e.id === "computed_re");
    assert.equal(re.balance, 600); // 1000 revenue - 400 cogs = 600 net income
  });
});

describe("accounting — AR aging", () => {
  it("buckets invoices by days past due", () => {
    call("coa-list", ctxA);
    const today = new Date().toISOString().slice(0, 10);
    const d35Ago = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    const d100Ago = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
    call("invoice-create", ctxA, { customerName: "Current Co",  total: 100, issuedAt: today,    dueAt: today });
    call("invoice-create", ctxA, { customerName: "Late Co",     total: 200, issuedAt: d35Ago,   dueAt: d35Ago });
    call("invoice-create", ctxA, { customerName: "Very Late Co", total: 300, issuedAt: d100Ago, dueAt: d100Ago });
    const r = call("aging-ar", ctxA);
    assert.equal(r.result.totalOpen, 600);
    const byKey = Object.fromEntries(r.result.buckets.map((b) => [b.key, b.total]));
    assert.equal(byKey.current, 100);
    assert.equal(byKey.d30, 200);
    assert.equal(byKey.d90plus, 300);
  });

  it("excludes paid invoices", () => {
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 100, dueAt: "2026-01-01" });
    call("invoice-mark-paid", ctxA, { id: inv.result.invoice.id });
    const r = call("aging-ar", ctxA);
    assert.equal(r.result.totalOpen, 0);
  });

  it("INVARIANT: invoices scoped per-user", () => {
    call("invoice-create", ctxA, { customerName: "user A inv", total: 100 });
    const b = call("aging-ar", ctxB);
    assert.equal(b.result.totalOpen, 0);
  });
});

describe("accounting — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("coa-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
