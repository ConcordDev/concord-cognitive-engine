// Contract tests for server/domains/billing.js — subscription-billing core
// macros wired for Stripe-Billing feature parity. Exercises every macro the
// billing lens UI calls and asserts the { ok } envelope.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBillingActions from "../domains/billing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`billing.${name}`);
  if (!fn) throw new Error(`billing.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerBillingActions(register); });

beforeEach(() => {
  // Fresh per-user state for every test.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("billing.plan + subscription lifecycle", () => {
  it("creates a plan and lists it", () => {
    const c = call("plan-create", ctxA, {}, { name: "Pro", interval: "monthly", amount: 29 });
    assert.equal(c.ok, true);
    assert.equal(c.result.plan.name, "Pro");
    const l = call("plan-list", ctxA, {}, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.plans.length, 1);
  });

  it("rejects a plan with no name", () => {
    const r = call("plan-create", ctxA, {}, { amount: 10 });
    assert.equal(r.ok, false);
  });

  it("creates a subscription and computes MRR/ARR", () => {
    const plan = call("plan-create", ctxA, {}, { name: "Pro", interval: "monthly", amount: 30 }).result.plan;
    const sub = call("subscription-create", ctxA, {}, { planId: plan.id, customerName: "Acme", quantity: 2 });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.subscription.status, "active");
    const list = call("subscription-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.activeCount, 1);
    assert.ok(list.result.mrr > 0);
    assert.equal(list.result.arr, Math.round(list.result.mrr * 12 * 100) / 100);
  });

  it("starts a trial when the plan has trial days", () => {
    const plan = call("plan-create", ctxA, {}, { name: "Trial", amount: 50, trialDays: 14 }).result.plan;
    const sub = call("subscription-create", ctxA, {}, { planId: plan.id }).result.subscription;
    assert.equal(sub.status, "trialing");
  });

  it("prorates a mid-cycle plan switch and can apply it", () => {
    const cheap = call("plan-create", ctxA, {}, { name: "Basic", amount: 10 }).result.plan;
    const dear = call("plan-create", ctxA, {}, { name: "Pro", amount: 40 }).result.plan;
    const sub = call("subscription-create", ctxA, {}, { planId: cheap.id }).result.subscription;
    const preview = call("subscription-proration", ctxA, {}, { subscriptionId: sub.id, newPlanId: dear.id });
    assert.equal(preview.ok, true);
    assert.equal(preview.result.direction, "upgrade-charge");
    const applied = call("subscription-proration", ctxA, {}, { subscriptionId: sub.id, newPlanId: dear.id, apply: true });
    assert.equal(applied.result.applied, true);
  });

  it("cancels a subscription immediately and at period end", () => {
    const plan = call("plan-create", ctxA, {}, { name: "P", amount: 10 }).result.plan;
    const s1 = call("subscription-create", ctxA, {}, { planId: plan.id }).result.subscription;
    const s2 = call("subscription-create", ctxA, {}, { planId: plan.id }).result.subscription;
    assert.equal(call("subscription-cancel", ctxA, {}, { subscriptionId: s1.id, immediate: true }).result.subscription.status, "canceled");
    assert.equal(call("subscription-cancel", ctxA, {}, { subscriptionId: s2.id }).result.subscription.cancelAtPeriodEnd, true);
  });
});

describe("billing.usage — metered billing with rate tiers", () => {
  it("records usage and computes graduated tier charge", () => {
    const rec = call("usage-record", ctxA, {}, { subscriptionId: "sub_1", metric: "api_calls", quantity: 50000 });
    assert.equal(rec.ok, true);
    const sum = call("usage-summary", ctxA, {}, { subscriptionId: "sub_1" });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.totalQuantity, 50000);
    assert.ok(sum.result.totalCharge > 0);
    assert.ok(sum.result.tierBreakdown.length > 0);
  });

  it("rejects non-positive quantity and missing subscription", () => {
    assert.equal(call("usage-record", ctxA, {}, { quantity: 1 }).ok, false);
    assert.equal(call("usage-record", ctxA, {}, { subscriptionId: "s", quantity: 0 }).ok, false);
  });
});

describe("billing.coupon — promo codes", () => {
  it("creates, lists and applies a percent coupon", () => {
    const c = call("coupon-create", ctxA, {}, { code: "LAUNCH20", kind: "percent", value: 20 });
    assert.equal(c.ok, true);
    assert.equal(call("coupon-list", ctxA, {}, {}).result.coupons.length, 1);
    const apply = call("coupon-apply", ctxA, {}, { code: "LAUNCH20", amount: 100 });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.discount, 20);
    assert.equal(apply.result.finalAmount, 80);
  });

  it("rejects duplicate codes and invalid codes", () => {
    call("coupon-create", ctxA, {}, { code: "DUP", kind: "fixed", value: 5 });
    assert.equal(call("coupon-create", ctxA, {}, { code: "DUP", kind: "fixed", value: 5 }).ok, false);
    assert.equal(call("coupon-apply", ctxA, {}, { code: "NOPE", amount: 10 }).ok, false);
  });

  it("redeems a coupon and enforces max redemptions", () => {
    call("coupon-create", ctxA, {}, { code: "ONCE", kind: "percent", value: 10, maxRedemptions: 1 });
    const first = call("coupon-apply", ctxA, {}, { code: "ONCE", amount: 100, redeem: true });
    assert.equal(first.result.redeemed, true);
    assert.equal(call("coupon-apply", ctxA, {}, { code: "ONCE", amount: 100, redeem: true }).ok, false);
  });
});

describe("billing.dunning — failed payment workflow", () => {
  it("opens a dunning case with a retry schedule", () => {
    const d = call("dunning-open", ctxA, {}, { amount: 99, reason: "card_declined" });
    assert.equal(d.ok, true);
    assert.equal(d.result.dunning.status, "in_progress");
    assert.ok(d.result.dunning.schedule.length >= 3);
    const list = call("dunning-list", ctxA, {}, {});
    assert.equal(list.result.openCount, 1);
  });

  it("recovers a case on a successful retry", () => {
    const d = call("dunning-open", ctxA, {}, { amount: 50 }).result.dunning;
    const r = call("dunning-retry", ctxA, {}, { dunningId: d.id, outcome: "succeeded" });
    assert.equal(r.ok, true);
    assert.equal(r.result.dunning.status, "recovered");
  });

  it("rejects opening a case with no amount", () => {
    assert.equal(call("dunning-open", ctxA, {}, { amount: 0 }).ok, false);
  });
});

describe("billing.portal — customer billing portal", () => {
  it("returns a portal overview", () => {
    const r = call("portal-overview", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.invoices));
  });

  it("saves a card on file (last4 only)", () => {
    const r = call("portal-update-card", ctxA, {}, {
      name: "Jane", cardNumber: "4242424242424242", expMonth: 12, expYear: new Date().getFullYear() + 2,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.paymentMethod.brand, "Visa");
    assert.equal(r.result.paymentMethod.last4, "4242");
  });

  it("rejects an invalid card number and expired card", () => {
    assert.equal(call("portal-update-card", ctxA, {}, { cardNumber: "12", expMonth: 1, expYear: 2099 }).ok, false);
    assert.equal(call("portal-update-card", ctxA, {}, { cardNumber: "4242424242424242", expMonth: 1, expYear: 2000 }).ok, false);
  });
});

describe("billing.tax — per-jurisdiction tax", () => {
  it("lists jurisdictions", () => {
    const r = call("tax-jurisdictions", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.jurisdictions.length > 0);
  });

  it("computes sales tax for a known jurisdiction", () => {
    const r = call("tax-calculate", ctxA, {}, { jurisdiction: "US-CA", amount: 100 });
    assert.equal(r.ok, true);
    assert.ok(r.result.taxAmount > 0);
    assert.equal(r.result.grossAmount, Math.round((r.result.netAmount + r.result.taxAmount) * 100) / 100);
  });

  it("applies B2B reverse charge for EU VAT with a VAT id", () => {
    const r = call("tax-calculate", ctxA, {}, { jurisdiction: "EU-DE", amount: 100, b2b: true, taxId: "DE123" });
    assert.equal(r.result.reverseCharge, true);
    assert.equal(r.result.taxAmount, 0);
  });

  it("rejects an unknown jurisdiction", () => {
    assert.equal(call("tax-calculate", ctxA, {}, { jurisdiction: "ZZ", amount: 10 }).ok, false);
  });
});

describe("billing.invoice + revenue-analytics", () => {
  it("creates an invoice", () => {
    const r = call("invoice-create", ctxA, {}, { customerName: "Acme", amount: 120 });
    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.amount, 120);
  });

  it("computes MRR/ARR, cohorts and expansion", () => {
    const plan = call("plan-create", ctxA, {}, { name: "Pro", amount: 30 }).result.plan;
    call("subscription-create", ctxA, {}, { planId: plan.id, quantity: 3 });
    const r = call("revenue-analytics", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.mrr > 0);
    assert.equal(r.result.arr, Math.round(r.result.mrr * 12 * 100) / 100);
    assert.equal(r.result.activeSubscriptions, 1);
    assert.ok(r.result.expansionSeats >= 2);
    assert.ok(Array.isArray(r.result.cohorts));
  });
});

describe("billing pure-compute macros (regression)", () => {
  it("invoiceCalculation totals line items + tax", () => {
    const r = call("invoiceCalculation", ctxA,
      { id: null, data: { lineItems: [{ description: "Seat", quantity: 2, unitPrice: 25 }] }, meta: {} },
      { taxRate: 0.1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 50);
    assert.equal(r.result.total, 55);
  });

  it("churnPrediction returns predictions for customers", () => {
    const r = call("churnPrediction", ctxA,
      { id: null, data: { customers: [{ id: "c1", name: "A", monthlyPayments: [{ month: "2026-01", amount: 100, daysPastDue: 0 }] }] }, meta: {} },
      {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCustomers, 1);
  });
});
