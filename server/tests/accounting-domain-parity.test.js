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

describe("accounting — customers + vendors", () => {
  it("creates and lists customers per user", () => {
    call("coa-list", ctxA);
    const c1 = call("customers-create", ctxA, { name: "Acme Corp", email: "ap@acme.com" });
    assert.equal(c1.ok, true);
    assert.match(c1.result.customer.number, /^C-\d{4}$/);
    const c2 = call("customers-create", ctxA, { name: "Initech" });
    assert.notEqual(c1.result.customer.id, c2.result.customer.id);
    const list = call("customers-list", ctxA);
    assert.equal(list.result.customers.length, 2);
    // Other user isolated
    const listB = call("customers-list", ctxB);
    assert.equal(listB.result.customers.length, 0);
  });

  it("creates a 1099 vendor and stores tax id", () => {
    call("coa-list", ctxA);
    const r = call("vendors-create", ctxA, { name: "Designer Jane", is1099: true, taxId: "12-3456789", paymentTerms: "net15" });
    assert.equal(r.ok, true);
    assert.equal(r.result.vendor.is1099, true);
    assert.equal(r.result.vendor.paymentTerms, "net15");
  });
});

describe("accounting — bills (AP) flow", () => {
  it("creates a bill that auto-posts a balanced JE (expense, AP)", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "AWS" }).result.vendor;
    const rentExp = call("coa-list", ctxA).result.accounts.find(a => a.code === "6100");
    const b = call("bills-create", ctxA, { vendorId: v.id, total: 500, expenseAccountId: rentExp.id, memo: "May rent" });
    assert.equal(b.ok, true);
    assert.equal(b.result.bill.status, "open");
    // JE was posted
    const journal = globalThis._concordSTATE.accountingLens.journal.get("user_a") || [];
    const posted = journal.find(e => e.id === b.result.bill.jeEntryId);
    assert.ok(posted);
    assert.equal(posted.totalDebit, 500);
    assert.equal(posted.totalCredit, 500);
  });

  it("pays a bill — JE flips AP back to cash", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "Office Depot" }).result.vendor;
    const officeExp = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    const b = call("bills-create", ctxA, { vendorId: v.id, total: 120, expenseAccountId: officeExp.id }).result.bill;
    const pay = call("bills-pay", ctxA, { id: b.id });
    assert.equal(pay.ok, true);
    assert.equal(pay.result.bill.status, "paid");
    assert.ok(pay.result.bill.payJeEntryId);
  });

  it("aging-ap buckets unpaid bills past due", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "Old Vendor" }).result.vendor;
    const exp = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    const old = call("bills-create", ctxA, { vendorId: v.id, total: 200, expenseAccountId: exp.id, issuedAt: "2024-01-01", dueAt: "2024-01-31" }).result.bill;
    const r = call("aging-ap", ctxA, { asOf: "2024-06-01" });
    assert.equal(r.ok, true);
    const d90 = r.result.buckets.find(b => b.key === "d90plus");
    assert.equal(d90.bills.length, 1);
    assert.equal(d90.bills[0].id, old.id);
  });
});

describe("accounting — pl-compute (real, from journal)", () => {
  it("computes revenue/cogs/expense from posted JEs", () => {
    call("coa-list", ctxA);
    const coa = call("coa-list", ctxA).result.accounts;
    const cash = coa.find(a => a.code === "1000");
    const rev = coa.find(a => a.code === "4000");
    const cogs = coa.find(a => a.code === "5000");
    const office = coa.find(a => a.code === "6000");
    // Sales
    call("je-post", ctxA, { date: "2026-03-15", lines: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 1000 }] });
    // COGS
    call("je-post", ctxA, { date: "2026-03-16", lines: [{ accountId: cogs.id, debit: 300, credit: 0 }, { accountId: cash.id, debit: 0, credit: 300 }] });
    // Expense
    call("je-post", ctxA, { date: "2026-03-17", lines: [{ accountId: office.id, debit: 50, credit: 0 }, { accountId: cash.id, debit: 0, credit: 50 }] });
    const pl = call("pl-compute", ctxA, { start: "2026-01-01", end: "2026-12-31" });
    assert.equal(pl.ok, true);
    assert.equal(pl.result.revenue.total, 1000);
    assert.equal(pl.result.cogs.total, 300);
    assert.equal(pl.result.operatingExpenses.total, 50);
    assert.equal(pl.result.grossProfit, 700);
    assert.equal(pl.result.netIncome, 650);
  });
});

