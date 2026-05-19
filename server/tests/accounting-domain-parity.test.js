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
