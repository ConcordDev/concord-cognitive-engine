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

describe("accounting.invoice-list", () => {
  it("returns invoices sorted by issuedAt desc, scoped per user", () => {
    call("coa-list", ctxA);
    call("invoice-create", ctxA, { customerName: "Old Co", total: 100, issuedAt: "2026-01-01" });
    call("invoice-create", ctxA, { customerName: "New Co", total: 200, issuedAt: "2026-05-01" });
    const r = call("invoice-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.invoices.length, 2);
    assert.equal(r.result.invoices[0].customerName, "New Co");
    assert.equal(call("invoice-list", ctxB, {}).result.invoices.length, 0);
  });

  it("filters by status when requested", () => {
    call("coa-list", ctxA);
    const open = call("invoice-create", ctxA, { customerName: "Open", total: 100 });
    const paid = call("invoice-create", ctxA, { customerName: "Paid", total: 50 });
    call("invoice-mark-paid", ctxA, { id: paid.result.invoice.id });
    void open;
    assert.equal(call("invoice-list", ctxA, { status: "open" }).result.invoices.length, 1);
    assert.equal(call("invoice-list", ctxA, { status: "paid" }).result.invoices.length, 1);
    assert.equal(call("invoice-list", ctxA, { status: "all" }).result.invoices.length, 2);
  });
});

describe("accounting.invoice-create-payment-link (real Stripe)", () => {
  it("returns error pointing to STRIPE_SECRET_KEY when env not set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 250 });
    const r = await call("invoice-create-payment-link", ctxA, { id: inv.result.invoice.id, customerEmail: "x@example.com" });
    assert.equal(r.ok, false);
    assert.match(r.error, /STRIPE_SECRET_KEY/);
  });

  it("rejects when invoice is already paid", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 250 });
    call("invoice-mark-paid", ctxA, { id: inv.result.invoice.id });
    const r = await call("invoice-create-payment-link", ctxA, { id: inv.result.invoice.id, customerEmail: "x@example.com" });
    assert.equal(r.ok, false);
    assert.match(r.error, /already paid/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("rejects without customerEmail", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 100 });
    const r = await call("invoice-create-payment-link", ctxA, { id: inv.result.invoice.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /customerEmail/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("makes real Stripe REST calls (customer → invoiceitem → invoice → finalize)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: opts?.body, hasAuth: opts?.headers?.Authorization?.startsWith("Bearer ") });
      if (url.endsWith("/customers")) {
        return { ok: true, json: async () => ({ id: "cus_test123" }) };
      }
      if (url.endsWith("/invoiceitems")) {
        return { ok: true, json: async () => ({ id: "ii_test456" }) };
      }
      if (url.endsWith("/invoices")) {
        return { ok: true, json: async () => ({ id: "in_test789" }) };
      }
      if (url.endsWith("/invoices/in_test789/finalize")) {
        return {
          ok: true,
          json: async () => ({
            id: "in_test789",
            hosted_invoice_url: "https://invoice.stripe.com/i/abc123",
            invoice_pdf: "https://pay.stripe.com/i/abc123/pdf",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: "unknown" } }) };
    };
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "Acme", total: 1500 });
    const r = await call("invoice-create-payment-link", ctxA, { id: inv.result.invoice.id, customerEmail: "billing@acme.com" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hostedUrl, "https://invoice.stripe.com/i/abc123");
    assert.equal(r.result.pdfUrl, "https://pay.stripe.com/i/abc123/pdf");
    assert.equal(r.result.stripeInvoiceId, "in_test789");
    assert.equal(calls.length, 4);
    // All requests bearer-authed
    for (const c of calls) assert.equal(c.hasAuth, true);
    // Invoice metadata carries the concord IDs
    const itemBody = calls[1].body;
    assert.match(itemBody, /customer=cus_test123/);
    // Stripe IDs persisted on the local invoice
    const updated = call("invoice-list", ctxA, {}).result.invoices.find((i) => i.id === inv.result.invoice.id);
    assert.equal(updated.stripeInvoiceId, "in_test789");
    assert.equal(updated.stripeHostedInvoiceUrl, "https://invoice.stripe.com/i/abc123");
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("surfaces Stripe API failures clearly", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_bad";
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API Key" } }),
    });
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 100 });
    const r = await call("invoice-create-payment-link", ctxA, { id: inv.result.invoice.id, customerEmail: "x@example.com" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid API Key|stripe/i);
    delete process.env.STRIPE_SECRET_KEY;
  });
});

describe("accounting.invoice-webhook-mark-paid", () => {
  it("marks the local invoice paid via stripeInvoiceId match", () => {
    call("coa-list", ctxA);
    const inv = call("invoice-create", ctxA, { customerName: "X", total: 100 });
    // Simulate what invoice-create-payment-link would store
    const stored = globalThis._concordSTATE.accountingLens.invoices.get("user_a").find((i) => i.id === inv.result.invoice.id);
    stored.stripeInvoiceId = "in_webhook_test";
    const r = call("invoice-webhook-mark-paid", ctxA, { stripeInvoiceId: "in_webhook_test", userId: "user_a" });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.status, "paid");
    assert.equal(r.result.invoice.paidVia, "stripe");
  });

  it("returns error when no local invoice matches", () => {
    call("coa-list", ctxA);
    const r = call("invoice-webhook-mark-paid", ctxA, { stripeInvoiceId: "in_does_not_exist", userId: "user_a" });
    assert.equal(r.ok, false);
  });
});
