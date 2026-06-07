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

// ─────────────────────────────────────────────────────────────────────────────
// wave 8 top-up — DIFFERENT uncovered deterministic macros: payroll, purchase
// orders, expenses, estimates, recurring invoices, 1099 summary, dimensions /
// segment-P&L, fx-revaluation, tax-payment-record, currency, category-rules.
// Skipped (network/LLM): currency-refresh-rates, receipt-ocr, ask, ai-*.
// ─────────────────────────────────────────────────────────────────────────────

describe("accounting — payroll math (wave 8 top-up)", () => {
  // PR_RATES = { federal: 0.12, fica: 0.0765, state: 0.05 }; PR_PERIODS = 24.
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-payroll8"); });

  it("payrun-create (salary): gross = annual/24, withholdings + net hand-computed", async () => {
    const e = await lensRun("accounting", "employee-create", { params: { name: "Sal Aried", payType: "salary", rate: 48000 } }, ctx);
    assert.equal(e.ok, true);
    const empId = e.result.employee.id;
    const run = await lensRun("accounting", "payrun-create", { params: {
      periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-16",
      lines: [{ employeeId: empId }],
    } }, ctx);
    assert.equal(run.ok, true);
    const stub = run.result.run.stubs[0];
    assert.equal(stub.gross, 2000);        // 48000 / 24
    assert.equal(stub.federal, 240);       // 2000 * 0.12
    assert.equal(stub.fica, 153);          // 2000 * 0.0765
    assert.equal(stub.state, 100);         // 2000 * 0.05
    assert.equal(stub.withholding, 493);   // 240 + 153 + 100
    assert.equal(stub.net, 1507);          // 2000 − 493
    assert.equal(run.result.run.totalGross, 2000);
    assert.equal(run.result.run.totalNet, 1507);
    assert.equal(run.result.run.totalWithholding, 493);
  });

  it("payrun-create (hourly): gross = rate × hours, withholdings hand-computed", async () => {
    const e = await lensRun("accounting", "employee-create", { params: { name: "Hour Lee", payType: "hourly", rate: 40 } }, ctx);
    const empId = e.result.employee.id;
    const run = await lensRun("accounting", "payrun-create", { params: {
      payDate: "2026-02-16", lines: [{ employeeId: empId, hours: 80 }],
    } }, ctx);
    assert.equal(run.ok, true);
    const stub = run.result.run.stubs[0];
    assert.equal(stub.gross, 3200);        // 40 × 80
    assert.equal(stub.federal, 384);       // 3200 * 0.12
    assert.equal(stub.fica, 244.8);        // 3200 * 0.0765
    assert.equal(stub.state, 160);         // 3200 * 0.05
    assert.equal(stub.withholding, 788.8); // 384 + 244.8 + 160
    assert.equal(stub.net, 2411.2);        // 3200 − 788.8
  });

  it("payrun-create: rejects a run with no payroll lines", async () => {
    const bad = await lensRun("accounting", "payrun-create", { params: { lines: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /at least one payroll line required/i);
  });

  it("payroll-summary: YTD gross/net aggregate the two 2026 runs above", async () => {
    // Salary run gross 2000 + hourly run gross 3200 = 5200; nets 1507 + 2411.2.
    const r = await lensRun("accounting", "payroll-summary", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.ytdGross, 5200);
    assert.equal(r.result.ytdNet, 3918.2);          // 1507 + 2411.2
    assert.equal(r.result.ytdWithholding, 1281.8);  // 493 + 788.8
    assert.equal(r.result.employees, 2);            // both active
  });

  it("employee-create → employee-list: new employee reads back", async () => {
    const e = await lensRun("accounting", "employee-create", { params: { name: "Read Back", payType: "salary", rate: 60000 } }, ctx);
    const list = await lensRun("accounting", "employee-list", { params: {} }, ctx);
    assert.ok((list.result.employees || []).some((x) => x.id === e.result.employee.id && x.name === "Read Back"), "employee listed");
  });
});

describe("accounting — purchase orders + expenses (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-po8"); });

  it("po-create → po-receive: total summed from lines, receive opens a bill", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Hardware Co" } }, ctx);
    const vendorId = v.result.vendor.id;
    const po = await lensRun("accounting", "po-create", { params: { vendorId, lines: [
      { description: "Bolts", qty: 10, unitCost: 2.5 },
      { description: "Nuts", qty: 4, unitCost: 5 },
    ] } }, ctx);
    assert.equal(po.ok, true);
    assert.equal(po.result.purchaseOrder.total, 45);   // 10×2.5 + 4×5
    assert.equal(po.result.purchaseOrder.status, "open");
    const poId = po.result.purchaseOrder.id;
    const recv = await lensRun("accounting", "po-receive", { params: { id: poId } }, ctx);
    assert.equal(recv.ok, true);
    assert.equal(recv.result.purchaseOrder.status, "received");
    assert.equal(recv.result.bill.amount, 45);         // bill carries PO total
    assert.equal(recv.result.bill.status, "open");
  });

  it("po-receive: rejects a second receive of the same PO", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Once Co" } }, ctx);
    const po = await lensRun("accounting", "po-create", { params: { vendorId: v.result.vendor.id, lines: [{ description: "X", qty: 1, unitCost: 9 }] } }, ctx);
    const id = po.result.purchaseOrder.id;
    await lensRun("accounting", "po-receive", { params: { id } }, ctx);
    const bad = await lensRun("accounting", "po-receive", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /already received/i);
  });

  it("po-create: rejects an unknown vendor", async () => {
    const bad = await lensRun("accounting", "po-create", { params: { vendorId: "vend_nope", lines: [{ description: "X", qty: 1, unitCost: 1 }] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /vendor not found/i);
  });

  it("expenses-create: auto-posts a balanced Dr expense / Cr cash JE", async () => {
    // acct_6000 is a seeded expense account; amount 125 → JE debits it, credits cash 1000.
    const exp = await lensRun("accounting", "expenses-create", { params: { accountId: "acct_6000", amount: 125, vendor: "Cafe", memo: "lunch", date: "2026-03-01" } }, ctx);
    assert.equal(exp.ok, true);
    assert.equal(exp.result.expense.amount, 125);
    assert.equal(exp.result.entry.totalDebit, 125);
    assert.equal(exp.result.entry.totalCredit, 125);
    const debitLine = exp.result.entry.lines.find((l) => l.accountId === "acct_6000");
    assert.equal(debitLine.debit, 125);
    assert.equal(debitLine.credit, 0);
  });

  it("expenses-create: rejects a non-positive amount", async () => {
    const bad = await lensRun("accounting", "expenses-create", { params: { accountId: "acct_6000", amount: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /amount must be > 0/i);
  });
});

describe("accounting — estimates / recurring / 1099 (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-flow8"); });

  it("estimates-create → estimates-convert: estimate becomes an open invoice, total carried", async () => {
    const e = await lensRun("accounting", "estimates-create", { params: { customerName: "Prospect Inc", total: 880 } }, ctx);
    assert.equal(e.ok, true);
    assert.equal(e.result.estimate.status, "pending");
    const id = e.result.estimate.id;
    const conv = await lensRun("accounting", "estimates-convert", { params: { id } }, ctx);
    assert.equal(conv.ok, true);
    assert.equal(conv.result.estimate.status, "accepted");
    assert.equal(conv.result.invoice.total, 880);          // total carried over
    assert.equal(conv.result.invoice.status, "open");
    assert.equal(conv.result.invoice.fromEstimateId, id);
    // Second convert is rejected.
    const again = await lensRun("accounting", "estimates-convert", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(String(again.result.error), /already converted/i);
  });

  it("recurring-invoices-create → run-due: a due schedule generates one invoice", async () => {
    const r = await lensRun("accounting", "recurring-invoices-create", { params: {
      customerName: "Sub Co", total: 49, cadence: "monthly", startAt: "2020-01-01",
    } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.recurring.active, true);
    // startAt in the past → nextRunAt is due → run-due mints exactly one invoice.
    const run = await lensRun("accounting", "recurring-invoices-run-due", { params: {} }, ctx);
    assert.equal(run.ok, true);
    assert.equal(run.result.count, 1);
    assert.equal(run.result.created[0].total, 49);
    assert.equal(run.result.created[0].recurringId, r.result.recurring.id);
  });

  it("summary-1099: only paid bills to 1099 vendors count; threshold flag at $600", async () => {
    // 1099 vendor with two paid bills totalling 700 → reportable; non-1099 vendor excluded.
    const v1099 = await lensRun("accounting", "vendors-create", { params: { name: "Contractor", is1099: true, taxId: "12-3456789" } }, ctx);
    const v1099Id = v1099.result.vendor.id;
    const vReg = await lensRun("accounting", "vendors-create", { params: { name: "Regular Vendor", is1099: false } }, ctx);
    const b1 = await lensRun("accounting", "bills-create", { params: { vendorId: v1099Id, total: 400, expenseAccountId: "acct_6000", issuedAt: "2026-01-01" } }, ctx);
    await lensRun("accounting", "bills-pay", { params: { id: b1.result.bill.id, paidAt: "2026-02-01" } }, ctx);
    const b2 = await lensRun("accounting", "bills-create", { params: { vendorId: v1099Id, total: 300, expenseAccountId: "acct_6000", issuedAt: "2026-01-05" } }, ctx);
    await lensRun("accounting", "bills-pay", { params: { id: b2.result.bill.id, paidAt: "2026-03-01" } }, ctx);
    // Non-1099 paid bill — must NOT appear.
    const b3 = await lensRun("accounting", "bills-create", { params: { vendorId: vReg.result.vendor.id, total: 999, expenseAccountId: "acct_6000", issuedAt: "2026-01-01" } }, ctx);
    await lensRun("accounting", "bills-pay", { params: { id: b3.result.bill.id, paidAt: "2026-02-01" } }, ctx);
    const r = await lensRun("accounting", "summary-1099", { params: { year: 2026 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.threshold, 600);
    const row = r.result.vendors.find((x) => x.vendorId === v1099Id);
    assert.equal(row.total, 700);              // 400 + 300
    assert.equal(row.billCount, 2);
    assert.equal(row.reportable, true);        // 700 >= 600
    assert.ok(!r.result.vendors.some((x) => x.vendorId === vReg.result.vendor.id), "non-1099 vendor excluded");
  });
});

describe("accounting — dimensions / segment-pl / fx + tax (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-dim8"); });

  it("dimension-create → je-tag-dimension → segment-pl slices revenue by class", async () => {
    const dim = await lensRun("accounting", "dimension-create", { params: { kind: "class", name: "Retail" } }, ctx);
    assert.equal(dim.ok, true);
    const dimId = dim.result.dimension.id;
    // Post a revenue JE, then tag it with the class dimension.
    const je = await lensRun("accounting", "je-post", { params: { date: "2026-04-01", memo: "Retail sale", lines: [
      { accountId: "acct_1000", debit: 1000, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 1000 },
    ] } }, ctx);
    const entryId = je.result.entry.id;
    const tag = await lensRun("accounting", "je-tag-dimension", { params: { entryId, dimensionId: dimId } }, ctx);
    assert.equal(tag.ok, true);
    assert.ok((tag.result.entry.dimensions || []).some((d) => d.id === dimId && d.kind === "class"), "entry tagged");
    const seg = await lensRun("accounting", "segment-pl", { params: { kind: "class", start: "2026-01-01", end: "2026-12-31" } }, ctx);
    assert.equal(seg.ok, true);
    const retail = (seg.result.segments || []).find((x) => x.segment === "Retail" || x.name === "Retail");
    assert.ok(retail, "Retail segment present");
    assert.equal(retail.revenue, 1000);        // the tagged revenue JE
  });

  it("dimension-create: rejects an invalid kind", async () => {
    const bad = await lensRun("accounting", "dimension-create", { params: { kind: "widget", name: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /class \| location \| project/i);
  });

  it("fx-revaluation: gain = current book value − booked value, hand-computed", async () => {
    // Set base USD so the USD position revalues at rate 1 with no network call.
    await lensRun("accounting", "currency-set-base", { params: { base: "USD" } }, ctx);
    // Use a position whose currency == base so no network rate is required:
    // foreignBalance 1000 USD, booked at 1.25 → bookedValue 800; currentRate 1 → currentValue 1000.
    const r = await lensRun("accounting", "fx-revaluation", { params: { positions: [
      { label: "Cash", currency: "USD", foreignBalance: 1000, bookedRate: 1.25 },
    ] } }, ctx);
    assert.equal(r.ok, true);
    const line = r.result.lines[0];
    assert.equal(line.bookedValue, 800);       // 1000 / 1.25
    assert.equal(line.currentValue, 1000);     // 1000 / 1 (base)
    assert.equal(line.gainLoss, 200);          // 1000 − 800
    assert.equal(r.result.totalUnrealizedGainLoss, 200);
    assert.equal(r.result.direction, "gain");
  });

  it("fx-revaluation: rejects an invalid currency code", async () => {
    const bad = await lensRun("accounting", "fx-revaluation", { params: { positions: [{ currency: "US", foreignBalance: 10, bookedRate: 1 }] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /invalid currency code/i);
  });

  it("tax-payment-record → tax-liability: remittance debits Sales Tax Payable", async () => {
    // Collect 90 of sales tax (Cr 2100), then remit 50 (Dr 2100). Net payable = 40.
    await lensRun("accounting", "je-post", { params: { date: "2026-01-10", memo: "collect", lines: [
      { accountId: "acct_1000", debit: 90, credit: 0 },
      { accountId: "acct_2100", debit: 0, credit: 90 },
    ] } }, ctx);
    const pay = await lensRun("accounting", "tax-payment-record", { params: { amount: 50, date: "2026-02-01" } }, ctx);
    assert.equal(pay.ok, true);
    assert.equal(pay.result.amount, 50);
    const r = await lensRun("accounting", "tax-liability", { params: {} }, ctx);
    assert.equal(r.result.salesTaxPayable, 40);   // 90 credit − 50 debit
  });

  it("tax-payment-record: rejects a non-positive payment", async () => {
    const bad = await lensRun("accounting", "tax-payment-record", { params: { amount: -5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /payment amount must be positive/i);
  });

  it("category-rules-create → category-rules-list: rule reads back; invalid account rejected", async () => {
    const bad = await lensRun("accounting", "category-rules-create", { params: { pattern: "UBER", accountId: "acct_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /accountId invalid/i);
    const ok = await lensRun("accounting", "category-rules-create", { params: { pattern: "UBER", accountId: "acct_6000" } }, ctx);
    assert.equal(ok.ok, true);
    const list = await lensRun("accounting", "category-rules-list", { params: {} }, ctx);
    assert.ok((list.result.rules || []).some((x) => x.id === ok.result.rule.id && x.pattern === "UBER"), "rule listed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wave 9 top-up — STILL-uncovered deterministic macros: artifact-data calc
// reports (rentRoll, validate-ledger, generate-invoice, reconcile,
// generate-statements, audit-trail) + invoice CRUD + AR aging + runway +
// ledger pagination + recurring-bills + payrun read paths + coa/item edits +
// dashboard + currency-list. Skipped (network/LLM/Stripe): invoice-create-
// payment-link, currency-refresh-rates, receipt-ocr*, ai-*, ask, efile-*.
// ─────────────────────────────────────────────────────────────────────────────

describe("accounting — artifact-data calc reports (wave 9 top-up)", () => {
  it("rentRoll: per-property + portfolio occupancy/collection hand-computed", async () => {
    // 1 property, 2 units: U1 occupied $1000 paidThrough 2026-12 (paid); U2 vacant.
    // asOfMonth 2026-06 → occupied 1, vacant 1; expected = 1000 (vacant excluded),
    // collected = 1000 (U1 paid). occupancyRate = 1/2 = 50%.
    const r = await lensRun("accounting", "rentRoll", {
      data: { properties: [{ propertyId: "P1", address: "1 Main", units: [
        { unitId: "U1", tenant: "Alice", monthlyRent: 1000, paidThrough: "2026-12-31" },
        { unitId: "U2", monthlyRent: 800 },
      ] }] },
      params: { asOfMonth: "2026-06" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalUnits, 2);
    assert.equal(r.result.occupiedUnits, 1);
    assert.equal(r.result.vacantUnits, 1);
    assert.equal(r.result.occupancyRate, 50);          // 1/2 × 100
    assert.equal(r.result.totalExpectedRent, 1000);    // vacant unit excluded
    assert.equal(r.result.totalCollected, 1000);       // U1 paid
    assert.equal(r.result.totalOutstanding, 0);        // 1000 − 1000
    const p = r.result.properties.find((x) => x.propertyId === "P1");
    assert.equal(p.collectionRate, 100);               // 1000/1000
    assert.equal(p.units.find((u) => u.unitId === "U1").status, "paid");
  });

  it("validate-ledger: out-of-balance ledger flagged as error with the exact difference", async () => {
    // Cash dr 1000 / cr 0, Revenue dr 0 / cr 900 → debits 1000 ≠ credits 900.
    const r = await lensRun("accounting", "validate-ledger", { data: { accounts: [
      { name: "Cash", type: "asset", entries: [{ debit: 1000, credit: 0 }] },
      { name: "Revenue", type: "revenue", entries: [{ debit: 0, credit: 900 }] },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDebits, 1000);
    assert.equal(r.result.totalCredits, 900);
    assert.equal(r.result.difference, 100);            // 1000 − 900
    assert.equal(r.result.isBalanced, false);
    assert.equal(r.result.severity, "error");
  });

  it("validate-ledger: balanced books with a wrong-side account → warning", async () => {
    // A credit-normal revenue account carrying a net debit balance → suspicious side,
    // but totals balance (debits 500 == credits 500).
    const r = await lensRun("accounting", "validate-ledger", { data: { accounts: [
      { name: "Cash", type: "asset", entries: [{ debit: 0, credit: 500 }] },
      { name: "Revenue", type: "revenue", entries: [{ debit: 500, credit: 0 }] },
    ] } });
    assert.equal(r.result.isBalanced, true);
    assert.equal(r.result.severity, "warning");
    assert.ok(r.result.accountIssues.some((i) => i.account === "Revenue"), "wrong-side account flagged");
  });

  it("generate-invoice: line subtotals + tax + grand total hand-computed", async () => {
    // L1: 2 × 100 = 200, tax 0.10 → 20. L2: 3 × 50 = 150, no tax.
    // subtotal 350, totalTax 20, grandTotal 370.
    const r = await lensRun("accounting", "generate-invoice", {
      data: { lineItems: [
        { description: "Design", quantity: 2, unitPrice: 100, taxRate: 0.10 },
        { description: "Hosting", quantity: 3, unitPrice: 50 },
      ] },
      params: { client: { name: "Globex" }, dueDays: 15 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 350);
    assert.equal(r.result.totalTax, 20);
    assert.equal(r.result.grandTotal, 370);
    assert.equal(r.result.status, "draft");
    const l1 = r.result.lineItems.find((l) => l.description === "Design");
    assert.equal(l1.subtotal, 200);
    assert.equal(l1.tax, 20);
    assert.equal(l1.total, 220);
  });

  it("reconcile: exact-amount + same-day + token match yields a high-confidence pairing", async () => {
    // Bank line and txn share amount 250, same date. bankTokens = ['acme','payment'],
    // txTokens = ['acme','corp','invoice'] → 1 shared of 2 → tokenScore 0.5.
    // score = 0.7×dateScore(1.0) + 0.3×0.5 = 0.85. Second bank line ($999) → unmatched.
    const r = await lensRun("accounting", "reconcile", { data: {
      bankLines: [
        { id: "BL1", date: "2026-05-01", amount: 250, description: "ACME payment" },
        { id: "BL2", date: "2026-05-02", amount: 999, description: "Mystery" },
      ],
      transactions: [
        { id: "TX1", date: "2026-05-01", amount: 250, counterparty: "Acme Corp", memo: "invoice" },
      ],
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.candidateMatches.length, 1);
    const m = r.result.candidateMatches[0];
    assert.equal(m.bankLineId, "BL1");
    assert.equal(m.transactionId, "TX1");
    assert.equal(m.confidence, 0.85);                  // 0.7×1.0 + 0.3×0.5
    assert.equal(r.result.bankLinesUnmatched, 1);      // BL2 unmatched
  });

  it("generate-statements: P&L + balance-sheet + cash-flow from supplied accounts", async () => {
    // Revenue cr 5000, Expense dr 2000 (both in period) → netIncome 3000.
    // Cash asset dr 5000 cr 2000 net 3000 (all in period) → cashFlow netChange 3000.
    const r = await lensRun("accounting", "generate-statements", {
      data: { accounts: [
        { name: "Sales", type: "revenue", entries: [{ date: "2026-03-01", debit: 0, credit: 5000 }] },
        { name: "Rent", type: "expense", entries: [{ date: "2026-03-05", debit: 2000, credit: 0 }] },
        { name: "Cash", type: "asset", entries: [
          { date: "2026-03-01", debit: 5000, credit: 0 },
          { date: "2026-03-05", debit: 0, credit: 2000 },
        ] },
      ] },
      params: { startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.incomeStatement.revenue, 5000);
    assert.equal(r.result.incomeStatement.expense, 2000);
    assert.equal(r.result.incomeStatement.netIncome, 3000);  // 5000 − 2000
    assert.equal(r.result.cashFlow.netChange, 3000);         // cash dr5000 − cr2000
  });

  it("audit-trail: sequence gap + orphaned entry + unposted txn all flagged", async () => {
    // Txns TX-1 / TX-3 → numeric ids 1,3 → one gap (missing 2).
    // Account 'Cash' has an entry linked to TX-9 which doesn't exist → 1 orphan.
    // TX-3 is referenced by no entry → 1 unposted txn (TX-1 IS posted via Cash entry).
    const r = await lensRun("accounting", "audit-trail", { data: {
      transactions: [{ id: "TX-1", amount: 100, date: "2026-01-01" }, { id: "TX-3", amount: 50, date: "2026-01-03" }],
      accounts: [{ name: "Cash", accountNumber: "1000", entries: [
        { linkedTxId: "TX-1", debit: 100 },
        { linkedTxId: "TX-9", debit: 25 },
      ] }],
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.sequenceGaps.length, 1);                 // 1→3 skips 2
    assert.equal(r.result.sequenceGaps[0].missing, 1);            // one id missing
    assert.equal(r.result.orphanedEntries.length, 1);            // TX-9 entry orphaned
    assert.ok(r.result.unpostedTransactions.some((t) => t.id === "TX-3"), "TX-3 unposted");
    assert.ok(!r.result.unpostedTransactions.some((t) => t.id === "TX-1"), "TX-1 is posted");
    assert.equal(r.result.severity, "warning");
  });
});

describe("accounting — invoice CRUD + AR aging + runway (wave 9 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-ar9"); });

  it("invoice-create → invoice-mark-paid → invoice-list: open→paid round-trip", async () => {
    const c = await lensRun("accounting", "invoice-create", { params: { customerName: "Initech", total: 1200, issuedAt: "2026-04-01", dueAt: "2026-05-01" } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.invoice.status, "open");
    assert.equal(c.result.invoice.total, 1200);
    assert.match(c.result.invoice.number, /^INV-\d{5}/);
    const id = c.result.invoice.id;
    const paid = await lensRun("accounting", "invoice-mark-paid", { params: { id, paidAt: "2026-04-20" } }, ctx);
    assert.equal(paid.result.invoice.status, "paid");
    assert.equal(paid.result.invoice.paidAt, "2026-04-20");
    const open = await lensRun("accounting", "invoice-list", { params: { status: "open" } }, ctx);
    assert.ok(!(open.result.invoices || []).some((i) => i.id === id), "paid invoice not in open list");
    const all = await lensRun("accounting", "invoice-list", { params: { status: "all" } }, ctx);
    assert.ok((all.result.invoices || []).some((i) => i.id === id), "invoice in all list");
  });

  it("invoice-create: rejects a non-positive total", async () => {
    const bad = await lensRun("accounting", "invoice-create", { params: { customerName: "X", total: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /total must be > 0/i);
  });

  it("aging-ar: an open invoice 75 days past due lands in the 61–90 bucket", async () => {
    // due 2026-01-01, asOf 2026-03-17 → 75 days past due → d60 (61–90).
    await lensRun("accounting", "invoice-create", { params: { customerName: "Late Co", total: 500, issuedAt: "2025-12-01", dueAt: "2026-01-01" } }, ctx);
    const r = await lensRun("accounting", "aging-ar", { params: { asOf: "2026-03-17" } }, ctx);
    assert.equal(r.ok, true);
    const d60 = (r.result.buckets || []).find((b) => b.key === "d60");
    assert.equal(d60.total, 500);
    assert.equal(r.result.totalOpen, 500);             // the paid invoice above excluded
  });

  it("runway-forecast: burn rate + runway months derived from cash journal", async () => {
    // Fresh ctx to isolate cash math. One JE Dr Cash 1000 / Cr Revenue 1000 (in),
    // one JE Dr Rent 400 / Cr Cash 400 (out), both within trailing 90 days.
    const r9 = await depthCtx("accounting-runway9");
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("accounting", "je-post", { params: { date: today, memo: "in", lines: [
      { accountId: "acct_1000", debit: 1000, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 1000 },
    ] } }, r9);
    await lensRun("accounting", "je-post", { params: { date: today, memo: "out", lines: [
      { accountId: "acct_6100", debit: 400, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 400 },
    ] } }, r9);
    const r = await lensRun("accounting", "runway-forecast", { params: { months: 6 } }, r9);
    assert.equal(r.ok, true);
    assert.equal(r.result.cashOnHand, 600);            // 1000 − 400
    assert.equal(r.result.liquidity, 600);             // no open inv/bills
    assert.equal(r.result.monthlyNet, 200);            // (1000 in − 400 out) / 3
    assert.equal(r.result.monthlyBurn, 0);             // net positive → no burn
    assert.equal(r.result.runwayMonths, null);         // no burn → null
    assert.equal(r.result.forecast.length, 6);
  });

  it("ledger-list: filters journal rows by account and paginates", async () => {
    const lc = await depthCtx("accounting-ledger9");
    await lensRun("accounting", "je-post", { params: { date: "2026-06-01", memo: "A", lines: [
      { accountId: "acct_1000", debit: 300, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 300 },
    ] } }, lc);
    const r = await lensRun("accounting", "ledger-list", { params: { accountId: "acct_4000" } }, lc);
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);                   // only the revenue line matches
    assert.equal(r.result.rows[0].accountId, "acct_4000");
    assert.equal(r.result.rows[0].credit, 300);
  });
});

describe("accounting — recurring bills + payrun read + edits (wave 9 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-rec9"); });

  it("recurring-bills-create → run-due → toggle: due schedule mints one bill, toggle deactivates", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Utility Co" } }, ctx);
    const vendorId = v.result.vendor.id;
    const r = await lensRun("accounting", "recurring-bills-create", { params: {
      vendorId, total: 75, expenseAccountId: "acct_6000", cadence: "monthly", startAt: "2020-01-01",
    } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.recurringBill.active, true);
    const recId = r.result.recurringBill.id;
    // startAt in the past → due → run-due mints exactly one bill from this schedule.
    const run = await lensRun("accounting", "recurring-bills-run-due", { params: {} }, ctx);
    assert.equal(run.ok, true);
    assert.equal(run.result.count, 1);
    assert.equal(run.result.created[0].total, 75);
    assert.equal(run.result.created[0].recurringBillId, recId);
    assert.equal(run.result.created[0].status, "open");
    // Toggle off, then run-due again → nothing new (inactive skipped).
    const tog = await lensRun("accounting", "recurring-bills-toggle", { params: { id: recId } }, ctx);
    assert.equal(tog.result.recurringBill.active, false);
    const run2 = await lensRun("accounting", "recurring-bills-run-due", { params: {} }, ctx);
    assert.equal(run2.result.count, 0);                // inactive schedule produces nothing
  });

  it("recurring-bills-create: rejects an unknown vendor", async () => {
    const bad = await lensRun("accounting", "recurring-bills-create", { params: { vendorId: "vend_nope", total: 10, expenseAccountId: "acct_6000" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /vendor not found/i);
  });

  it("payrun-create → payrun-list → payrun-detail: run reads back with stub math", async () => {
    const e = await lensRun("accounting", "employee-create", { params: { name: "Det Ail", payType: "salary", rate: 24000 } }, ctx);
    const empId = e.result.employee.id;
    const run = await lensRun("accounting", "payrun-create", { params: {
      periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-16",
      lines: [{ employeeId: empId }],
    } }, ctx);
    assert.equal(run.ok, true);
    const runId = run.result.run.id;
    const list = await lensRun("accounting", "payrun-list", { params: {} }, ctx);
    const row = (list.result.runs || []).find((x) => x.id === runId);
    assert.ok(row, "run in payrun-list");
    assert.equal(row.totalGross, 1000);                // 24000 / 24
    const det = await lensRun("accounting", "payrun-detail", { params: { id: runId } }, ctx);
    assert.equal(det.ok, true);
    assert.equal(det.result.run.stubs[0].gross, 1000);
    assert.equal(det.result.run.stubs[0].net, 753.5);  // 1000 − (120 + 76.5 + 50) = 1000 − 246.5
  });

  it("payrun-detail: rejects an unknown run id", async () => {
    const bad = await lensRun("accounting", "payrun-detail", { params: { id: "run_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /pay run not found/i);
  });

  it("item-update: edits price/cost; reorderPoint only honored for inventory items", async () => {
    const it = await lensRun("accounting", "item-create", { params: { name: "Gadget", type: "inventory", price: 10, cost: 4, reorderPoint: 5 } }, ctx);
    const id = it.result.item.id;
    const upd = await lensRun("accounting", "item-update", { params: { id, price: 12.5, cost: 5, reorderPoint: 8 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.item.price, 12.5);
    assert.equal(upd.result.item.cost, 5);
    assert.equal(upd.result.item.reorderPoint, 8);
    const list = await lensRun("accounting", "item-list", { params: {} }, ctx);
    assert.ok((list.result.items || []).some((x) => x.id === id && x.price === 12.5), "updated price reads back");
  });

  it("item-update: rejects an unknown item", async () => {
    const bad = await lensRun("accounting", "item-update", { params: { id: "item_nope", price: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /item not found/i);
  });
});

describe("accounting — coa edits + dashboard + currency (wave 9 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-coa9"); });

  it("coa-update → coa-archive: rename then toggle-archive a default account", async () => {
    // Default CoA seeds acct_6100 Rent Expense. Rename + archive round-trip.
    const upd = await lensRun("accounting", "coa-update", { params: { id: "acct_6100", name: "Office Rent" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.account.name, "Office Rent");
    const arch = await lensRun("accounting", "coa-archive", { params: { id: "acct_6100" } }, ctx);
    assert.equal(arch.result.account.archived, true);
    const list = await lensRun("accounting", "coa-list", { params: {} }, ctx);
    assert.ok((list.result.accounts || []).some((a) => a.id === "acct_6100" && a.name === "Office Rent"), "renamed account in chart");
  });

  it("coa-update: rejects an unknown account id", async () => {
    const bad = await lensRun("accounting", "coa-update", { params: { id: "acct_nope", name: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /not found/i);
  });

  it("dashboard-summary: YTD revenue/expense/net + cash from the journal", async () => {
    const d = await depthCtx("accounting-dash9");
    const yr = new Date().getUTCFullYear();
    const D = (m, day) => `${yr}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    await lensRun("accounting", "je-post", { params: { date: D(2, 1), memo: "sale", lines: [
      { accountId: "acct_1000", debit: 3000, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 3000 },
    ] } }, d);
    await lensRun("accounting", "je-post", { params: { date: D(2, 5), memo: "rent", lines: [
      { accountId: "acct_6100", debit: 1000, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 1000 },
    ] } }, d);
    const r = await lensRun("accounting", "dashboard-summary", { params: {} }, d);
    assert.equal(r.ok, true);
    assert.equal(r.result.cashOnHand, 2000);           // 3000 − 1000
    assert.equal(r.result.ytdRevenue, 3000);
    assert.equal(r.result.ytdExpense, 1000);
    assert.equal(r.result.ytdNetIncome, 2000);         // 3000 − 1000
  });

  it("currency-set-base → currency-list: base reads back uppercased", async () => {
    const set = await lensRun("accounting", "currency-set-base", { params: { base: "eur" } }, ctx);
    assert.equal(set.result.base, "EUR");
    const list = await lensRun("accounting", "currency-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.base, "EUR");
    assert.ok(Array.isArray(list.result.rates));
  });

  it("currency-set-base: rejects a non-ISO currency code", async () => {
    const bad = await lensRun("accounting", "currency-set-base", { params: { base: "Dollars" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /3-letter ISO/i);
  });
});