describe("accounting — runway forecast", () => {
  it("returns liquidity and projected months", () => {
    call("coa-list", ctxA);
    const coa = call("coa-list", ctxA).result.accounts;
    const cash = coa.find(a => a.code === "1000");
    const rev = coa.find(a => a.code === "4000");
    call("je-post", ctxA, { date: new Date().toISOString().slice(0, 10), lines: [{ accountId: cash.id, debit: 10000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 10000 }] });
    const r = call("runway-forecast", ctxA, { months: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.result.forecast.length, 6);
    assert.ok(r.result.cashOnHand >= 10000);
  });
});

describe("accounting — recurring invoices + estimates", () => {
  it("runs due recurring invoices and creates concrete invoices", () => {
    call("coa-list", ctxA);
    const r = call("recurring-invoices-create", ctxA, { customerName: "Monthly Co", total: 99, cadence: "monthly", startAt: "2020-01-01" });
    assert.equal(r.ok, true);
    const run = call("recurring-invoices-run-due", ctxA);
    assert.equal(run.ok, true);
    assert.equal(run.result.created.length, 1);
    assert.equal(run.result.created[0].total, 99);
  });

  it("converts estimate to invoice exactly once", () => {
    call("coa-list", ctxA);
    const e = call("estimates-create", ctxA, { customerName: "Lead Co", total: 250 }).result.estimate;
    const c1 = call("estimates-convert", ctxA, { id: e.id });
    assert.equal(c1.ok, true);
    assert.equal(c1.result.estimate.status, "accepted");
    assert.equal(c1.result.invoice.total, 250);
    // Second convert blocked
    const c2 = call("estimates-convert", ctxA, { id: e.id });
    assert.equal(c2.ok, false);
  });
});

describe("accounting — bank feeds + AI categorize", () => {
  it("imports bank txns and categorizes one — posts balanced JE", () => {
    call("coa-list", ctxA);
    const office = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    const imp = call("bank-feeds-import", ctxA, { description: "Staples Office Supplies", amount: -85, date: "2026-04-01" });
    assert.equal(imp.ok, true);
    const txnId = imp.result.imported[0].id;
    const cat = call("bank-feeds-categorize", ctxA, { txnId, accountId: office.id });
    assert.equal(cat.ok, true);
    assert.equal(cat.result.entry.totalDebit, 85);
    assert.equal(cat.result.entry.totalCredit, 85);
    // Lists move the txn out of uncategorized
    const uncat = call("bank-feeds-list", ctxA, { status: "uncategorized" });
    assert.equal(uncat.result.txns.length, 0);
  });

  it("ai-categorize-txn falls back to heuristics when no brain", async () => {
    call("coa-list", ctxA);
    const imp = call("bank-feeds-import", ctxA, { description: "AWS USE1 hosting charge", amount: -42 });
    const txnId = imp.result.imported[0].id;
    const r = await call("ai-categorize-txn", ctxA, { txnId });
    assert.equal(r.ok, true);
    assert.ok(r.result.suggestedAccountId);
    assert.match(r.result.source, /heuristic|rule|brain/);
  });

  it("category rule short-circuits ai-categorize", async () => {
    call("coa-list", ctxA);
    const office = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    call("category-rules-create", ctxA, { pattern: "staples", accountId: office.id });
    const imp = call("bank-feeds-import", ctxA, { description: "Staples #4421 receipt", amount: -19 });
    const r = await call("ai-categorize-txn", ctxA, { txnId: imp.result.imported[0].id });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "rule");
    assert.equal(r.result.suggestedAccountId, office.id);
  });
});

