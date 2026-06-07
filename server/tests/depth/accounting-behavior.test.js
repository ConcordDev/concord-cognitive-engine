// tests/depth/accounting-behavior.test.js — REAL behavioral tests for the
// accounting domain. Curated high-confidence subset (calcs + CRUD round-trips +
// validation); the rest of the 116 actions follow the same lensRun template.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("accounting — calc / report contracts", () => {
  it("budgetVariance: variance = actual − planned, flagged over-budget", async () => {
    const over = await lensRun("accounting", "budgetVariance", { data: { budget: [{ category: "Marketing", planned: 1000, actual: 1200 }] } });
    assert.equal(over.ok, true);
    const li = over.result.lineItems[0];
    assert.equal(li.actual, 1200);
    assert.equal(li.variance, 200);            // 1200 − 1000
    assert.equal(li.status, "over-budget");
  });

  it("profitLoss: categorizes accounts into a structured revenue/period report", async () => {
    const r = await lensRun("accounting", "profitLoss", { data: { accounts: [{ type: "revenue", name: "Sales", amount: 5000 }, { type: "expense", name: "Rent", amount: 2000 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.revenue && Array.isArray(r.result.revenue.lines));
    assert.equal(r.result.revenue.lines.length, 1);   // the single revenue account
    assert.ok(r.result.period && r.result.period.start, "reports a period");
  });

  it("trialBalance: builds a trial balance over the supplied accounts", async () => {
    const r = await lensRun("accounting", "trialBalance", { data: { accounts: [{ code: "1000", name: "Cash", type: "asset", debit: 1000, credit: 0 }, { code: "3000", name: "Equity", type: "equity", debit: 0, credit: 1000 }] } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.accounts));
    assert.equal(r.result.accounts.length, 2);        // echoes both accounts
  });
});

describe("accounting — CRUD round-trips + validation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-crud"); });

  it("customers-create → customers-list: customer reads back with an auto number", async () => {
    const c = await lensRun("accounting", "customers-create", { params: { name: "Acme Co" } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.customer.name, "Acme Co");
    assert.match(c.result.customer.number, /^C-\d+/);
    const id = c.result.customer.id;
    const list = await lensRun("accounting", "customers-list", { params: {} }, ctx);
    assert.ok((list.result.customers || []).some((x) => x.id === id), "customer listed");
  });

  it("vendors-create → vendors-list: vendor reads back with an auto number", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Supplies Inc" } }, ctx);
    assert.equal(v.ok, true);
    assert.match(v.result.vendor.number, /^V-\d+/);
    const id = v.result.vendor.id;
    const list = await lensRun("accounting", "vendors-list", { params: {} }, ctx);
    assert.ok((list.result.vendors || []).some((x) => x.id === id), "vendor listed");
  });

  it("coa-create: rejects an invalid account category (validation)", async () => {
    const bad = await lensRun("accounting", "coa-create", { params: { code: "4000", name: "X", type: "revenue" } }, ctx); // sends 'type', not 'category'
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /category invalid/i);
  });

  it("coa-create → coa-list: a valid account joins the chart of accounts", async () => {
    const c = await lensRun("accounting", "coa-create", { params: { code: "4100", name: "Service Revenue", category: "revenue" } }, ctx);
    assert.equal(c.ok, true);
    const list = await lensRun("accounting", "coa-list", { params: {} }, ctx);
    assert.ok((list.result.accounts || []).some((a) => a.code === "4100"), "new account in the chart");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wave 7 top-up — UNCOVERED deterministic accounting math + CRUD round-trips.
// Skipped (network/LLM): ask, ai-categorize-txn, bank-feeds-bulk-suggest,
// ai-suggest-vendor, currency-refresh-rates, bank-feeds-sync, receipt-ocr.
// ─────────────────────────────────────────────────────────────────────────────

describe("accounting — journal → statement math (wave 7 top-up)", () => {
  // Shared ctx so je-post writes accumulate and the report calcs read them back.
  // Default CoA seeds acct_1000 Cash / acct_4000 Sales Revenue / acct_5000 COGS /
  // acct_6100 Rent Expense. Three balanced JEs, all dated this year:
  //   JE1  Dr Cash 5000  / Cr Sales Revenue 5000   (revenue + cash in)
  //   JE2  Dr Rent 2000  / Cr Cash 2000            (expense + cash out)
  //   JE3  Dr COGS 1000  / Cr Cash 1000            (cogs + cash out)
  let ctx;
  const YR = new Date().getUTCFullYear();
  const D = (m, d) => `${YR}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  before(async () => {
    ctx = await depthCtx("accounting-stmt");
    // JE1 — revenue + cash in
    const je1 = await lensRun("accounting", "je-post", { params: { date: D(1, 5), memo: "Sale", lines: [
      { accountId: "acct_1000", debit: 5000, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 5000 },
    ] } }, ctx);
    assert.equal(je1.ok, true, "JE1 posts balanced");
    // JE2 — rent expense, cash out
    await lensRun("accounting", "je-post", { params: { date: D(1, 10), memo: "Rent", lines: [
      { accountId: "acct_6100", debit: 2000, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 2000 },
    ] } }, ctx);
    // JE3 — cogs, cash out
    await lensRun("accounting", "je-post", { params: { date: D(1, 15), memo: "COGS", lines: [
      { accountId: "acct_5000", debit: 1000, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 1000 },
    ] } }, ctx);
  });

  it("je-post: rejects an unbalanced entry (debits != credits)", async () => {
    const bad = await lensRun("accounting", "je-post", { params: { lines: [
      { accountId: "acct_1000", debit: 100, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 90 },
    ] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /unbalanced/i);
  });

  it("je-post: rejects an unknown account id", async () => {
    const bad = await lensRun("accounting", "je-post", { params: { lines: [
      { accountId: "acct_9999", debit: 50, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 50 },
    ] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /unknown account/i);
  });

  it("pl-compute: gross profit + net income + margins computed from the journal", async () => {
    const r = await lensRun("accounting", "pl-compute", { params: { start: D(1, 1), end: D(12, 31) } }, ctx);
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.revenue.total, 5000);
    assert.equal(res.cogs.total, 1000);
    assert.equal(res.grossProfit, 4000);            // 5000 − 1000
    assert.equal(res.operatingExpenses.total, 2000);
    assert.equal(res.netIncome, 2000);              // 4000 − 2000
    assert.equal(res.grossMarginPct, 80);           // 4000/5000*100
    assert.equal(res.netMarginPct, 40);             // 2000/5000*100
  });

  it("cashflow-compute: cash in/out + net from cash-account activity", async () => {
    const r = await lensRun("accounting", "cashflow-compute", { params: { start: D(1, 1), end: D(12, 31) } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalIn, 5000);           // JE1 debit to cash
    assert.equal(r.result.totalOut, 3000);          // 2000 + 1000 credits to cash
    assert.equal(r.result.netCashFlow, 2000);
  });

  it("balance-sheet-compute: assets = liabilities + equity, net income in equity", async () => {
    const r = await lensRun("accounting", "balance-sheet-compute", { params: { asOf: D(12, 31) } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.assets, 2000);     // cash 5000 − 2000 − 1000
    assert.equal(r.result.totals.liabilities, 0);
    assert.equal(r.result.totals.equity, 2000);     // net income → retained earnings
    assert.equal(r.result.balanced, true);
    assert.ok(r.result.equity.some((e) => e.code === "RE" && e.balance === 2000), "net income flows into RE");
  });

  it("financial-ratios: margins + working capital derived from the journal", async () => {
    const r = await lensRun("accounting", "financial-ratios", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.grossMarginPct, 80);      // round(4000/5000*1000)/10
    assert.equal(r.result.netMarginPct, 40);        // round(2000/5000*1000)/10
    assert.equal(r.result.workingCapital, 2000);    // currentAssets 2000 − currentLiab 0
    assert.equal(r.result.currentRatio, null);      // safeDiv by zero liabilities
  });
});

describe("accounting — AR/AP aging + budgetVariance math (wave 7 top-up)", () => {
  it("invoiceAging: buckets unpaid invoices by days overdue + weighted avg", async () => {
    // asOf 2026-04-01; INV-1 due 2026-03-30 (2 days late → 1-30), INV-2 due
    // 2025-12-01 (121 days late → 90+), INV-3 paid (excluded).
    const r = await lensRun("accounting", "invoiceAging", {
      data: { invoices: [
        { invoiceId: "INV-1", customer: "A", amount: 100, dueDate: "2026-03-30" },
        { invoiceId: "INV-2", customer: "B", amount: 300, dueDate: "2025-12-01" },
        { invoiceId: "INV-3", customer: "C", amount: 999, dueDate: "2026-02-01", paidDate: "2026-02-15" },
      ] },
      params: { asOfDate: "2026-04-01" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalInvoices, 3);
    assert.equal(r.result.unpaidCount, 2);          // paid one excluded
    assert.equal(r.result.totalOutstanding, 400);   // 100 + 300
    assert.equal(r.result.buckets["1-30"].total, 100);
    assert.equal(r.result.buckets["90+"].total, 300);
    assert.equal(r.result.totalOverdue, 400);       // none in 'current'
  });

  it("budgetVariance: under-budget item flagged correctly", async () => {
    const r = await lensRun("accounting", "budgetVariance", {
      data: { budget: [{ category: "Travel", planned: 1000, actual: 700 }] },
    });
    assert.equal(r.ok, true);
    const li = r.result.lineItems[0];
    assert.equal(li.variance, -300);                // 700 − 1000
    assert.equal(li.status, "under-budget");
  });
});

describe("accounting — bills / aging-ap round-trip (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-bills"); });

  it("vendors-create → bills-create → bills-pay: open→paid round-trip", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Parts Co", paymentTerms: "net30" } }, ctx);
    assert.equal(v.ok, true);
    const vendorId = v.result.vendor.id;
    const b = await lensRun("accounting", "bills-create", { params: { vendorId, total: 450, expenseAccountId: "acct_6000", issuedAt: "2026-01-01" } }, ctx);
    assert.equal(b.ok, true);
    assert.equal(b.result.bill.status, "open");
    assert.equal(b.result.bill.total, 450);
    const billId = b.result.bill.id;
    const paid = await lensRun("accounting", "bills-pay", { params: { id: billId } }, ctx);
    assert.equal(paid.ok, true);
    assert.equal(paid.result.bill.status, "paid");
    assert.equal(paid.result.paymentEntry.totalDebit, 450);
  });

  it("bills-create: rejects an unknown vendor", async () => {
    const bad = await lensRun("accounting", "bills-create", { params: { vendorId: "vend_nope", total: 100, expenseAccountId: "acct_6000" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /vendor not found/i);
  });

  it("aging-ap: an open bill 45 days past due lands in the 31–60 bucket", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Late Vendor" } }, ctx);
    const vendorId = v.result.vendor.id;
    // due 2026-01-01, asOf 2026-02-15 → 45 days past due → d30 (31–60)
    await lensRun("accounting", "bills-create", { params: { vendorId, total: 220, expenseAccountId: "acct_6000", issuedAt: "2025-12-01", dueAt: "2026-01-01" } }, ctx);
    const r = await lensRun("accounting", "aging-ap", { params: { asOf: "2026-02-15" } }, ctx);
    assert.equal(r.ok, true);
    const d30 = (r.result.buckets || []).find((x) => x.key === "d30");
    assert.equal(d30.total, 220);
    assert.equal(r.result.totalOpen, 220);          // the paid bill above is excluded
  });
});

describe("accounting — tax + inventory + budget CRUD (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-misc"); });

  it("tax-code-create → tax-code-list: rate clamped into [0,100], reads back", async () => {
    const c = await lensRun("accounting", "tax-code-create", { params: { name: "CA Sales", rate: 7.25 } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.taxCode.rate, 7.25);
    const list = await lensRun("accounting", "tax-code-list", { params: {} }, ctx);
    assert.ok((list.result.taxCodes || []).some((t) => t.name === "CA Sales" && t.rate === 7.25), "tax code listed");
  });

  it("tax-liability: nets Sales-Tax-Payable (code 2100) credits − debits", async () => {
    // Post a JE crediting Sales Tax Payable (acct_2100) 80, debit Cash 80.
    await lensRun("accounting", "je-post", { params: { date: "2026-01-20", memo: "collect tax", lines: [
      { accountId: "acct_1000", debit: 80, credit: 0 },
      { accountId: "acct_2100", debit: 0, credit: 80 },
    ] } }, ctx);
    const r = await lensRun("accounting", "tax-liability", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.salesTaxPayable, 80);     // credit 80 − debit 0
  });

  it("item-create (inventory) → item-adjust-stock → inventory-low-stock", async () => {
    const it = await lensRun("accounting", "item-create", { params: { name: "Widget", type: "inventory", qtyOnHand: 5, reorderPoint: 10, cost: 3 } }, ctx);
    assert.equal(it.ok, true);
    assert.equal(it.result.item.qtyOnHand, 5);
    const id = it.result.item.id;
    const adj = await lensRun("accounting", "item-adjust-stock", { params: { id, delta: -2 } }, ctx);
    assert.equal(adj.result.qtyOnHand, 3);          // 5 − 2
    const low = await lensRun("accounting", "inventory-low-stock", { params: {} }, ctx);
    assert.ok((low.result.items || []).some((x) => x.id === id), "below reorderPoint → flagged low");
    assert.equal(low.result.inventoryValue, 9);     // 3 qty × 3 cost
  });

  it("item-adjust-stock: rejects a service item (no stock tracking)", async () => {
    const it = await lensRun("accounting", "item-create", { params: { name: "Consulting", type: "service", price: 200 } }, ctx);
    const bad = await lensRun("accounting", "item-adjust-stock", { params: { id: it.result.item.id, delta: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /only inventory items track stock/i);
  });

  it("budget-create → budget-set-line → budget-vs-actual: variance vs journal", async () => {
    const bud = await lensRun("accounting", "budget-create", { params: { name: "FY Budget", fiscalYear: 2026 } }, ctx);
    assert.equal(bud.ok, true);
    const budgetId = bud.result.budget.id;
    // Budget Rent (acct_6100) at 1000 annual.
    const setL = await lensRun("accounting", "budget-set-line", { params: { budgetId, accountId: "acct_6100", annualAmount: 1000 } }, ctx);
    assert.equal(setL.result.lines["acct_6100"], 1000);
    // Actual rent: a 2026 JE Dr Rent 600 / Cr Cash 600.
    await lensRun("accounting", "je-post", { params: { date: "2026-02-01", memo: "rent", lines: [
      { accountId: "acct_6100", debit: 600, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 600 },
    ] } }, ctx);
    const vsa = await lensRun("accounting", "budget-vs-actual", { params: { budgetId } }, ctx);
    assert.equal(vsa.ok, true);
    const row = vsa.result.rows.find((r) => r.accountId === "acct_6100");
    assert.equal(row.budgeted, 1000);
    assert.equal(row.actual, 600);                  // debit 600 − credit 0
    assert.equal(row.variance, -400);               // 600 − 1000
  });

  it("budget-vs-actual: rejects an unknown budget id", async () => {
    const bad = await lensRun("accounting", "budget-vs-actual", { params: { budgetId: "budget_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /budget not found/i);
  });
});
