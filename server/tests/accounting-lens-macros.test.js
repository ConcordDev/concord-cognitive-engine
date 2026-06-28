// Behavioral macro tests for server/domains/accounting.js — the QuickBooks-shaped
// double-entry accounting substrate the /lenses/accounting lens drives.
//
// COMPLEMENT to accounting-domain-parity.test.js (which pins coa/je/ledger/
// balance-sheet/AR-aging on the STATE-backed path). This file pins the
// PURE-COMPUTE artifact macros the lens runs through useRunArtifact('accounting')
// → POST /api/lens/accounting/:id/run → LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// with virtualArtifact.data === input. Our harness mirrors that exactly so a
// regression that confuses the param positions surfaces here.
//
// These are NOT shape-only assertions. Every test feeds KNOWN inputs and asserts
// the EXACT computed value (trial balance debits/credits, P&L gross/net margin,
// invoice-aging buckets, budget variance %, rent-roll collection rate) so the
// financial math is pinned, not merely "ok:true".
//
// MONEY/CORRECTNESS SCRUTINY: these are pure calculators (no wallet, no minting),
// so the risk is fail-OPEN non-finite output, not minting. `parseFloat("Infinity")`
// and `Number("1e999")` both yield Infinity, and `Infinity || 0` is Infinity — so
// the naive `parseFloat(x) || 0` would let a poisoned amount flow straight into a
// computed total and emit a financial report containing Infinity/NaN. The domain
// was hardened with `finNum` (compute paths collapse non-finite → 0, FINITE output
// guaranteed) and `finiteOrNull` (je-post PERSISTED write rejects non-finite,
// fail-CLOSED so a poisoned 1e999 can never enter the journal). The poisoned-
// numeric block below pins both: a computed report stays finite, and a poisoned
// journal post is rejected.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccountingActions from "../domains/accounting.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "accounting", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input (so artifact.data.accounts etc. resolve).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  const virtualArtifact = { id: null, domain: "accounting", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAccountingActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// Every macro the lens page + components reach via lensRun / useRunArtifact.
const LENS_MACROS = [
  // pure-compute artifact actions (useRunArtifact)
  "trialBalance", "profitLoss", "invoiceAging", "budgetVariance", "rentRoll",
  "validate-ledger", "generate-invoice", "reconcile", "generate-statements",
  // STATE-backed actions the components call
  "coa-list", "je-post", "ledger-list", "balance-sheet-compute", "pl-compute",
  "cashflow-compute", "runway-forecast", "vendors-list",
  // lensRun-driven advanced panel macros
  "currency-list", "dimension-list", "recurring-bills-list", "audit-log-list",
];