describe("accounting — expenses + 1099 summary", () => {
  it("expenses-create posts a balanced JE", () => {
    call("coa-list", ctxA);
    const exp = call("coa-list", ctxA).result.accounts.find(a => a.code === "6200");
    const r = call("expenses-create", ctxA, { accountId: exp.id, amount: 75, vendor: "PG&E", memo: "April electric" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.totalDebit, 75);
  });

  it("summary-1099 only includes 1099 vendors past threshold", () => {
    call("coa-list", ctxA);
    const v1 = call("vendors-create", ctxA, { name: "Contractor", is1099: true, taxId: "11-1111111" }).result.vendor;
    const v2 = call("vendors-create", ctxA, { name: "RegularCo", is1099: false }).result.vendor;
    const exp = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    const year = new Date().getFullYear();
    const today = nowIsoUtility();
    const b1 = call("bills-create", ctxA, { vendorId: v1.id, total: 700, expenseAccountId: exp.id, issuedAt: today, dueAt: today }).result.bill;
    call("bills-pay", ctxA, { id: b1.id, paidAt: today });
    const b2 = call("bills-create", ctxA, { vendorId: v2.id, total: 5000, expenseAccountId: exp.id }).result.bill;
    call("bills-pay", ctxA, { id: b2.id, paidAt: today });
    const r = call("summary-1099", ctxA, { year });
    assert.equal(r.ok, true);
    assert.equal(r.result.vendors.length, 1);
    assert.equal(r.result.vendors[0].vendorName, "Contractor");
    assert.equal(r.result.vendors[0].reportable, true);
  });
});

describe("accounting — dashboard-summary", () => {
  it("returns KPI snapshot", () => {
    call("coa-list", ctxA);
    const r = call("dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.ok("cashOnHand" in r.result);
    assert.ok("openInvTotal" in r.result);
    assert.ok("ytdNetIncome" in r.result);
    assert.ok("uncategorizedTxns" in r.result);
  });
});

function nowIsoUtility() { return new Date().toISOString().slice(0, 10); }

describe("accounting — 2026 AI features", () => {
  it("ai-categorize-txn returns a confidence score", async () => {
    call("coa-list", ctxA);
    const imp = call("bank-feeds-import", ctxA, { description: "Staples Office", amount: -25 });
    const r = await call("ai-categorize-txn", ctxA, { txnId: imp.result.imported[0].id });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.confidence, "number");
    assert.ok(r.result.confidence >= 0 && r.result.confidence <= 1);
  });

  it("bank-feeds-bulk-suggest returns a suggestion per uncategorized txn", async () => {
    call("coa-list", ctxA);
    call("bank-feeds-import", ctxA, { description: "AWS hosting", amount: -50 });
    call("bank-feeds-import", ctxA, { description: "Starbucks #1234", amount: -8 });
    call("bank-feeds-import", ctxA, { description: "Client deposit", amount: 1000 });
    const r = await call("bank-feeds-bulk-suggest", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestions.length, 3);
    assert.equal(r.result.totalUncategorized, 3);
    assert.ok(r.result.highConfidenceCount >= 0);
    for (const s of r.result.suggestions) {
      assert.ok(s.suggestedAccountId);
      assert.equal(typeof s.confidence, "number");
    }
  });

  it("bank-feeds-bulk-accept categorizes a batch in one call", () => {
    call("coa-list", ctxA);
    const office = call("coa-list", ctxA).result.accounts.find(a => a.code === "6000");
    const imp1 = call("bank-feeds-import", ctxA, { description: "Office A", amount: -10 });
    const imp2 = call("bank-feeds-import", ctxA, { description: "Office B", amount: -20 });
    const r = call("bank-feeds-bulk-accept", ctxA, {
      picks: [
        { txnId: imp1.result.imported[0].id, accountId: office.id },
        { txnId: imp2.result.imported[0].id, accountId: office.id },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.accepted, 2);
    assert.equal(r.result.errors.length, 0);
  });

  it("ai-suggest-vendor matches existing vendor by name", () => {
    call("coa-list", ctxA);
    call("vendors-create", ctxA, { name: "AWS" });
    const r = call("ai-suggest-vendor", ctxA, { description: "AWS USE1 hosting charge" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, true);
    assert.equal(r.result.vendorName, "AWS");
  });

  it("ai-suggest-vendor suggests a new-vendor name when nothing matches", () => {
    call("coa-list", ctxA);
    const r = call("ai-suggest-vendor", ctxA, { description: "MysteryCorp purchase 4291" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, false);
    assert.ok(r.result.suggestedNewVendor);
  });

  it("ask routes 'overdue' to deterministic answer with data", async () => {
    call("coa-list", ctxA);
    // create one overdue invoice (due 2020 in 2026 will be very overdue)
    call("invoice-create", ctxA, { customerName: "OverdueCo", total: 500, issuedAt: "2020-01-01", dueAt: "2020-02-01" });
    const r = await call("ask", ctxA, { question: "show me overdue invoices" });
    assert.equal(r.ok, true);
    assert.equal(r.result.intent, "overdue_invoices");
    assert.equal(r.result.data.invoices.length, 1);
    assert.match(r.result.answer, /1 overdue invoice/);
  });

  it("ask routes 'how much cash' to cash balance", async () => {
    call("coa-list", ctxA);
    const coa = call("coa-list", ctxA).result.accounts;
    const cash = coa.find(a => a.code === "1000");
    const rev = coa.find(a => a.code === "4000");
    call("je-post", ctxA, { date: "2026-04-01", lines: [{ accountId: cash.id, debit: 2500, credit: 0 }, { accountId: rev.id, debit: 0, credit: 2500 }] });
    const r = await call("ask", ctxA, { question: "how much cash do we have" });
    assert.equal(r.ok, true);
    assert.equal(r.result.intent, "cash_balance");
    assert.equal(r.result.data.cashOnHand, 2500);
  });

  it("ask falls back to general snapshot when no intent matches", async () => {
    call("coa-list", ctxA);
    const r = await call("ask", ctxA, { question: "what's the weather like" });
    assert.equal(r.ok, true);
    assert.equal(r.result.intent, "general");
    assert.ok(r.result.answer);
  });
});

describe("accounting — payroll", () => {
  it("creates employees and runs payroll with withholdings", () => {
    const emp = call("employee-create", ctxA, { name: "Pat Dev", payType: "salary", rate: 120000 }).result.employee;
    const run = call("payrun-create", ctxA, {
      periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-16",
      lines: [{ employeeId: emp.id }],
    }).result.run;
    assert.equal(run.stubs.length, 1);
    assert.equal(run.totalGross, 5000);            // 120000 / 24
    assert.ok(run.totalWithholding > 0 && run.totalNet < run.totalGross);
    assert.ok(run.journalEntryId);
    assert.equal(call("payroll-summary", ctxA, {}).result.runs, 1);
  });

  it("computes hourly gross from hours", () => {
    const emp = call("employee-create", ctxA, { name: "Sam Hourly", payType: "hourly", rate: 40 }).result.employee;
    const run = call("payrun-create", ctxA, { lines: [{ employeeId: emp.id, hours: 80 }] }).result.run;
    assert.equal(run.stubs[0].gross, 3200);
  });

  it("isolates payroll per user", () => {
    call("employee-create", ctxA, { name: "X", rate: 1000 });
    assert.equal(call("employee-list", ctxB, {}).result.count, 0);
  });
});

describe("accounting — budgets", () => {
  it("tracks budget vs actual from the journal", () => {
    const userId = ctxA;
    call("coa-create", userId, { code: "6900", name: "Marketing", category: "expense" });
    const acct = call("coa-list", userId, {}).result.accounts.find((a) => a.code === "6900");
    const cash = call("coa-list", userId, {}).result.accounts.find((a) => a.code === "1000");
    const yr = new Date().getUTCFullYear();
    call("je-post", userId, {
      date: `${yr}-03-01`, memo: "ad spend",
      lines: [{ accountId: acct.id, debit: 800 }, { accountId: cash.id, credit: 800 }],
    });
    const b = call("budget-create", userId, { name: "FY budget", fiscalYear: yr }).result.budget;
    call("budget-set-line", userId, { budgetId: b.id, accountId: acct.id, annualAmount: 1000 });
    const bva = call("budget-vs-actual", userId, { budgetId: b.id });
    const row = bva.result.rows.find((r) => r.accountId === acct.id);
    assert.equal(row.budgeted, 1000);
    assert.equal(row.actual, 800);
    assert.equal(row.variance, -200);
  });
});

describe("accounting — inventory", () => {
  it("tracks stock and flags low inventory", () => {
    const item = call("item-create", ctxA, {
      name: "Widget", type: "inventory", price: 25, cost: 10, qtyOnHand: 5, reorderPoint: 8,
    }).result.item;
    assert.equal(item.qtyOnHand, 5);
    const low = call("inventory-low-stock", ctxA, {});
    assert.equal(low.result.count, 1);
    call("item-adjust-stock", ctxA, { id: item.id, delta: 20 });
    assert.equal(call("inventory-low-stock", ctxA, {}).result.count, 0);
  });

  it("rejects stock adjustment on a service item", () => {
    const item = call("item-create", ctxA, { name: "Consulting", type: "service", price: 150 }).result.item;
    assert.equal(call("item-adjust-stock", ctxA, { id: item.id, delta: 1 }).ok, false);
  });
});

describe("accounting — sales tax", () => {
  it("records a tax payment that reduces the liability", () => {
    const userId = ctxA;
    call("coa-list", userId, {});
    const tax = call("coa-list", userId, {}).result.accounts.find((a) => a.code === "2100");
    const cash = call("coa-list", userId, {}).result.accounts.find((a) => a.code === "1000");
    call("je-post", userId, {
      memo: "collected tax",
      lines: [{ accountId: cash.id, debit: 300 }, { accountId: tax.id, credit: 300 }],
    });
    assert.equal(call("tax-liability", userId, {}).result.salesTaxPayable, 300);
    call("tax-payment-record", userId, { amount: 300 });
    assert.equal(call("tax-liability", userId, {}).result.salesTaxPayable, 0);
  });

  it("manages tax codes", () => {
    const c = call("tax-code-create", ctxA, { name: "CA", rate: 8.5 }).result.taxCode;
    assert.equal(call("tax-code-list", ctxA, {}).result.count, 1);
    call("tax-code-delete", ctxA, { id: c.id });
    assert.equal(call("tax-code-list", ctxA, {}).result.count, 0);
  });
});

describe("accounting — purchase orders", () => {
  it("creates a PO and receives it into a bill", () => {
    const v = call("vendors-create", ctxA, { name: "Supplier Co" }).result.vendor;
    const po = call("po-create", ctxA, {
      vendorId: v.id, lines: [{ description: "Parts", qty: 10, unitCost: 12 }],
    }).result.purchaseOrder;
    assert.equal(po.total, 120);
    const rec = call("po-receive", ctxA, { id: po.id });
    assert.equal(rec.result.bill.amount, 120);
    assert.equal(rec.result.purchaseOrder.status, "received");
    assert.equal(call("po-receive", ctxA, { id: po.id }).ok, false);
  });
});

describe("accounting — financial ratios", () => {
  it("computes ratios from the ledger", () => {
    const userId = ctxA;
    const accts = call("coa-list", userId, {}).result.accounts;
    const cash = accts.find((a) => a.code === "1000");
    const equity = accts.find((a) => a.code === "3000");
    call("je-post", userId, {
      memo: "capital", lines: [{ accountId: cash.id, debit: 10000 }, { accountId: equity.id, credit: 10000 }],
    });
    const r = call("financial-ratios", userId, {});
    assert.equal(r.result.totals.currentAssets, 10000);
    assert.ok(r.result.workingCapital === 10000);
  });
});

// ════════════════════════════════════════════════════════════════════
//  2026 PARITY BACKLOG — QuickBooks Online feature gaps
// ════════════════════════════════════════════════════════════════════

async function callAsync(name, ctx, params = {}) {
  const fn = ACTIONS.get(`accounting.${name}`);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

describe("accounting — [M] live bank feed aggregator", () => {
  it("links an institution and lists it scoped per-user", () => {
    const r = call("bank-feeds-link-institution", ctxA, { name: "Chase Business", accountMask: "4421" });
    assert.equal(r.ok, true);
    assert.match(r.result.institution.id, /^inst_/);
    const list = call("bank-feeds-institutions-list", ctxA);
    assert.equal(list.result.institutions.length, 1);
    assert.equal(call("bank-feeds-institutions-list", ctxB).result.institutions.length, 0);
  });

  it("link rejects empty name", () => {
    const r = call("bank-feeds-link-institution", ctxA, { name: "" });
    assert.equal(r.ok, false);
  });

  it("unlinks an institution", () => {
    const i = call("bank-feeds-link-institution", ctxA, { name: "Wells Fargo" }).result.institution;
    const r = call("bank-feeds-unlink-institution", ctxA, { id: i.id });
    assert.equal(r.ok, true);
    assert.equal(call("bank-feeds-institutions-list", ctxA).result.institutions.length, 0);
  });

  it("sync errors clearly when no aggregator configured", async () => {
    delete process.env.CONCORD_BANK_AGGREGATOR_URL;
    delete process.env.CONCORD_BANK_AGGREGATOR_TOKEN;
    const i = call("bank-feeds-link-institution", ctxA, { name: "Mercury" }).result.institution;
    const r = await callAsync("bank-feeds-sync", ctxA, { id: i.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /CONCORD_BANK_AGGREGATOR_URL/);
  });

  it("sync pulls real transactions from a configured aggregator", async () => {
    process.env.CONCORD_BANK_AGGREGATOR_URL = "https://agg.example.com";
    process.env.CONCORD_BANK_AGGREGATOR_TOKEN = "tok_test";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ transactions: [
        { id: "ext_1", date: "2026-05-01", amount: -42.5, description: "Coffee" },
        { id: "ext_2", date: "2026-05-02", amount: 1000, description: "Client" },
      ] }),
    });
    const i = call("bank-feeds-link-institution", ctxA, { name: "Mercury", externalAccountId: "acc_99" }).result.institution;
    const r = await callAsync("bank-feeds-sync", ctxA, { id: i.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    // Idempotent — re-sync dedupes by externalId.
    const r2 = await callAsync("bank-feeds-sync", ctxA, { id: i.id });
    assert.equal(r2.result.imported, 0);
    delete process.env.CONCORD_BANK_AGGREGATOR_URL;
    delete process.env.CONCORD_BANK_AGGREGATOR_TOKEN;
  });
});

describe("accounting — [M] multi-currency + FX revaluation", () => {
  it("defaults to USD base and sets a new base", () => {
    assert.equal(call("currency-list", ctxA).result.base, "USD");
    const r = call("currency-set-base", ctxA, { base: "eur" });
    assert.equal(r.ok, true);
    assert.equal(r.result.base, "EUR");
    assert.equal(call("currency-list", ctxA).result.base, "EUR");
  });

  it("rejects an invalid base currency code", () => {
    assert.equal(call("currency-set-base", ctxA, { base: "EURO" }).ok, false);
  });

  it("refreshes FX rates from the free keyless provider", async () => {
    try { (await import("../lib/external-fetch.js")).clearExternalFetchCache(); } catch { /* ignore */ }
    globalThis.fetch = async (url) => {
      assert.match(String(url), /open\.er-api\.com/);
      return { ok: true, json: async () => ({ rates: { EUR: 0.92, GBP: 0.79 }, time_last_update_utc: "x" }) };
    };
    const r = await callAsync("currency-refresh-rates", ctxA, { symbols: ["EUR", "GBP"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.updated, 2);
    assert.equal(call("currency-list", ctxA).result.rates.length, 2);
  });

  it("computes unrealized gain/loss from booked vs current rate", async () => {
    // Clear the external-fetch URL cache so this refresh isn't served a
    // stale rate from a prior test in the same process.
    try { (await import("../lib/external-fetch.js")).clearExternalFetchCache(); } catch { /* ignore */ }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ rates: { EUR: 1.0 } }) });
    await callAsync("currency-refresh-rates", ctxA, { symbols: ["EUR"] });
    // 920 EUR booked at 0.92 → $1000 book; current 1.0 → $920 → $80 loss.
    const r = call("fx-revaluation", ctxA, {
      positions: [{ label: "EUR cash", currency: "EUR", foreignBalance: 920, bookedRate: 0.92 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.lines[0].gainLoss, -80);
    assert.equal(r.result.totalUnrealizedGainLoss, -80);
    assert.equal(r.result.direction, "loss");
  });

  it("revaluation errors when no current rate is known", () => {
    const r = call("fx-revaluation", ctxB, {
      positions: [{ currency: "JPY", foreignBalance: 1000, bookedRate: 150 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /no current rate/);
  });
});

describe("accounting — [M] dimensional tagging + segment P&L", () => {
  it("creates dimensions and tags a journal entry", () => {
    call("coa-list", ctxA);
    const dim = call("dimension-create", ctxA, { kind: "project", name: "Apollo" });
    assert.equal(dim.ok, true);
    const je = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_4000", debit: 0, credit: 500 },
        { accountId: "acct_1000", debit: 500, credit: 0 },
      ],
    }).result.entry;
    const tag = call("je-tag-dimension", ctxA, { entryId: je.id, dimensionId: dim.result.dimension.id });
    assert.equal(tag.ok, true);
    assert.equal(tag.result.entry.dimensions[0].name, "Apollo");
  });

  it("rejects an invalid dimension kind", () => {
    assert.equal(call("dimension-create", ctxA, { kind: "bogus", name: "X" }).ok, false);
  });

  it("rejects a duplicate dimension", () => {
    call("dimension-create", ctxA, { kind: "class", name: "Retail" });
    assert.equal(call("dimension-create", ctxA, { kind: "class", name: "retail" }).ok, false);
  });

  it("segment-pl slices revenue/expense by dimension value", () => {
    call("coa-list", ctxA);
    const dim = call("dimension-create", ctxA, { kind: "location", name: "West" }).result.dimension;
    const today = new Date().toISOString().slice(0, 10);
    const je = call("je-post", ctxA, {
      date: today,
      lines: [
        { accountId: "acct_4000", debit: 0, credit: 2000 },
        { accountId: "acct_1000", debit: 2000, credit: 0 },
      ],
    }).result.entry;
    call("je-tag-dimension", ctxA, { entryId: je.id, dimensionId: dim.id });
    const r = call("segment-pl", ctxA, { kind: "location" });
    assert.equal(r.ok, true);
    const west = r.result.segments.find((s) => s.segment === "West");
    assert.equal(west.revenue, 2000);
    assert.equal(west.netIncome, 2000);
  });
});

describe("accounting — [L] payroll tax e-filing + ACH", () => {
  it("prepares a Form 941 from posted pay runs", () => {
    const emp = call("employee-create", ctxA, { name: "Pat Dev", payType: "salary", rate: 120000 }).result.employee;
    const q = Math.floor(new Date().getUTCMonth() / 3) + 1;
    const y = new Date().getUTCFullYear();
    call("payrun-create", ctxA, {
      periodStart: `${y}-01-01`, periodEnd: `${y}-01-15`, payDate: new Date().toISOString().slice(0, 10),
      lines: [{ employeeId: emp.id }],
    });
    const r = call("payroll-tax-efile", ctxA, { quarter: q, year: y });
    assert.equal(r.ok, true);
    assert.equal(r.result.filing.form, "941");
    assert.ok(r.result.filing.totalTaxLiability > 0);
    assert.match(r.result.filing.status, /prepared|ready/);
  });

  it("rejects an invalid quarter", () => {
    call("employee-create", ctxA, { name: "X", rate: 1000 });
    call("payrun-create", ctxA, { lines: [{ employeeId: call("employee-list", ctxA).result.employees?.[0]?.id || "x" }] });
    const r = call("payroll-tax-efile", ctxA, { quarter: 9 });
    assert.equal(r.ok, false);
  });

  it("prepares an ACH batch from a pay run", () => {
    const emp = call("employee-create", ctxA, { name: "Sam", payType: "hourly", rate: 40 }).result.employee;
    const run = call("payrun-create", ctxA, { lines: [{ employeeId: emp.id, hours: 80 }] }).result.run;
    const r = call("payroll-ach-batch", ctxA, { runId: run.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.batch.entryCount, 1);
    assert.ok(r.result.batch.totalNet > 0);
  });

  it("ACH batch errors when run not found", () => {
    assert.equal(call("payroll-ach-batch", ctxA, { runId: "nope" }).ok, false);
  });
});

describe("accounting — [S] recurring bill scheduling", () => {
  it("schedules and runs a recurring bill into a real bill + JE", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "Landlord" }).result.vendor;
    const rent = call("coa-list", ctxA).result.accounts.find((a) => a.code === "6100");
    const r = call("recurring-bills-create", ctxA, {
      vendorId: v.id, expenseAccountId: rent.id, total: 1500, cadence: "monthly", startAt: "2020-01-01",
    });
    assert.equal(r.ok, true);
    const run = call("recurring-bills-run-due", ctxA);
    assert.equal(run.ok, true);
    assert.equal(run.result.created.length, 1);
    assert.equal(run.result.created[0].total, 1500);
    assert.ok(run.result.created[0].jeEntryId);
  });

  it("toggles and deletes a recurring bill", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "ISP" }).result.vendor;
    const acct = call("coa-list", ctxA).result.accounts.find((a) => a.code === "6200");
    const rb = call("recurring-bills-create", ctxA, { vendorId: v.id, expenseAccountId: acct.id, total: 80 }).result.recurringBill;
    assert.equal(call("recurring-bills-toggle", ctxA, { id: rb.id }).result.recurringBill.active, false);
    assert.equal(call("recurring-bills-delete", ctxA, { id: rb.id }).ok, true);
    assert.equal(call("recurring-bills-list", ctxA).result.recurringBills.length, 0);
  });
});

describe("accounting — [M] receipt OCR → expense", () => {
  const RECEIPT = "STAPLES #4421\n05/12/2026\nPrinter paper  12.99\nTAX  1.07\nTOTAL  14.06";

  it("parses real OCR text into vendor/date/total/tax", () => {
    const r = call("receipt-ocr", ctxA, { ocrText: RECEIPT });
    assert.equal(r.ok, true);
    assert.equal(r.result.parsed.total, 14.06);
    assert.equal(r.result.parsed.tax, 1.07);
    assert.equal(r.result.parsed.date, "2026-05-12");
    assert.equal(r.result.parsed.missing.length, 0);
  });

  it("rejects empty OCR text", () => {
    assert.equal(call("receipt-ocr", ctxA, { ocrText: "  " }).ok, false);
  });

  it("posts a parsed receipt as a balanced expense JE", () => {
    call("coa-list", ctxA);
    const acct = call("coa-list", ctxA).result.accounts.find((a) => a.code === "6000");
    const r = call("receipt-ocr-to-expense", ctxA, { ocrText: RECEIPT, accountId: acct.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.expense.amount, 14.06);
    assert.equal(r.result.entry.totalDebit, 14.06);
    assert.equal(r.result.entry.totalCredit, 14.06);
  });
});

describe("accounting — [S] per-transaction edit audit log", () => {
  it("records an audit entry when a journal entry posts", () => {
    call("coa-list", ctxA);
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 30, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 30 },
      ],
    });
    const r = call("audit-log-list", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.entries.some((e) => e.action === "je-post"));
  });

  it("filters the audit log by entity type and is per-user", () => {
    call("coa-list", ctxA);
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_6000", debit: 10, credit: 0 },
        { accountId: "acct_1000", debit: 0, credit: 10 },
      ],
    });
    const filtered = call("audit-log-list", ctxA, { entityType: "journal-entry" });
    assert.ok(filtered.result.entries.every((e) => e.entityType === "journal-entry"));
    assert.equal(call("audit-log-list", ctxB).result.entries.length, 0);
  });
});

