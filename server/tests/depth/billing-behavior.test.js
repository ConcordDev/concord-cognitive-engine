// tests/depth/billing-behavior.test.js — REAL behavioral tests (billing lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("billing — calc actions", () => {
  it("churnPrediction: reports the analyzed customer population", async () => {
    const r = await lensRun("billing", "churnPrediction", { data: { customers: [{ id: 1, mrr: 50 }, { id: 2, mrr: 90 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCustomers, 2);
    assert.equal(typeof r.result.atRiskCount, "number");
  });
  it("invoiceCalculation: totals line items and applies tax", async () => {
    const r = await lensRun("billing", "invoiceCalculation", { data: { lineItems: [{ description: "svc", quantity: 2, unitPrice: 50 }] }, params: { taxRate: 10 } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.lineItems) && r.result.lineItems.length === 1);
    const totalish = r.result.total ?? r.result.grandTotal ?? r.result.totalDue ?? r.result.subtotal;
    assert.ok(Number(totalish) > 0, "a positive total was computed");
  });
});

describe("billing — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-crud"); });
  it("plan-create → plan-list: a created plan is listed", async () => {
    const created = await lensRun("billing", "plan-create", { params: { name: "Pro", amount: 99, interval: "monthly" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.plan.name, "Pro");
    const id = created.result.plan.id;
    const list = await lensRun("billing", "plan-list", { params: {} }, ctx);
    assert.ok((list.result.plans || []).some((p) => p.id === id), "plan is listed");
  });
  it("coupon-create: rejects a non-positive discount value (input validation)", async () => {
    const created = await lensRun("billing", "coupon-create", { params: { code: "SAVE20", percentOff: 20 } }, ctx);
    assert.equal(created.result.ok, false);
    assert.match(String(created.result.error), /value must be positive/i);
  });
  it("coupon-list: returns the coupon set", async () => {
    const list = await lensRun("billing", "coupon-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(Array.isArray(list.result.coupons));
  });
});

// ── Appended coverage (Track A depth fleet) ────────────────────────────────
// SUCCESS surfaces at r.ok===true / r.result.<field>; a handler refusal surfaces
// at r.result.ok===false / r.result.error. Every value below is the EXACT output
// of the source formula (no constants changed — outputs are asserted).

describe("billing — invoiceCalculation exact math", () => {
  it("subtotal + percentage discount + tax compose to the exact total", async () => {
    // 2 line items: 3×100=300 (taxable) + 2×50=100 (non-taxable) → subtotal 400
    // 10% percentage discount → totalDiscount 40, afterDiscount 360
    // taxableAmount 300; taxableAfterDiscount = round((300/400)*360)= 270
    // taxRate 0.07 → taxAmount = round(270*0.07)= 18.9; total = 360+18.9 = 378.9
    const r = await lensRun("billing", "invoiceCalculation", {
      data: {
        lineItems: [
          { description: "svc", quantity: 3, unitPrice: 100 },
          { description: "gift card", quantity: 2, unitPrice: 50, taxable: false },
        ],
        discountRules: [{ type: "percentage", value: 0.1 }],
      },
      params: { taxRate: 0.07 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 400);
    assert.equal(r.result.discounts.totalDiscount, 40);
    assert.equal(r.result.afterDiscount, 360);
    assert.equal(r.result.tax.taxableAmount, 270);
    assert.equal(r.result.tax.taxAmount, 18.9);
    assert.equal(r.result.total, 378.9);
    assert.equal(r.result.summary.totalQuantity, 5);
  });

  it("empty line items short-circuit with a no-items message (no total)", async () => {
    const r = await lensRun("billing", "invoiceCalculation", { data: { lineItems: [] } });
    assert.equal(r.ok, true);
    assert.ok(String(r.result.message).includes("No line items"));
    assert.equal(r.result.total, undefined);
  });

  it("fixed discount is capped at the subtotal", async () => {
    // subtotal 100, fixed discount 500 → discountAmount = min(100,500)=100; total 0
    const r = await lensRun("billing", "invoiceCalculation", {
      data: {
        lineItems: [{ description: "x", quantity: 1, unitPrice: 100 }],
        discountRules: [{ type: "fixed", value: 500 }],
      },
    });
    assert.equal(r.result.discounts.totalDiscount, 100);
    assert.equal(r.result.afterDiscount, 0);
    assert.equal(r.result.total, 0);
  });
});

describe("billing — tax-calculate per jurisdiction (exact rates)", () => {
  it("US-CA sales tax on 1000 → 72.50 tax, 1072.50 gross", async () => {
    const r = await lensRun("billing", "tax-calculate", { params: { jurisdiction: "US-CA", amount: 1000 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.rate, 0.0725);
    assert.equal(r.result.taxAmount, 72.5);
    assert.equal(r.result.grossAmount, 1072.5);
    assert.equal(r.result.reverseCharge, false);
  });

  it("EU-DE VAT B2B with a valid tax id triggers reverse charge → 0 tax", async () => {
    const r = await lensRun("billing", "tax-calculate", { params: { jurisdiction: "EU-DE", amount: 1000, b2b: true, taxId: "DE123456789" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.reverseCharge, true);
    assert.equal(r.result.rate, 0);
    assert.equal(r.result.taxAmount, 0);
    assert.equal(r.result.grossAmount, 1000);
  });

  it("unknown jurisdiction is refused", async () => {
    const r = await lensRun("billing", "tax-calculate", { params: { jurisdiction: "ZZ", amount: 100 } });
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("unknown jurisdiction"));
  });

  it("tax-jurisdictions: lists US-CA with its decimal + percent rate", async () => {
    const r = await lensRun("billing", "tax-jurisdictions", {});
    assert.equal(r.ok, true);
    const ca = r.result.jurisdictions.find((j) => j.code === "US-CA");
    assert.ok(ca, "US-CA jurisdiction present");
    assert.equal(ca.rate, 0.0725);
    assert.equal(ca.ratePct, 7.25);
  });
});

describe("billing — metered usage tiered charge (exact graduated pricing)", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-usage"); });
  it("usage-record → usage-summary sums quantity and charges across default tiers", async () => {
    // Record 3000 + 2000 = 5000 api_calls on one sub.
    const rec1 = await lensRun("billing", "usage-record", { params: { subscriptionId: "sub_x", quantity: 3000 } }, ctx);
    assert.equal(rec1.ok, true);
    assert.equal(rec1.result.record.quantity, 3000);
    await lensRun("billing", "usage-record", { params: { subscriptionId: "sub_x", quantity: 2000 } }, ctx);

    // 5000 total: first 1000 @0 = 0; next 4000 @0.002 = 8.00. Total 8.00.
    const sum = await lensRun("billing", "usage-summary", { params: { subscriptionId: "sub_x" } }, ctx);
    assert.equal(sum.ok, true);
    assert.equal(sum.result.totalQuantity, 5000);
    assert.equal(sum.result.recordCount, 2);
    assert.equal(sum.result.totalCharge, 8);
    assert.equal(sum.result.byMetric.api_calls, 5000);
  });

  it("usage-record: a non-positive quantity is refused", async () => {
    const r = await lensRun("billing", "usage-record", { params: { subscriptionId: "sub_x", quantity: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("quantity must be positive"));
  });
});

describe("billing — coupon-apply discount math", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-coupon-apply"); });
  it("percent coupon discounts the amount; redemption increments the counter", async () => {
    const made = await lensRun("billing", "coupon-create", { params: { code: "PCT25", value: 25, maxRedemptions: 1 } }, ctx);
    assert.equal(made.ok, true);
    assert.equal(made.result.coupon.kind, "percent");
    assert.equal(made.result.coupon.value, 25);

    // 25% of 200 = 50 discount → final 150.
    const applied = await lensRun("billing", "coupon-apply", { params: { code: "PCT25", amount: 200, redeem: true } }, ctx);
    assert.equal(applied.ok, true);
    assert.equal(applied.result.discount, 50);
    assert.equal(applied.result.finalAmount, 150);
    assert.equal(applied.result.redeemed, true);

    // maxRedemptions=1 consumed → coupon now inactive → next apply refused.
    const again = await lensRun("billing", "coupon-apply", { params: { code: "PCT25", amount: 200 } }, ctx);
    assert.equal(again.result.ok, false);
    assert.ok(String(again.result.error).includes("inactive"));
  });

  it("an unknown coupon code is refused", async () => {
    const r = await lensRun("billing", "coupon-apply", { params: { code: "NOPE", amount: 100 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("invalid coupon code"));
  });
});

describe("billing — subscription lifecycle + proration (shared ctx)", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-sub"); });
  let basicId, proId, subId;

  it("plan-create (no trial) → subscription-create yields an active sub + MRR", async () => {
    const basic = await lensRun("billing", "plan-create", { params: { name: "Basic", amount: 30, interval: "monthly" } }, ctx);
    const pro = await lensRun("billing", "plan-create", { params: { name: "Pro", amount: 90, interval: "monthly" } }, ctx);
    assert.equal(basic.ok, true);
    basicId = basic.result.plan.id;
    proId = pro.result.plan.id;

    const sub = await lensRun("billing", "subscription-create", { params: { planId: basicId, customerName: "Acme", quantity: 1 } }, ctx);
    assert.equal(sub.ok, true);
    assert.equal(sub.result.subscription.status, "active");   // no trial days
    subId = sub.result.subscription.id;

    const list = await lensRun("billing", "subscription-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.activeCount, 1);
    // monthly plan: (30/30)*30 = 30 MRR; ARR = 360.
    assert.equal(list.result.mrr, 30);
    assert.equal(list.result.arr, 360);
  });

  it("subscription-proration upgrade mid-cycle charges (new − old) at ~full remaining fraction", async () => {
    const pr = await lensRun("billing", "subscription-proration", { params: { subscriptionId: subId, newPlanId: proId } }, ctx);
    assert.equal(pr.ok, true);
    // Freshly created period: remaining fraction rounds to 1.0.
    assert.equal(pr.result.remainingFraction, 1);
    assert.equal(pr.result.unusedCredit, 30);       // old 30 × qty 1 × 1.0
    assert.equal(pr.result.newPlanProrated, 90);    // new 90 × qty 1 × 1.0
    assert.equal(pr.result.amountDue, 60);          // 90 − 30
    assert.equal(pr.result.direction, "upgrade-charge");
  });

  it("subscription-proration on a missing subscription is refused", async () => {
    const r = await lensRun("billing", "subscription-proration", { params: { subscriptionId: "missing", newPlanId: proId } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("subscription not found"));
  });

  it("subscription-cancel immediate flips status to canceled", async () => {
    const r = await lensRun("billing", "subscription-cancel", { params: { subscriptionId: subId, immediate: true } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.subscription.status, "canceled");
    assert.ok(r.result.subscription.canceledAt);
  });
});

describe("billing — dunning workflow (shared ctx)", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-dunning"); });
  let dunId;

  it("dunning-open builds the 4-attempt retry schedule", async () => {
    const r = await lensRun("billing", "dunning-open", { params: { amount: 49.99, reason: "card_declined" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.dunning.status, "in_progress");
    assert.equal(r.result.dunning.amount, 49.99);
    assert.equal(r.result.dunning.schedule.length, 4);
    assert.equal(r.result.dunning.schedule[0].emailTemplate, "payment_failed");
    assert.equal(r.result.dunning.schedule[3].emailTemplate, "final_notice");
    dunId = r.result.dunning.id;
  });

  it("dunning-open with a non-positive amount is refused", async () => {
    const r = await lensRun("billing", "dunning-open", { params: { amount: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("amount must be positive"));
  });

  it("dunning-retry success recovers the case; dunning-list reflects it", async () => {
    const retry = await lensRun("billing", "dunning-retry", { params: { dunningId: dunId, outcome: "succeeded" } }, ctx);
    assert.equal(retry.ok, true);
    assert.equal(retry.result.dunning.status, "recovered");
    assert.equal(retry.result.dunning.attemptsUsed, 1);

    const list = await lensRun("billing", "dunning-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.recoveredCount, 1);
    assert.equal(list.result.openCount, 0);

    // A recovered case cannot be retried again.
    const again = await lensRun("billing", "dunning-retry", { params: { dunningId: dunId, outcome: "failed" } }, ctx);
    assert.equal(again.result.ok, false);
    assert.ok(String(again.result.error).includes("already closed"));
  });
});

describe("billing — revenue analytics + portal (shared ctx)", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-analytics"); });

  it("revenue-analytics computes MRR/ARR/ARPA and expansion seats from active subs", async () => {
    const plan = await lensRun("billing", "plan-create", { params: { name: "Team", amount: 100, interval: "monthly" } }, ctx);
    const planId = plan.result.plan.id;
    // One sub with quantity 3 → monthlyValue = (100*3/30)*30 = 300 MRR.
    const sub = await lensRun("billing", "subscription-create", { params: { planId, customerName: "Org", quantity: 3 } }, ctx);
    assert.equal(sub.ok, true);

    const an = await lensRun("billing", "revenue-analytics", {}, ctx);
    assert.equal(an.ok, true);
    assert.equal(an.result.mrr, 300);
    assert.equal(an.result.arr, 3600);
    assert.equal(an.result.activeSubscriptions, 1);
    assert.equal(an.result.arpa, 300);
    assert.equal(an.result.expansionSeats, 2);       // qty 3 − 1 baseline
    assert.equal(an.result.expansionMrr, 200);       // (100*2/30)*30
  });

  it("portal-update-card stores only the brand + last4; portal-overview reflects it", async () => {
    const card = await lensRun("billing", "portal-update-card", { params: { cardNumber: "4242 4242 4242 4242", expMonth: 12, expYear: new Date().getFullYear() + 2, name: "Org" } }, ctx);
    assert.equal(card.ok, true);
    assert.equal(card.result.paymentMethod.brand, "Visa");
    assert.equal(card.result.paymentMethod.last4, "4242");

    const ov = await lensRun("billing", "portal-overview", {}, ctx);
    assert.equal(ov.ok, true);
    assert.equal(ov.result.paymentMethod.last4, "4242");
    assert.ok(Array.isArray(ov.result.activeSubscriptions));
  });

  it("portal-update-card rejects an expired card", async () => {
    const r = await lensRun("billing", "portal-update-card", { params: { cardNumber: "4242424242424242", expMonth: 6, expYear: new Date().getFullYear() - 1 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(String(r.result.error).includes("card expired"));
  });
});

describe("billing — revenueRecognition (ASC 606 allocation)", () => {
  it("delivered deliverables recognize revenue; undelivered defer it", async () => {
    // Total 1000 split by standalone price 600/400 → allocations 600/400.
    // Deliverable A delivered before recognitionDate → recognized; B undelivered → deferred.
    const r = await lensRun("billing", "revenueRecognition", {
      data: {
        contracts: [{
          id: "C1", customer: "Acme", totalValue: 1000,
          startDate: "2026-01-01", endDate: "2026-12-31",
          deliverables: [
            { name: "A", standalonePrice: 600, deliveredDate: "2026-02-01" },
            { name: "B", standalonePrice: 400 },
          ],
        }],
      },
      params: { recognitionDate: "2026-06-01" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.contractCount, 1);
    const c = r.result.contracts[0];
    const a = c.deliverableAllocation.find((d) => d.name === "A");
    const b = c.deliverableAllocation.find((d) => d.name === "B");
    assert.equal(a.allocatedAmount, 600);
    assert.equal(a.recognizedRevenue, 600);
    assert.equal(a.deferredRevenue, 0);
    assert.equal(b.allocatedAmount, 400);
    assert.equal(b.recognizedRevenue, 0);
    assert.equal(b.deferredRevenue, 400);
    assert.equal(c.recognizedRevenue, 600);
    assert.equal(c.deferredRevenue, 400);
    assert.equal(r.result.totalRecognizedRevenue, 600);
    assert.equal(r.result.totalDeferredRevenue, 400);
    assert.equal(r.result.recognitionRate, 60);   // 600/1000
  });

  it("empty contracts short-circuit with a no-contracts message", async () => {
    const r = await lensRun("billing", "revenueRecognition", { data: { contracts: [] } });
    assert.equal(r.ok, true);
    assert.ok(String(r.result.message).includes("No contracts"));
  });
});

describe("billing — invoice-create + portal open-count", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-invoice"); });
  it("invoice-create defaults to an open invoice; portal counts it as open", async () => {
    const inv = await lensRun("billing", "invoice-create", { params: { amount: 120.5, customerName: "Acme" } }, ctx);
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.amount, 120.5);
    assert.equal(inv.result.invoice.status, "open");

    const ov = await lensRun("billing", "portal-overview", {}, ctx);
    assert.equal(ov.ok, true);
    assert.equal(ov.result.openInvoiceCount, 1);
  });
});
