// Money-lens slice pins (B11, 2026-11-13) — billing tickets:
//  FIX-billing-006  out-of-range inputs were silently clamped (seats→1,
//                   trial→0, coupon→100%, invoice amount→0.00); they now
//                   refuse in words.
//  FIX-billing-008  plans/coupons/subscriptions/dunning cases had no
//                   edit or delete; the verbs now exist, owner-scoped.
//  FIX-billing-009  metered usage was recorded against canceled subs.
//  FIX-billing-010  a coupon redemption can be attributed to the
//                   subscription/customer it was redeemed for and is
//                   logged on the coupon.
// Money OFF throughout: nothing here moves money; these are record
// validation and lifecycle verbs on the lens's own state.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBillingActions from "../domains/billing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`billing.${name}`);
  if (!fn) throw new Error(`billing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerBillingActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function plan(ctx = ctxA, extra = {}) {
  const r = call("plan-create", ctx, { name: "Pro", interval: "monthly", amount: 30, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.plan;
}
function sub(ctx = ctxA, planId, extra = {}) {
  const r = call("subscription-create", ctx, { planId, customerName: "Acme", quantity: 2, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.subscription;
}

describe("FIX-billing-006 — no silent clamps", () => {
  it("seats below 1 refuse in words; a valid seat count is kept exactly", () => {
    const p = plan();
    const bad = call("subscription-create", ctxA, { planId: p.id, quantity: 0 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /seats/i);
    assert.equal(sub(ctxA, p.id, { quantity: 3 }).quantity, 3);
  });

  it("a negative trial refuses instead of clamping to 0", () => {
    const bad = call("plan-create", ctxA, { name: "X", amount: 10, trialDays: -5 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /trialDays/);
    assert.equal(plan(ctxA, { trialDays: 14 }).trialDays, 14);
  });

  it("a percent coupon above 100 refuses instead of clamping to 100", () => {
    const bad = call("coupon-create", ctxA, { code: "BIG", kind: "percent", value: 150 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /100/);
    const ok = call("coupon-create", ctxA, { code: "HALF", kind: "percent", value: 50 });
    assert.equal(ok.result.coupon.value, 50);
  });

  it("a non-positive invoice amount refuses instead of zeroing", () => {
    const bad = call("invoice-create", ctxA, { amount: -25 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /positive/);
  });
});

describe("FIX-billing-009 — canceled subs take no usage", () => {
  it("usage-record refuses a canceled subscription, accepts a live one", () => {
    const p = plan();
    const s = sub(ctxA, p.id);
    const live = call("usage-record", ctxA, { subscriptionId: s.id, quantity: 5 });
    assert.equal(live.ok, true);
    call("subscription-cancel", ctxA, { subscriptionId: s.id, immediate: true });
    const dead = call("usage-record", ctxA, { subscriptionId: s.id, quantity: 5 });
    assert.equal(dead.ok, false);
    assert.match(dead.error, /canceled/);
    const summary = call("usage-summary", ctxA, { subscriptionId: s.id });
    assert.equal(summary.result.totalQuantity, 5, "only the pre-cancel event stands");
  });
});

describe("FIX-billing-008 — edit and delete exist, owner-scoped", () => {
  it("plan-update edits fields and plan-delete refuses while subs reference it, then deletes", () => {
    const p = plan();
    const upd = call("plan-update", ctxA, { planId: p.id, name: "Pro Plus", amount: 45, trialDays: 7 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.plan.name, "Pro Plus");
    assert.equal(upd.result.plan.amount, 45);
    const s = sub(ctxA, p.id);
    const blocked = call("plan-delete", ctxA, { planId: p.id });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /subscription/);
    assert.equal(call("subscription-delete", ctxA, { subscriptionId: s.id }).ok, true);
    assert.equal(call("plan-delete", ctxA, { planId: p.id }).ok, true);
    assert.equal(call("plan-list", ctxA).result.plans.length, 0);
  });

  it("coupon-update toggles active and coupon-delete removes; dunning-delete removes a case", () => {
    const c = call("coupon-create", ctxA, { code: "X10", kind: "percent", value: 10 }).result.coupon;
    const upd = call("coupon-update", ctxA, { couponId: c.id, active: false });
    assert.equal(upd.result.coupon.active, false);
    assert.equal(call("coupon-delete", ctxA, { couponId: c.id }).ok, true);
    assert.equal(call("coupon-list", ctxA).result.coupons.length, 0);
    const d = call("dunning-open", ctxA, { amount: 50, reason: "card_declined" }).result.dunning;
    assert.equal(call("dunning-delete", ctxA, { dunningId: d.id }).ok, true);
    assert.equal(call("dunning-list", ctxA).result.cases.length, 0);
  });

  it("another account cannot edit or delete the owner's records", () => {
    const p = plan();
    assert.equal(call("plan-update", ctxB, { planId: p.id, name: "Hijack" }).ok, false);
    assert.equal(call("plan-delete", ctxB, { planId: p.id }).ok, false);
    assert.equal(call("plan-list", ctxA).result.plans.length, 1);
  });
});

describe("FIX-billing-010 — redemptions carry attribution", () => {
  it("redeem with a subscriptionId logs who it was redeemed for", () => {
    const p = plan();
    const s = sub(ctxA, p.id);
    call("coupon-create", ctxA, { code: "VIP", kind: "percent", value: 20 });
    const r = call("coupon-apply", ctxA, { code: "VIP", amount: 200, redeem: true, subscriptionId: s.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.redeemedFor.customerName, "Acme");
    const coupon = call("coupon-list", ctxA).result.coupons[0];
    assert.equal(coupon.redemptionLog.length, 1);
    assert.equal(coupon.redemptionLog[0].subscriptionId, s.id);
    assert.equal(coupon.redemptionLog[0].discount, 40);
    const badSub = call("coupon-apply", ctxA, { code: "VIP", amount: 10, redeem: true, subscriptionId: "nope" });
    assert.equal(badSub.ok, false);
  });
});