describe("accounting — registration (every lens-driven macro present)", () => {
  it("registers every macro the lens calls", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing accounting.${m}`);
    }
  });
});

describe("accounting.trialBalance — exact double-entry math", () => {
  it("computes per-account net debit/credit and totals balanced", () => {
    const r = call("trialBalance", ctxA, {
      accounts: [
        { accountNumber: "1000", name: "Cash", type: "asset", entries: [
          { date: "2026-01-05", debit: 1000, credit: 0 },
          { date: "2026-01-10", debit: 0, credit: 250 },
        ] },
        { accountNumber: "4000", name: "Revenue", type: "revenue", entries: [
          { date: "2026-01-05", debit: 0, credit: 750 },
        ] },
      ],
    });
    assert.equal(r.ok, true);
    const cash = r.result.accounts.find((a) => a.accountNumber === "1000");
    const rev = r.result.accounts.find((a) => a.accountNumber === "4000");
    // Cash: 1000 - 250 = 750 net debit
    assert.equal(cash.debit, 750);
    assert.equal(cash.credit, 0);
    // Revenue: -750 net => 750 credit balance
    assert.equal(rev.debit, 0);
    assert.equal(rev.credit, 750);
    assert.equal(r.result.totalDebits, 750);
    assert.equal(r.result.totalCredits, 750);
    assert.equal(r.result.difference, 0);
    assert.equal(r.result.isBalanced, true);
  });

  it("asOfDate cutoff excludes later entries", () => {
    const r = call("trialBalance", ctxA, {
      asOfDate: "2026-01-06",
      accounts: [{ accountNumber: "1000", name: "Cash", type: "asset", entries: [
        { date: "2026-01-05", debit: 500, credit: 0 },
        { date: "2026-01-20", debit: 9999, credit: 0 },
      ] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDebits, 500); // the 2026-01-20 entry is excluded
  });

  it("degrade-graceful: empty accounts → ok:true, zero totals, balanced", () => {
    const r = call("trialBalance", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDebits, 0);
    assert.equal(r.result.totalCredits, 0);
    assert.equal(r.result.isBalanced, true);
  });
});

describe("accounting.profitLoss — gross/net margin math", () => {
  it("computes revenue, COGS, gross profit, expenses, net income + margins", () => {
    const r = call("profitLoss", ctxA, {
      startDate: "2026-01-01", endDate: "2026-12-31",
      accounts: [
        { accountNumber: "4000", name: "Sales", type: "revenue", entries: [
          { date: "2026-03-01", debit: 0, credit: 1000 },
        ] },
        { accountNumber: "5000", name: "COGS", type: "cogs", entries: [
          { date: "2026-03-02", debit: 400, credit: 0 },
        ] },
        { accountNumber: "6000", name: "Rent", type: "expense", entries: [
          { date: "2026-03-03", debit: 200, credit: 0 },
        ] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.revenue.total, 1000);
    assert.equal(r.result.costOfGoodsSold.total, 400);
    assert.equal(r.result.grossProfit, 600);
    assert.equal(r.result.grossMarginPct, 60); // 600/1000
    assert.equal(r.result.operatingExpenses.total, 200);
    assert.equal(r.result.netIncome, 400); // 600 - 200
    assert.equal(r.result.netMarginPct, 40); // 400/1000
  });

  it("zero revenue → margins are 0 (no divide-by-zero NaN)", () => {
    const r = call("profitLoss", ctxA, {
      startDate: "2026-01-01", endDate: "2026-12-31",
      accounts: [{ accountNumber: "6000", name: "Rent", type: "expense", entries: [
        { date: "2026-03-03", debit: 200, credit: 0 },
      ] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.grossMarginPct, 0);
    assert.equal(r.result.netMarginPct, 0);
    assert.equal(r.result.netIncome, -200);
  });
});

describe("accounting.invoiceAging — bucket assignment", () => {
  it("buckets unpaid invoices by days overdue and sums totals", () => {
    const r = call("invoiceAging", ctxA, {
      asOfDate: "2026-02-01",
      invoices: [
        { invoiceId: "A", customer: "X", amount: 100, dueDate: "2026-02-10" }, // future → current
        { invoiceId: "B", customer: "Y", amount: 200, dueDate: "2026-01-20" }, // 12d → 1-30
        { invoiceId: "C", customer: "Z", amount: 300, dueDate: "2025-10-01" }, // >90d → 90+
        { invoiceId: "D", customer: "W", amount: 999, dueDate: "2026-01-25", paidDate: "2026-01-26" }, // paid → excluded
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalInvoices, 4);
    assert.equal(r.result.unpaidCount, 3);
    assert.equal(r.result.buckets.current.total, 100);
    assert.equal(r.result.buckets["1-30"].total, 200);
    assert.equal(r.result.buckets["90+"].total, 300);
    assert.equal(r.result.totalOutstanding, 600);
    assert.equal(r.result.totalOverdue, 500); // total - current
  });
});

describe("accounting.budgetVariance — variance + status", () => {
  it("computes per-line variance %, status, and totals", () => {
    const r = call("budgetVariance", ctxA, {
      period: "Q1",
      budget: [
        { category: "Marketing", planned: 1000, actual: 1200 }, // +200 over
        { category: "Travel", planned: 500, actual: 400 },      // -100 under
        { category: "Rent", planned: 2000, actual: 2000 },      // on-budget
      ],
    });
    assert.equal(r.ok, true);
    const mkt = r.result.lineItems.find((l) => l.category === "Marketing");
    assert.equal(mkt.variance, 200);
    assert.equal(mkt.variancePct, 20); // 200/1000
    assert.equal(mkt.status, "over-budget");
    assert.equal(r.result.lineItems.find((l) => l.category === "Travel").status, "under-budget");
    assert.equal(r.result.lineItems.find((l) => l.category === "Rent").status, "on-budget");
    assert.equal(r.result.totalPlanned, 3500);
    assert.equal(r.result.totalActual, 3600);
    assert.equal(r.result.totalVariance, 100);
    assert.equal(r.result.overBudgetCount, 1);
    assert.equal(r.result.largestOverrun.category, "Marketing");
  });
});

describe("accounting.rentRoll — occupancy + collection", () => {
  it("computes occupancy + collection rate from units", () => {
    const r = call("rentRoll", ctxA, {
      asOfMonth: "2026-02",
      properties: [{ propertyId: "P1", address: "1 Main", units: [
        { unitId: "1A", tenant: "Alice", monthlyRent: 1000, paidThrough: "2026-03-01" }, // occupied + paid
        { unitId: "1B", tenant: "Bob", monthlyRent: 1000, paidThrough: "2025-12-01" },   // occupied + unpaid
        { unitId: "1C", tenant: null, monthlyRent: 1000 },                                // vacant
      ] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalUnits, 3);
    assert.equal(r.result.occupiedUnits, 2);
    assert.equal(r.result.vacantUnits, 1);
    assert.equal(r.result.totalExpectedRent, 2000); // 2 occupied
    assert.equal(r.result.totalCollected, 1000);    // 1 paid
    assert.equal(r.result.totalOutstanding, 1000);
    assert.equal(r.result.collectionRate, 50); // 1000/2000
  });
});

describe("accounting.validate-ledger — balance check + flags", () => {
  it("flags out-of-balance and wrong-side accounts", () => {
    const r = call("validate-ledger", ctxA, {
      accounts: [
        { name: "Cash", type: "asset", entries: [{ debit: 100, credit: 0 }] },
        { name: "Revenue", type: "revenue", entries: [{ debit: 0, credit: 80 }] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDebits, 100);
    assert.equal(r.result.totalCredits, 80);
    assert.equal(r.result.difference, 20);
    assert.equal(r.result.isBalanced, false);
    assert.equal(r.result.severity, "error");
  });

  it("balanced books with correct sides → ok severity", () => {
    const r = call("validate-ledger", ctxA, {
      accounts: [
        { name: "Cash", type: "asset", entries: [{ debit: 100, credit: 0 }] },
        { name: "Revenue", type: "revenue", entries: [{ debit: 0, credit: 100 }] },
      ],
    });
    assert.equal(r.result.isBalanced, true);
    assert.equal(r.result.severity, "ok");
  });
});

describe("accounting.generate-invoice — line-item totals", () => {
  it("computes subtotal + tax + grand total from line items", () => {
    const r = call("generate-invoice", ctxA, {
      lineItems: [
        { description: "Widget", quantity: 3, unitPrice: 10, taxRate: 0.1 }, // 30 + 3 tax
        { description: "Gadget", quantity: 2, unitPrice: 50 },               // 100, no tax
      ],
      client: { name: "Acme" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 130);
    assert.equal(r.result.totalTax, 3);
    assert.equal(r.result.grandTotal, 133);
  });
});

describe("accounting — STATE-backed round-trip (je-post → balance-sheet)", () => {
  it("posts a balanced entry and the trial balance reflects it", () => {
    call("coa-list", ctxA); // seed default CoA (acct_1000 cash, acct_4000 revenue)
    const post = call("je-post", ctxA, {
      date: "2026-01-15",
      memo: "sale",
      lines: [
        { accountId: "acct_1000", debit: 500, credit: 0 },
        { accountId: "acct_4000", debit: 0, credit: 500 },
      ],
    });
    assert.equal(post.ok, true);
    assert.equal(post.result.entry.totalDebit, 500);
    assert.equal(post.result.entry.totalCredit, 500);
    const pl = call("pl-compute", ctxA, { start: "2026-01-01", end: "2026-12-31" });
    assert.equal(pl.ok, true);
    assert.equal(pl.result.revenue.total, 500);
  });
});

describe("accounting — validation rejection", () => {
  it("je-post rejects unbalanced entry", () => {
    call("coa-list", ctxA);
    const r = call("je-post", ctxA, {
      lines: [
        { accountId: "acct_1000", debit: 500, credit: 0 },
        { accountId: "acct_4000", debit: 0, credit: 499 },
      ],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unbalanced/);
  });

  it("je-post rejects fewer than 2 lines", () => {
    call("coa-list", ctxA);
    const r = call("je-post", ctxA, { lines: [{ accountId: "acct_1000", debit: 1, credit: 0 }] });
    assert.equal(r.ok, false);
  });
});

describe("accounting — POISONED NUMERICS (fail-closed finite guarantee)", () => {
  const POISON = ["Infinity", "1e999", "-Infinity", "NaN", "1e308"];

  it("trialBalance: poisoned debit/credit → totals stay FINITE (collapse to 0)", () => {
    for (const p of POISON) {
      const r = call("trialBalance", ctxA, {
        accounts: [{ accountNumber: "1000", name: "Cash", type: "asset", entries: [
          { date: "2026-01-05", debit: p, credit: 0 },
          { date: "2026-01-06", debit: 100, credit: 0 },
        ] }],
      });
      assert.equal(r.ok, true, `trialBalance should not crash on ${p}`);
      assert.ok(Number.isFinite(r.result.totalDebits), `totalDebits finite for ${p}, got ${r.result.totalDebits}`);
      assert.ok(Number.isFinite(r.result.totalCredits), `totalCredits finite for ${p}`);
      assert.ok(Number.isFinite(r.result.difference), `difference finite for ${p}`);
      // 1e308 is itself a finite number; everything else collapses to 0.
      // Either way the poison never produces Infinity/NaN in the report.
    }
  });

  it("profitLoss: poisoned amounts → all numeric outputs FINITE", () => {
    const r = call("profitLoss", ctxA, {
      startDate: "2026-01-01", endDate: "2026-12-31",
      accounts: [{ accountNumber: "4000", name: "Sales", type: "revenue", entries: [
        { date: "2026-03-01", debit: 0, credit: "1e999" },
      ] }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.revenue.total));
    assert.ok(Number.isFinite(r.result.grossProfit));
    assert.ok(Number.isFinite(r.result.netIncome));
    assert.ok(Number.isFinite(r.result.grossMarginPct));
    assert.ok(Number.isFinite(r.result.netMarginPct));
    // "1e999" → Infinity → collapses to 0, so revenue is 0, not Infinity.
    assert.equal(r.result.revenue.total, 0);
  });

  it("budgetVariance: poisoned planned/actual → FINITE variance + pct", () => {
    const r = call("budgetVariance", ctxA, {
      budget: [{ category: "X", planned: "Infinity", actual: "1e999" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalPlanned));
    assert.ok(Number.isFinite(r.result.totalActual));
    assert.ok(Number.isFinite(r.result.totalVariance));
    assert.ok(Number.isFinite(r.result.totalVariancePct));
    assert.ok(Number.isFinite(r.result.lineItems[0].variancePct));
  });

  it("invoiceAging: poisoned amount → FINITE outstanding total", () => {
    const r = call("invoiceAging", ctxA, {
      asOfDate: "2026-02-01",
      invoices: [{ invoiceId: "A", customer: "X", amount: "1e999", dueDate: "2026-01-20" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalOutstanding));
    assert.ok(Number.isFinite(r.result.totalOverdue));
    assert.equal(r.result.totalOutstanding, 0); // poison collapsed
  });

  it("generate-invoice: poisoned qty/unitPrice → FINITE grand total", () => {
    const r = call("generate-invoice", ctxA, {
      lineItems: [{ description: "X", quantity: "1e999", unitPrice: "Infinity" }],
      client: { name: "Acme" },
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.subtotal));
    assert.ok(Number.isFinite(r.result.grandTotal));
    assert.equal(r.result.grandTotal, 0); // both poisoned → 0
  });

  it("je-post: poisoned amount is REJECTED (fail-closed, never persisted)", () => {
    for (const p of POISON.filter((x) => x !== "NaN")) {
      call("coa-list", ctxA);
      const r = call("je-post", ctxA, {
        lines: [
          { accountId: "acct_1000", debit: p, credit: 0 },
          { accountId: "acct_4000", debit: 0, credit: p },
        ],
      });
      assert.equal(r.ok, false, `je-post must reject poisoned ${p}`);
      assert.match(r.error, /finite|unbalanced/, `clear rejection for ${p}, got ${r.error}`);
    }
  });

  it("je-post: a poisoned post does NOT corrupt a subsequent clean report", () => {
    call("coa-list", ctxA);
    // poisoned post rejected
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_1000", debit: "1e999", credit: 0 },
        { accountId: "acct_4000", debit: 0, credit: "1e999" },
      ],
    });
    // clean post succeeds
    call("je-post", ctxA, {
      lines: [
        { accountId: "acct_1000", debit: 300, credit: 0 },
        { accountId: "acct_4000", debit: 0, credit: 300 },
      ],
    });
    const pl = call("pl-compute", ctxA, { start: "2026-01-01", end: "2026-12-31" });
    assert.equal(pl.ok, true);
    assert.equal(pl.result.revenue.total, 300); // only the clean entry, FINITE
    assert.ok(Number.isFinite(pl.result.netIncome));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FRONTEND FIELD-NAME ALIGNMENT CONTRACTS (re-audit 2026-06-28)
//
// The blocks above pin the PURE-COMPUTE artifact macros (useRunArtifact). This
// block pins the STATE-backed compute macros the concord-frontend/components/
// accounting/* panels call via `lensRun({ domain, action, input })`. Each test
// drives the EXACT `input` object a specific component sends and asserts the
// handler returns the EXACT field names that component renders from
// `r.data?.result` — both directions, so a renamed field on either side
// (the bug class: component renders `r.alt` while handler returns `r.altitude`)
// surfaces here as a failing assertion instead of a silently-blank UI panel.
//
// The component each contract mirrors is named in the describe title. The
// re-audit found ZERO live mismatches — these tests lock that clean state in.
// ───────────────────────────────────────────────────────────────────────────

// Seed a realistic 2026 book: revenue, an expense, an open invoice (A/R),
// an open bill (A/P). Cash account = acct_1000, A/R = acct_1100,
// A/P = acct_2000, revenue = acct_4000, expense = acct_6000.
function seedBook(ctx) {
  call("coa-list", ctx); // seed default CoA
  // Cash sale: Dr Cash 1000 / Cr Revenue 1000  (date in 2026 → YTD)
  call("je-post", ctx, {
    date: "2026-03-01",
    memo: "cash sale",
    lines: [
      { accountId: "acct_1000", debit: 1000, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 1000 },
    ],
  });
  // Rent paid: Dr Rent Expense 6100 / Cr Cash 1000
  call("je-post", ctx, {
    date: "2026-03-05",
    memo: "rent",
    lines: [
      { accountId: "acct_6100", debit: 200, credit: 0 },
      { accountId: "acct_1000", debit: 0, credit: 200 },
    ],
  });
}

describe("accounting — financial-ratios contract (AcRatiosPanel.tsx)", () => {
  it("returns every field AcRatiosPanel renders, with real computed values", () => {
    // Build a balance-sheet-bearing book: equity injection + AR + AP.
    call("coa-list", ctxA);
    // Owner funds cash: Dr Cash 1000 / Cr Owner's Equity 3000
    call("je-post", ctxA, { date: "2026-01-02", memo: "seed equity", lines: [
      { accountId: "acct_1000", debit: 2000, credit: 0 },
      { accountId: "acct_3000", debit: 0, credit: 2000 },
    ] });
    // Credit sale: Dr A/R 1100 / Cr Revenue 4000
    call("je-post", ctxA, { date: "2026-02-01", memo: "credit sale", lines: [
      { accountId: "acct_1100", debit: 500, credit: 0 },
      { accountId: "acct_4000", debit: 0, credit: 500 },
    ] });
    // Incur a payable: Dr Office Expense 6000 / Cr A/P 2000
    call("je-post", ctxA, { date: "2026-02-10", memo: "supplies on account", lines: [
      { accountId: "acct_6000", debit: 300, credit: 0 },
      { accountId: "acct_2000", debit: 0, credit: 300 },
    ] });

    const r = call("financial-ratios", ctxA, {}); // component sends input: {}
    assert.equal(r.ok, true);
    const res = r.result;
    // Exact fields the panel's <Card> + "Underlying totals" block read:
    for (const k of ["currentRatio", "quickRatio", "debtToEquity", "grossMarginPct", "netMarginPct", "workingCapital", "totals", "note"]) {
      assert.ok(k in res, `financial-ratios must return ${k}`);
    }
    for (const k of ["currentAssets", "totalAssets", "currentLiabilities", "totalLiabilities", "revenue", "netIncome"]) {
      assert.ok(k in res.totals, `financial-ratios.totals must return ${k}`);
    }
    // currentAssets = cash 2000 + AR 500 = 2500 ; currentLiab = AP 300.
    assert.equal(res.totals.currentAssets, 2500);
    assert.equal(res.totals.currentLiabilities, 300);
    assert.equal(res.totals.revenue, 500);
    // currentRatio = 2500/300 = 8.33 ; workingCapital = 2500-300 = 2200.
    assert.equal(res.currentRatio, Math.round((2500 / 300) * 100) / 100);
    assert.equal(res.workingCapital, 2200);
    // netIncome = revenue 500 − cogs 0 − expense 300 = 200.
    assert.equal(res.totals.netIncome, 200);
    assert.equal(typeof res.note, "string");
  });
});

describe("accounting — cashflow-compute contract (CashFlowStatement.tsx)", () => {
  it("returns period/series/totalIn/totalOut/netCashFlow with month/in/out/net rows", () => {
    seedBook(ctxA);
    // EXACT input the component sends: { start, end }
    const r = call("cashflow-compute", ctxA, { start: "2026-01-01", end: "2026-12-31" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(res.period && "start" in res.period && "end" in res.period);
    assert.ok(Array.isArray(res.series));
    // Series rows expose exactly month/in/out/net (the BarChart dataKeys).
    for (const row of res.series) {
      for (const k of ["month", "in", "out", "net"]) assert.ok(k in row, `series row needs ${k}`);
    }
    // Cash in 1000 (the sale), cash out 200 (rent), net 800.
    assert.equal(res.totalIn, 1000);
    assert.equal(res.totalOut, 200);
    assert.equal(res.netCashFlow, 800);
  });
});

describe("accounting — runway-forecast contract (RunwayForecast.tsx)", () => {
  it("returns cashOnHand/openInvTotal/openBillsTotal/liquidity/monthlyNet/monthlyBurn/runwayMonths/forecast", () => {
    seedBook(ctxA);
    // Open invoice (A/R) and open bill (A/P) feed liquidity.
    call("invoice-create", ctxA, { customerName: "Acme", total: 400 });
    call("vendors-create", ctxA, { name: "Supplier" });
    const vlist = call("vendors-list", ctxA);
    const vendorId = vlist.result.vendors[0].id;
    call("bills-create", ctxA, { vendorId, total: 150, expenseAccountId: "acct_6000" });

    // EXACT input the component sends: { months }
    const r = call("runway-forecast", ctxA, { months: 12 });
    assert.equal(r.ok, true);
    const res = r.result;
    for (const k of ["cashOnHand", "openInvTotal", "openBillsTotal", "liquidity", "monthlyNet", "monthlyBurn", "runwayMonths", "forecast"]) {
      assert.ok(k in res, `runway-forecast must return ${k}`);
    }
    // cash = 1000 − 200 = 800 ; +AR 400 − AP 150 → liquidity 1050.
    assert.equal(res.cashOnHand, 800);
    assert.equal(res.openInvTotal, 400);
    assert.equal(res.openBillsTotal, 150);
    assert.equal(res.liquidity, 1050);
    // forecast rows expose month/projected/in/out (the AreaChart dataKeys + Tiles).
    assert.equal(res.forecast.length, 12);
    for (const row of res.forecast) {
      for (const k of ["month", "projected", "in", "out"]) assert.ok(k in row, `forecast row needs ${k}`);
    }
  });
});

describe("accounting — budget-vs-actual contract (AcBudgetsPanel.tsx)", () => {
  it("returns budget/fiscalYear/rows/totalBudgeted/totalActual with row account/budgeted/actual/variance", () => {
    seedBook(ctxA); // posts a 2026 expense against acct_6100 (Rent), actual = 200
    const created = call("budget-create", ctxA, { name: "FY26", fiscalYear: 2026 });
    const budgetId = created.result.budget.id;
    // component sends { budgetId, accountId, annualAmount }
    call("budget-set-line", ctxA, { budgetId, accountId: "acct_6100", annualAmount: 500 });

    // EXACT input the component sends to load BvA: { budgetId }
    const r = call("budget-vs-actual", ctxA, { budgetId });
    assert.equal(r.ok, true);
    const res = r.result;
    for (const k of ["budget", "fiscalYear", "rows", "totalBudgeted", "totalActual"]) {
      assert.ok(k in res, `budget-vs-actual must return ${k}`);
    }
    assert.equal(res.budget, "FY26");
    assert.equal(res.fiscalYear, 2026);
    const rent = res.rows.find((x) => x.accountId === "acct_6100");
    // Row fields the panel renders: account/budgeted/actual/variance.
    for (const k of ["accountId", "account", "budgeted", "actual", "variance"]) {
      assert.ok(k in rent, `bva row needs ${k}`);
    }
    assert.equal(rent.account, "Rent Expense");
    assert.equal(rent.budgeted, 500);
    assert.equal(rent.actual, 200); // the 2026-03-05 rent JE
    assert.equal(rent.variance, -300); // 200 − 500
    assert.equal(res.totalBudgeted, 500);
    assert.equal(res.totalActual, 200);
  });
});

describe("accounting — tax-liability contract (AcSalesTaxPanel.tsx)", () => {
  it("returns salesTaxPayable (the single field the panel renders)", () => {
    call("coa-list", ctxA);
    // Accrue sales tax: Dr Cash 1000 / Cr Sales Tax Payable 2100 (110).
    call("je-post", ctxA, { date: "2026-04-01", memo: "collect tax", lines: [
      { accountId: "acct_1000", debit: 110, credit: 0 },
      { accountId: "acct_2100", debit: 0, credit: 110 },
    ] });
    const r = call("tax-liability", ctxA, {}); // component sends input: {}
    assert.equal(r.ok, true);
    assert.ok("salesTaxPayable" in r.result);
    assert.equal(r.result.salesTaxPayable, 110);
  });
});

describe("accounting — aging-ap contract (APAgingPanel.tsx + BillsPanel.tsx)", () => {
  it("returns asOf/buckets/totalOpen with key/label/total/bills[] and bill number/vendorName/total/dueAt/daysPastDue", () => {
    call("coa-list", ctxA);
    call("vendors-create", ctxA, { name: "OverdueCo" });
    const vendorId = call("vendors-list", ctxA).result.vendors[0].id;
    // A bill due long ago → lands in d90plus when asOf is well past due.
    call("bills-create", ctxA, { vendorId, total: 250, expenseAccountId: "acct_6000", issuedAt: "2026-01-01", dueAt: "2026-01-10" });

    const r = call("aging-ap", ctxA, { asOf: "2026-06-01" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok("asOf" in res && "totalOpen" in res && Array.isArray(res.buckets));
    for (const b of res.buckets) {
      for (const k of ["key", "label", "total", "bills"]) assert.ok(k in b, `bucket needs ${k}`);
    }
    assert.equal(res.totalOpen, 250);
    const allBills = res.buckets.flatMap((b) => b.bills);
    assert.equal(allBills.length, 1);
    const bill = allBills[0];
    // Fields the APAgingPanel <li> renders: number/vendorName/total/dueAt/daysPastDue.
    for (const k of ["number", "vendorName", "total", "dueAt", "daysPastDue"]) {
      assert.ok(k in bill, `aged bill needs ${k}`);
    }
    assert.equal(bill.vendorName, "OverdueCo");
    assert.equal(bill.total, 250);
    assert.ok(bill.daysPastDue > 90); // due 2026-01-10, asOf 2026-06-01
  });
});

describe("accounting — dashboard-summary contract (AccountingDashboard.tsx + BooksSection.tsx)", () => {
  it("returns all 11 KPI fields the dashboard tiles + badges render", () => {
    seedBook(ctxA);
    call("invoice-create", ctxA, { customerName: "Acme", total: 400 });
    call("vendors-create", ctxA, { name: "Supplier" });
    const vendorId = call("vendors-list", ctxA).result.vendors[0].id;
    call("bills-create", ctxA, { vendorId, total: 150, expenseAccountId: "acct_6000" });

    const r = call("dashboard-summary", ctxA, {}); // component sends input: {}
    assert.equal(r.ok, true);
    const res = r.result;
    for (const k of [
      "cashOnHand", "openInvTotal", "openInvCount", "openBillsTotal", "openBillsCount",
      "ytdRevenue", "ytdExpense", "ytdNetIncome", "uncategorizedTxns", "customerCount", "vendorCount",
    ]) {
      assert.ok(k in res, `dashboard-summary must return ${k}`);
      assert.ok(Number.isFinite(res[k]), `${k} must be finite`);
    }
    // cash = 1000 − 200 = 800 ; one open invoice 400 ; one open bill 150.
    assert.equal(res.cashOnHand, 800);
    assert.equal(res.openInvTotal, 400);
    assert.equal(res.openInvCount, 1);
    assert.equal(res.openBillsTotal, 150);
    assert.equal(res.openBillsCount, 1);
    assert.equal(res.ytdRevenue, 1000);
    assert.equal(res.vendorCount, 1);
  });
});

describe("accounting — po-list contract (AcPurchaseOrdersPanel.tsx)", () => {
  it("po-create input shape round-trips to po-list with number/vendorName/lines/total/status", () => {
    call("coa-list", ctxA);
    call("vendors-create", ctxA, { name: "PartsCo" });
    const vendorId = call("vendors-list", ctxA).result.vendors[0].id;
    // EXACT input the component sends: { vendorId, lines:[{description,qty,unitCost}] }
    const created = call("po-create", ctxA, {
      vendorId,
      lines: [
        { description: "Bolt", qty: 10, unitCost: 2 },
        { description: "Nut", qty: 5, unitCost: 1 },
      ],
    });
    assert.equal(created.ok, true);

    const r = call("po-list", ctxA, {}); // component sends input: {}
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.purchaseOrders));
    const po = r.result.purchaseOrders[0];
    for (const k of ["id", "number", "vendorName", "lines", "total", "status"]) {
      assert.ok(k in po, `purchase order needs ${k}`);
    }
    assert.equal(po.vendorName, "PartsCo");
    assert.equal(po.total, 25); // 10*2 + 5*1
    assert.equal(po.status, "open");
    // Each line exposes qty/description (rendered as `${qty}× ${description}`).
    for (const line of po.lines) {
      assert.ok("qty" in line && "description" in line && "unitCost" in line);
    }
  });
});

describe("accounting — estimates round-trip contract (EstimatesPanel.tsx)", () => {
  it("estimates-create input round-trips to estimates-list with the rendered fields", () => {
    call("coa-list", ctxA);
    // EXACT input the component sends (draft spread + numeric total):
    call("estimates-create", ctxA, { customerName: "Beta LLC", total: 1200, memo: "Q3 scope", expiresAt: "2026-09-30" });
    const r = call("estimates-list", ctxA, {});
    assert.equal(r.ok, true);
    const est = r.result.estimates[0];
    for (const k of ["id", "number", "customerName", "customerId", "total", "status", "issuedAt", "expiresAt", "memo", "convertedInvoiceId"]) {
      assert.ok(k in est, `estimate needs ${k}`);
    }
    assert.equal(est.customerName, "Beta LLC");
    assert.equal(est.total, 1200);
    assert.equal(est.status, "pending");
    assert.equal(est.convertedInvoiceId, null);
  });
});

describe("accounting — invoice-create-payment-link result-shape contract (StripeInvoicePanel/AccountingWorkbench)", () => {
  it("missing-Stripe path returns ok:false (no hostedUrl/pdfUrl fabricated)", async () => {
    // The panels read result.hostedUrl + result.pdfUrl on success, OR
    // result.invoice.stripeHostedInvoiceUrl. Without STRIPE_SECRET_KEY the
    // handler must fail-closed — never invent a link. This pins that the
    // success-shape fields are gated behind a real Stripe call.
    // (invoice-create-payment-link is an async handler — await it.)
    const prior = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      call("coa-list", ctxA);
      const inv = call("invoice-create", ctxA, { customerName: "Acme", total: 500 });
      const id = inv.result.invoice.id;
      const r = await call("invoice-create-payment-link", ctxA, { id, customerEmail: "a@b.com" });
      assert.equal(r.ok, false);
      assert.match(r.error, /Stripe/);
    } finally {
      if (prior !== undefined) process.env.STRIPE_SECRET_KEY = prior;
    }
  });
});