describe("accounting — [M] 1099 / W-2 IRS FIRE export", () => {
  it("builds an IRS FIRE 1099-NEC file from paid 1099 vendors", () => {
    call("coa-list", ctxA);
    const v = call("vendors-create", ctxA, { name: "Contractor Jane", is1099: true, taxId: "12-3456789" }).result.vendor;
    const exp = call("coa-list", ctxA).result.accounts.find((a) => a.code === "6000");
    const year = new Date().getUTCFullYear() - 1;
    const day = `${year}-06-01`;
    const bill = call("bills-create", ctxA, { vendorId: v.id, total: 2500, expenseAccountId: exp.id, issuedAt: day, dueAt: day }).result.bill;
    call("bills-pay", ctxA, { id: bill.id, paidAt: day });
    const r = call("efile-1099-fire", ctxA, { year, payer: { name: "My LLC", tin: "98-7654321" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.payeeCount, 1);
    assert.equal(r.result.totalReported, 2500);
    assert.ok(r.result.fireFile.startsWith("T"));
    assert.match(r.result.fireFile, /\nF/);
  });

  it("1099 export errors when payer EIN is invalid", () => {
    const r = call("efile-1099-fire", ctxA, { payer: { name: "X", tin: "123" } });
    assert.equal(r.ok, false);
    assert.match(r.error, /9-digit EIN/);
  });

  it("builds an SSA EFW2 W-2 file from this year's payroll", () => {
    const emp = call("employee-create", ctxA, { name: "Pat Worker", payType: "salary", rate: 96000 }).result.employee;
    const y = new Date().getUTCFullYear();
    call("payrun-create", ctxA, {
      periodStart: `${y}-01-01`, periodEnd: `${y}-01-15`, payDate: `${y}-01-16`,
      lines: [{ employeeId: emp.id }],
    });
    const r = call("efile-w2-export", ctxA, { year: y, employer: { name: "My LLC", ein: "98-7654321" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.employeeCount, 1);
    assert.ok(r.result.totalWages > 0);
    assert.ok(r.result.efw2File.startsWith("RA"));
  });

  it("W-2 export errors when there is no payroll for the year", () => {
    const r = call("efile-w2-export", ctxA, { year: 1999, employer: { name: "X", ein: "987654321" } });
    assert.equal(r.ok, false);
  });
});
