// Behavioral macro tests for server/domains/billing.js — the Stripe-Billing-shaped
// subscription/invoice/usage/tax substrate the /lenses/billing lens drives via
// lensRun('billing', …) (concord-frontend/components/billing/SubscriptionBillingSuite.tsx)
// and the page-level invoice/revenue/churn analyzers (useRunArtifact → artifact path).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150/39283):
// handlers registered via `registerLensAction(domain, action, handler)` are invoked
// as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// virtualArtifact.data === input. Our harness calls fn(ctx, virtualArtifact, input),
// NOT (ctx, input), so a regression that confuses the param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed values —
// invoice subtotal/discount/tax/total, mid-cycle proration credit/charge, graduated
// usage-tier rollup, coupon discount, per-jurisdiction tax + B2B reverse charge,
// dunning lifecycle, revenue recognition (ASC-606 allocation) and churn scoring.
//
// MONEY-PATH SCRUTINY: the page money compute (invoiceCalculation / revenueRecognition
// / churnPrediction) used `parseFloat(x) || 0`, which is FAIL-OPEN —
// parseFloat("Infinity")||0 === Infinity and parseFloat("1e999")||0 === Infinity are
// both truthy, so a poisoned numeric leaks a non-finite value into a subtotal/total,
// and a finite-but-huge 1e308 overflows to Infinity at the ×100 cents step. The
// 2026-06-27 fix routes every numeric input through `finNum` (collapse non-finite or
// |v|>1e12 → 0) so every computed total stays FINITE (fail-CLOSED on the compute path).
// The in-memory subscription macros already fail closed: usage/dunning reject a
// non-positive (and therefore Infinity-collapsed) quantity/amount, plan/coupon clamp at
// create, so a poisoned charge can never be persisted. Both classes are pinned below.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBillingActions from "../domains/billing.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "billing", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input), data === input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`billing.${name} not registered`);
  const virtualArtifact = { id: null, domain: "billing", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerBillingActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("billing — registration (every lens-driven macro present)", () => {
  it("registers the 3 analyzer macros + 19 lensRun subscription macros", () => {
    for (const m of [
      // page-level analyzers (useRunArtifact / artifact path)
      "invoiceCalculation", "revenueRecognition", "churnPrediction",
      // SubscriptionBillingSuite lensRun('billing', …) actions
      "plan-list", "plan-create", "subscription-list", "subscription-create",
      "subscription-proration", "subscription-cancel",
      "usage-record", "usage-summary",
      "coupon-list", "coupon-create", "coupon-apply",
      "dunning-open", "dunning-list", "dunning-retry",
      "portal-overview", "portal-update-card",
      "tax-jurisdictions", "tax-calculate",
      "invoice-create", "revenue-analytics",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing billing.${m}`);
    }
  });
});

// ── invoiceCalculation — the money math the page renders ─────────────────────

describe("billing.invoiceCalculation — exact subtotal / discount / tax / total", () => {
  it("computes a plain invoice with tax (3 widgets @ 10, 10% tax)", () => {
    const r = call("invoiceCalculation", ctxA, { lineItems: [{ description: "Widget", quantity: 3, unitPrice: 10, taxable: true }], taxRate: 0.1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 30);
    assert.equal(r.result.tax.taxAmount, 3);
    assert.equal(r.result.tax.ratePct, 10);
    assert.equal(r.result.total, 33);
    assert.equal(r.result.lineItems[0].lineTotal, 30);
    assert.equal(r.result.lineItems[0].effectiveUnitPrice, 10);
  });

  it("applies a percentage discount BEFORE tax (10 units @ 10, 10% off, 10% tax)", () => {
    const r = call("invoiceCalculation", ctxA, {
      lineItems: [{ description: "A", quantity: 10, unitPrice: 10, taxable: true }],
      discountRules: [{ type: "percentage", value: 0.1 }],
      taxRate: 0.1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 100);
    assert.equal(r.result.discounts.totalDiscount, 10);
    assert.equal(r.result.afterDiscount, 90);
    assert.equal(r.result.tax.taxAmount, 9);   // 10% of the post-discount taxable base
    assert.equal(r.result.total, 99);
  });

  it("caps a fixed discount at the subtotal (never negative)", () => {
    const r = call("invoiceCalculation", ctxA, {
      lineItems: [{ description: "A", quantity: 1, unitPrice: 50 }],
      discountRules: [{ type: "fixed", value: 80 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 50);
    assert.equal(r.result.discounts.totalDiscount, 50);  // clamped to subtotal
    assert.equal(r.result.afterDiscount, 0);
    assert.equal(r.result.total, 0);
  });

  it("degrades gracefully on empty line items (validation, not crash)", () => {
    const r = call("invoiceCalculation", ctxA, { lineItems: [] });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === "string");
  });

  // MONEY-PATH FAIL-CLOSED: poisoned numerics stay FINITE (were leaking Infinity).
  it("fail-CLOSED: Infinity / 1e999 quantity+unitPrice collapse to a finite total", () => {
    const r = call("invoiceCalculation", ctxA, {
      lineItems: [{ description: "Poison", quantity: "1e999", unitPrice: "Infinity", taxable: true }],
      taxRate: "Infinity",
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.subtotal), "subtotal finite");
    assert.ok(Number.isFinite(r.result.tax.taxAmount), "tax finite");
    assert.ok(Number.isFinite(r.result.total), "total finite");
    assert.equal(r.result.total, 0);
  });

  it("fail-CLOSED: a finite-but-absurd 1e308 unitPrice does NOT overflow to Infinity at the cents step", () => {
    const r = call("invoiceCalculation", ctxA, {
      lineItems: [{ description: "Huge", quantity: 1, unitPrice: 1e308 }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.total), "total finite, not Infinity");
    assert.equal(r.result.total, 0);  // > 1e12 cap → collapses to 0
  });

  it("fail-CLOSED: poisoned discount rule value cannot drive the total non-finite", () => {
    const r = call("invoiceCalculation", ctxA, {
      lineItems: [{ description: "A", quantity: 2, unitPrice: 25 }],
      discountRules: [{ type: "percentage", value: "Infinity" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.total));
    assert.equal(r.result.discounts.totalDiscount, 0);  // Infinity → 0
    assert.equal(r.result.total, 50);
  });
});

// ── subscription-proration — mid-cycle credit/charge ─────────────────────────

describe("billing.subscription-proration — exact credit / charge / direction", () => {
  function seedSub(ctx, oldAmt, newAmt, qty) {
    const p1 = call("plan-create", ctx, { name: "Basic", interval: "monthly", amount: oldAmt });
    const p2 = call("plan-create", ctx, { name: "Pro", interval: "monthly", amount: newAmt });
    const sub = call("subscription-create", ctx, { planId: p1.result.plan.id, customerName: "Acme", quantity: qty });
    return { p1, p2, sub };
  }

  it("upgrade just after subscribe: unusedCredit/charge use full remaining period", () => {
    const { p2, sub } = seedSub(ctxA, 30, 60, 2);  // 2 seats, 30 → 60
    const r = call("subscription-proration", ctxA, { subscriptionId: sub.result.subscription.id, newPlanId: p2.result.plan.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.unusedCredit, 60);       // 30 * 2 * ~1.0
    assert.equal(r.result.newPlanProrated, 120);   // 60 * 2 * ~1.0
    assert.equal(r.result.amountDue, 60);          // 120 - 60
    assert.equal(r.result.direction, "upgrade-charge");
  });

  it("downgrade flips direction to credit (60 → 30)", () => {
    const { p2, sub } = seedSub(ctxB, 60, 30, 1);  // sub is on p1 (60); switch to cheaper p2 (30)
    const r = call("subscription-proration", ctxB, { subscriptionId: sub.result.subscription.id, newPlanId: p2.result.plan.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.amountDue < 0, "credit owed");
    assert.equal(r.result.direction, "downgrade-credit");
  });

  it("apply:true switches the live plan id and stamps applied", () => {
    const { p2, sub } = seedSub(ctxA, 30, 60, 1);
    const r = call("subscription-proration", ctxA, { subscriptionId: sub.result.subscription.id, newPlanId: p2.result.plan.id, apply: true });
    assert.equal(r.result.applied, true);
    const after = call("subscription-list", ctxA);
    assert.equal(after.result.subscriptions[0].planId, p2.result.plan.id);
  });

  it("rejects an unknown subscription", () => {
    const r = call("subscription-proration", ctxA, { subscriptionId: "ghost", newPlanId: "ghost2" });
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === "string");
  });
});

// ── usage-summary — graduated rate-tier rollup ───────────────────────────────

describe("billing.usage-summary — graduated tier charge from recorded usage", () => {
  it("5000 units → 1000 free + 4000 @ 0.002 = 8.00", () => {
    const sub = call("subscription-create", ctxA, { planId: call("plan-create", ctxA, { name: "P", amount: 10 }).result.plan.id, customerName: "C" });
    const subId = sub.result.subscription.id;
    call("usage-record", ctxA, { subscriptionId: subId, metric: "api_calls", quantity: 5000 });
    const r = call("usage-summary", ctxA, { subscriptionId: subId });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalQuantity, 5000);
    assert.equal(r.result.recordCount, 1);
    assert.equal(r.result.totalCharge, 8);
    assert.equal(r.result.tierBreakdown.length, 2);
    assert.equal(r.result.tierBreakdown[0].charge, 0);   // free tier
    assert.equal(r.result.tierBreakdown[1].units, 4000);
    assert.equal(r.result.tierBreakdown[1].charge, 8);
  });

  it("usage-record rejects a non-positive / poisoned quantity (fail-CLOSED before persist)", () => {
    const inf = call("usage-record", ctxA, { subscriptionId: "s", quantity: "Infinity" });
    assert.equal(inf.ok, false);   // billNum(Infinity) → 0 → "quantity must be positive"
    const zero = call("usage-record", ctxA, { subscriptionId: "s", quantity: 0 });
    assert.equal(zero.ok, false);
    const neg = call("usage-record", ctxA, { subscriptionId: "s", quantity: -5 });
    assert.equal(neg.ok, false);
  });
});

// ── coupons ──────────────────────────────────────────────────────────────────

describe("billing.coupon-apply — discount math + redemption lifecycle", () => {
  it("20% coupon on 100 → discount 20, final 80", () => {
    call("coupon-create", ctxA, { code: "save20", kind: "percent", value: 20 });
    const r = call("coupon-apply", ctxA, { code: "SAVE20", amount: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.discount, 20);
    assert.equal(r.result.finalAmount, 80);
    assert.equal(r.result.redeemed, false);
  });

  it("fixed coupon is capped at the amount (never negative final)", () => {
    call("coupon-create", ctxA, { code: "FLAT", kind: "fixed", value: 30 });
    const r = call("coupon-apply", ctxA, { code: "FLAT", amount: 20 });
    assert.equal(r.result.discount, 20);   // min(amount, value)
    assert.equal(r.result.finalAmount, 0);
  });

  it("maxRedemptions deactivates the coupon after the limit", () => {
    call("coupon-create", ctxA, { code: "ONCE", kind: "percent", value: 50, maxRedemptions: 1 });
    const ok = call("coupon-apply", ctxA, { code: "ONCE", amount: 100, redeem: true });
    assert.equal(ok.ok, true);
    const after = call("coupon-apply", ctxA, { code: "ONCE", amount: 100, redeem: true });
    assert.equal(after.ok, false);  // limit reached
  });

  it("fail-CLOSED: poisoned amount keeps the final finite", () => {
    call("coupon-create", ctxA, { code: "P", kind: "percent", value: 10 });
    const r = call("coupon-apply", ctxA, { code: "P", amount: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.finalAmount));
    assert.equal(r.result.discount, 0);   // billNum(Infinity) → 0
  });
});

// ── tax ──────────────────────────────────────────────────────────────────────

describe("billing.tax-calculate — per-jurisdiction rate + B2B reverse charge", () => {
  it("US-CA 7.25% on 100 → tax 7.25, gross 107.25", () => {
    const r = call("tax-calculate", ctxA, { jurisdiction: "US-CA", amount: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.taxAmount, 7.25);
    assert.equal(r.result.grossAmount, 107.25);
    assert.equal(r.result.reverseCharge, false);
  });

  it("EU-DE B2B with a VAT id reverse-charges to 0 tax", () => {
    const r = call("tax-calculate", ctxA, { jurisdiction: "EU-DE", amount: 100, b2b: true, taxId: "DE123456789" });
    assert.equal(r.ok, true);
    assert.equal(r.result.taxAmount, 0);
    assert.equal(r.result.reverseCharge, true);
    assert.ok(typeof r.result.note === "string");
  });

  it("rejects an unknown jurisdiction", () => {
    const r = call("tax-calculate", ctxA, { jurisdiction: "MARS-1", amount: 100 });
    assert.equal(r.ok, false);
  });

  it("fail-CLOSED: poisoned amount keeps tax + gross finite", () => {
    const r = call("tax-calculate", ctxA, { jurisdiction: "US-CA", amount: "Infinity" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.taxAmount));
    assert.ok(Number.isFinite(r.result.grossAmount));
    assert.equal(r.result.netAmount, 0);
  });
});

// ── dunning lifecycle ─────────────────────────────────────────────────────────

describe("billing.dunning — open / retry succeeded / retry exhausted", () => {
  it("opens a case with a 4-attempt retry schedule", () => {
    const r = call("dunning-open", ctxA, { amount: 99, reason: "card_declined" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dunning.amount, 99);
    assert.equal(r.result.dunning.status, "in_progress");
    assert.equal(r.result.dunning.schedule.length, 4);
  });

  it("a succeeded retry closes the case as recovered", () => {
    const open = call("dunning-open", ctxA, { amount: 50, reason: "expired_card" });
    const id = open.result.dunning.id;
    const r = call("dunning-retry", ctxA, { dunningId: id, outcome: "succeeded" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dunning.status, "recovered");
    const list = call("dunning-list", ctxA);
    assert.equal(list.result.recoveredCount, 1);
    assert.equal(list.result.openCount, 0);
  });

  it("four failed retries mark the case lost", () => {
    const open = call("dunning-open", ctxA, { amount: 75, reason: "insufficient_funds" });
    const id = open.result.dunning.id;
    for (let i = 0; i < 3; i++) call("dunning-retry", ctxA, { dunningId: id, outcome: "failed" });
    const last = call("dunning-retry", ctxA, { dunningId: id, outcome: "failed" });
    assert.equal(last.result.dunning.status, "lost");
    const list = call("dunning-list", ctxA);
    assert.equal(list.result.lostCount, 1);
  });

  it("dunning-open rejects a non-positive / poisoned amount (fail-CLOSED)", () => {
    assert.equal(call("dunning-open", ctxA, { amount: "1e999" }).ok, false);
    assert.equal(call("dunning-open", ctxA, { amount: 0 }).ok, false);
  });
});

// ── revenue-analytics — MRR/ARR + cohorts + expansion ────────────────────────

describe("billing.revenue-analytics — MRR / ARR / expansion from real subs", () => {
  it("two active subs roll up into MRR/ARR and expansion seats", () => {
    const plan = call("plan-create", ctxA, { name: "Pro", interval: "monthly", amount: 30 });
    const planId = plan.result.plan.id;
    call("subscription-create", ctxA, { planId, customerName: "One", quantity: 1 });
    call("subscription-create", ctxA, { planId, customerName: "Two", quantity: 3 });  // 2 expansion seats
    const r = call("revenue-analytics", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.activeSubscriptions, 2);
    // MRR = 30*1 + 30*3 = 120 (monthly plan, 30-day cycle normalised to 30)
    assert.equal(r.result.mrr, 120);
    assert.equal(r.result.arr, 1440);
    assert.equal(r.result.expansionSeats, 2);
    assert.equal(r.result.expansionMrr, 60);  // 30 * 2 extra seats
  });
});

// ── revenueRecognition — ASC-606 allocation + fail-closed ────────────────────

describe("billing.revenueRecognition — deliverable allocation + fail-CLOSED", () => {
  it("allocates transaction price by relative standalone price + recognizes delivered", () => {
    const r = call("revenueRecognition", ctxA, {
      contracts: [{
        id: "c1", customer: "Acme", totalValue: 1000,
        startDate: "2026-01-01", endDate: "2026-12-31",
        deliverables: [
          { name: "Setup", standalonePrice: 250, deliveredDate: "2026-01-02" },
          { name: "Support", standalonePrice: 750 },
        ],
      }],
      recognitionDate: "2026-06-01",
    });
    assert.equal(r.ok, true);
    const c = r.result.contracts[0];
    assert.equal(c.deliverableAllocation[0].allocatedAmount, 250);   // 250/1000 * 1000
    assert.equal(c.deliverableAllocation[1].allocatedAmount, 750);
    assert.equal(c.deliverableAllocation[0].recognizedRevenue, 250); // delivered
    assert.equal(c.deliverableAllocation[1].deferredRevenue, 750);   // undelivered
    assert.equal(r.result.totalRecognizedRevenue, 250);
    assert.equal(r.result.totalDeferredRevenue, 750);
  });

  it("fail-CLOSED: poisoned totalValue keeps every aggregate finite", () => {
    const r = call("revenueRecognition", ctxA, {
      contracts: [{ id: "c", customer: "A", totalValue: "Infinity", startDate: "2026-01-01", endDate: "2026-12-31" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalContractValue));
    assert.ok(Number.isFinite(r.result.totalRecognizedRevenue));
    assert.ok(Number.isFinite(r.result.totalDeferredRevenue));
    assert.equal(r.result.totalContractValue, 0);
  });
});

// ── churnPrediction — bounded probability + fail-closed revenue ──────────────

describe("billing.churnPrediction — bounded score + fail-CLOSED at-risk revenue", () => {
  it("returns a bounded [0,1] churn probability and a risk bucket", () => {
    const r = call("churnPrediction", ctxA, {
      customers: [{
        id: "c1", name: "Riskier", tenureMonths: 2,
        monthlyPayments: [
          { month: "2026-01", amount: 100, daysPastDue: 0 },
          { month: "2026-02", amount: 100, daysPastDue: 10 },
          { month: "2026-03", amount: 50, daysPastDue: 30 },
        ],
      }],
    });
    assert.equal(r.ok, true);
    const p = r.result.predictions[0];
    assert.ok(p.churnProbability >= 0 && p.churnProbability <= 1, "probability bounded");
    assert.ok(["high", "medium", "low", "very-low"].includes(p.churnRisk));
    assert.ok(Number.isFinite(r.result.estimatedAtRiskAnnualRevenue));
  });

  it("fail-CLOSED: poisoned payment amount keeps probability + at-risk revenue finite", () => {
    const r = call("churnPrediction", ctxA, {
      customers: [{
        id: "c1", name: "Poison", tenureMonths: 1,
        monthlyPayments: [
          { month: "2026-01", amount: "Infinity", daysPastDue: "1e999" },
          { month: "2026-02", amount: "NaN", daysPastDue: 0 },
          { month: "2026-03", amount: "1e999", daysPastDue: 5 },
        ],
      }],
    });
    assert.equal(r.ok, true);
    const p = r.result.predictions[0];
    assert.ok(Number.isFinite(p.churnProbability), "probability finite, not NaN");
    assert.ok(p.churnProbability >= 0 && p.churnProbability <= 1);
    assert.ok(Number.isFinite(r.result.estimatedAtRiskAnnualRevenue), "at-risk revenue finite");
  });
});

// ── per-user isolation ────────────────────────────────────────────────────────

describe("billing — per-user state isolation", () => {
  it("user_a plans/coupons never appear for user_b", () => {
    call("plan-create", ctxA, { name: "A-only", amount: 10 });
    call("coupon-create", ctxA, { code: "A-CODE", kind: "percent", value: 5 });
    assert.equal(call("plan-list", ctxA).result.plans.length, 1);
    assert.equal(call("plan-list", ctxB).result.plans.length, 0);
    assert.equal(call("coupon-list", ctxB).result.coupons.length, 0);
    // a coupon code created by A is unknown to B
    assert.equal(call("coupon-apply", ctxB, { code: "A-CODE", amount: 100 }).ok, false);
  });
});
