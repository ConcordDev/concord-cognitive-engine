/**
 * INC-61 — government payments must not record a card charge that never happened.
 *
 * payments-confirm used to accept any non-empty methodToken plus a 4-digit
 * last4, mark the payment succeeded, mint a receipt, set the permit/fine
 * paid, and queue "Payment received" — with no processor call.
 * permits-pay-fee set permit.paid = true with no tender, which unlocked
 * permits-approve.
 *
 * Run: node --test server/tests/government-honest-payment.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernmentActions from "../domains/government.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";
import { isStripeSecretConfigured } from "../lib/stripe.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`government.${name}`);
  assert.ok(fn, `government.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const acct1 = { actor: { userId: "acct1" }, userId: "acct1" };
const acct2 = { actor: { userId: "acct2" }, userId: "acct2" };

let priorStripeKey;
let priorFetch;

before(() => { registerGovernmentActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network disabled"); };
  priorStripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
});
afterEach(() => {
  if (priorStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = priorStripeKey;
  globalThis.fetch = priorFetch;
});

function permitOf(ctx, id) {
  return call("permits-list", ctx, {}).result.permits.find((p) => p.id === id);
}

function paymentReceived(ctx) {
  return call("notifications-list", ctx, {}).result.notifications.some((n) => n.kind === "payment_received");
}

describe("INC-61 government payments — fake card charges", () => {
  it("treats a placeholder STRIPE_SECRET_KEY as not configured", () => {
    process.env.STRIPE_SECRET_KEY = "sk_REPLACE_ME_NOT_A_REAL_KEY";
    assert.equal(isStripeSecretConfigured(), false);
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    assert.equal(isStripeSecretConfigured(), true);
    process.env.STRIPE_SECRET_KEY = "sk_live_real";
    assert.equal(isStripeSecretConfigured(), true);
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(isStripeSecretConfigured(), false);
  });

  it("acct1 tok_fake does not succeed, receipt, pay, or approve; acct2 confirm is 404", async () => {
    const applied = call("permits-apply", acct1, {
      applicantName: "Ada Clerk", applicantEmail: "ada@example.com", kind: "fence", feeUsd: 120,
    });
    assert.equal(applied.ok, true);
    const permitId = applied.result.permit.id;
    assert.equal(applied.result.permit.paid, false);

    const checkout = call("payments-checkout", acct1, { kind: "permit", refId: permitId });
    assert.equal(checkout.ok, true);
    assert.equal(checkout.result.payment.status, "pending");
    assert.equal(checkout.result.stripeConfigured, false);
    const paymentId = checkout.result.payment.id;

    const conf = await call("payments-confirm", acct1, {
      paymentId, methodToken: "tok_fake", cardLast4: "4242",
    });
    assert.equal(conf.ok, false);
    assert.equal(conf.error, "stripe_not_configured");
    assert.equal(conf.result, undefined);
    assert.equal(conf.receiptNumber, undefined);
    assert.notEqual(conf.status, "succeeded");

    const permit = permitOf(acct1, permitId);
    assert.equal(permit.paid, false);
    assert.equal(permit.status, "applied");
    assert.equal(paymentReceived(acct1), false);
    const listed = call("payments-list", acct1, {}).result.payments.find((p) => p.id === paymentId);
    assert.equal(listed.status, "pending");
    assert.equal(listed.receiptNumber, undefined);

    const approve = call("permits-approve", acct1, { id: permitId });
    assert.equal(approve.ok, false);
    assert.match(approve.error, /fee must be paid before approval/);

    const foreign = await call("payments-confirm", acct2, {
      paymentId, methodToken: "tok_fake", cardLast4: "4242",
    });
    const shaped = shapeLensRunHttp(foreign);
    assert.equal(shaped.status, 404);
    assert.equal(shaped.body.ok, false);
    assert.match(shaped.body.error, /not found/);
    assert.equal(permitOf(acct1, permitId).paid, false);
    assert.equal(paymentReceived(acct1), false);
  });

  it("a placeholder key and a pi_ id still do not mark paid", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_REPLACE_ME_NOT_A_REAL_KEY";
    const applied = call("permits-apply", acct1, {
      applicantName: "Bea", applicantEmail: "bea@example.com", kind: "building", feeUsd: 80,
    });
    const checkout = call("payments-checkout", acct1, { kind: "permit", refId: applied.result.permit.id });
    const conf = await call("payments-confirm", acct1, {
      paymentId: checkout.result.payment.id,
      methodToken: "tok_obviously_fake_zukotest",
      paymentIntentId: "pi_obviously_fake",
      cardLast4: "4242",
    });
    assert.equal(conf.ok, false);
    assert.equal(conf.error, "stripe_not_configured");
    assert.equal(permitOf(acct1, applied.result.permit.id).paid, false);
    assert.equal(paymentReceived(acct1), false);
  });

  it("permits-pay-fee does not silently set paid; method offline is an explicit clerk record", () => {
    const applied = call("permits-apply", acct1, {
      applicantName: "Cy", applicantEmail: "cy@example.com", kind: "electrical", feeUsd: 75,
    });
    const id = applied.result.permit.id;
    const silent = call("permits-pay-fee", acct1, { id });
    assert.equal(silent.ok, false);
    assert.equal(silent.error, "offline_method_required");
    assert.equal(permitOf(acct1, id).paid, false);
    assert.equal(call("permits-approve", acct1, { id }).ok, false);

    const cardish = call("permits-pay-fee", acct1, { id, method: "card" });
    assert.equal(cardish.ok, false);
    assert.equal(permitOf(acct1, id).paid, false);

    const offline = call("permits-pay-fee", acct1, { id, method: "offline" });
    assert.equal(offline.ok, true);
    assert.equal(offline.result.method, "offline");
    assert.equal(offline.result.permit.paid, true);
    assert.equal(offline.result.permit.paymentMethod, "offline");
    assert.equal(offline.result.permit.cardLast4, undefined);
    assert.equal(offline.result.permit.receiptNumber, undefined);
    assert.equal(offline.result.permit.status, "under_review");
    assert.equal(paymentReceived(acct1), false);
    const approved = call("permits-approve", acct1, { id });
    assert.equal(approved.ok, true);
    assert.equal(approved.result.permit.status, "approved");
  });

  it("with Stripe configured, only a succeeded PaymentIntent for this payment marks it paid", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_government_inc61";
    const applied = call("permits-apply", acct1, {
      applicantName: "Dee", applicantEmail: "dee@example.com", kind: "plumbing", feeUsd: 40,
    });
    const permitId = applied.result.permit.id;
    const checkout = call("payments-checkout", acct1, { kind: "permit", refId: permitId });
    const paymentId = checkout.result.payment.id;
    assert.equal(checkout.result.stripeConfigured, true);

    const notACharge = await call("payments-confirm", acct1, {
      paymentId, methodToken: "tok_fake", cardLast4: "4242",
    });
    assert.equal(notACharge.ok, false);
    assert.equal(notACharge.error, "payment_intent_required");
    assert.equal(permitOf(acct1, permitId).paid, false);

    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method, body: opts?.body, auth: opts?.headers?.Authorization });
      const u = String(url);
      if (u === "https://api.stripe.com/v1/payment_intents" && opts?.method === "POST") {
        return { ok: true, json: async () => ({ id: "pi_gov_ok", client_secret: "cs_test_gov", status: "requires_payment_method", amount: 4000, currency: "usd" }) };
      }
      if (u === "https://api.stripe.com/v1/payment_intents/pi_gov_pending") {
        return { ok: true, json: async () => ({ id: "pi_gov_pending", status: "requires_payment_method", amount: 4000, currency: "usd", metadata: { concord_user_id: "acct1", concord_payment_id: paymentId, concord_purpose: "government_fee" } }) };
      }
      if (u === "https://api.stripe.com/v1/payment_intents/pi_gov_ok") {
        return { ok: true, json: async () => ({ id: "pi_gov_ok", status: "succeeded", amount: 4000, currency: "usd", latest_charge: "ch_gov_ok", metadata: { concord_user_id: "acct1", concord_payment_id: paymentId, concord_purpose: "government_fee" } }) };
      }
      if (u === "https://api.stripe.com/v1/payment_intents/pi_gov_short") {
        return { ok: true, json: async () => ({ id: "pi_gov_short", status: "succeeded", amount: 100, currency: "usd", metadata: { concord_user_id: "acct1", concord_payment_id: paymentId, concord_purpose: "government_fee" } }) };
      }
      if (u === "https://api.stripe.com/v1/payment_intents/pi_gov_other") {
        return { ok: true, json: async () => ({ id: "pi_gov_other", status: "succeeded", amount: 4000, currency: "usd", metadata: { concord_user_id: "someone_else", concord_payment_id: paymentId, concord_purpose: "government_fee" } }) };
      }
      throw new Error(`unexpected fetch ${u}`);
    };

    const pending = await call("payments-confirm", acct1, { paymentId, paymentIntentId: "pi_gov_pending" });
    assert.equal(pending.ok, false);
    assert.equal(pending.error, "payment_not_succeeded");
    assert.equal(permitOf(acct1, permitId).paid, false);
    assert.equal(paymentReceived(acct1), false);

    const short = await call("payments-confirm", acct1, { paymentId, paymentIntentId: "pi_gov_short" });
    assert.equal(short.ok, false);
    assert.equal(short.error, "payment_amount_mismatch");
    assert.equal(permitOf(acct1, permitId).paid, false);

    const other = await call("payments-confirm", acct1, { paymentId, paymentIntentId: "pi_gov_other" });
    assert.equal(other.ok, false);
    assert.equal(other.error, "payment_intent_metadata_mismatch");
    assert.equal(permitOf(acct1, permitId).paid, false);

    const created = await call("payments-create-intent", acct1, { paymentId });
    assert.equal(created.ok, true);
    assert.equal(created.result.clientSecret, "cs_test_gov");
    assert.equal(created.result.paymentIntentId, "pi_gov_ok");
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post);
    assert.match(post.auth, /Bearer sk_test_government_inc61/);
    assert.match(post.body, /amount=4000/);
    assert.match(post.body, /metadata%5Bconcord_purpose%5D=government_fee/);
    assert.match(post.body, new RegExp(`metadata%5Bconcord_payment_id%5D=${paymentId}`));
    assert.match(post.body, /metadata%5Bconcord_user_id%5D=acct1/);

    const conf = await call("payments-confirm", acct1, { paymentId, paymentIntentId: "pi_gov_ok", cardLast4: "0000" });
    assert.equal(conf.ok, true);
    assert.equal(conf.result.payment.status, "succeeded");
    assert.match(conf.result.payment.receiptNumber, /^RCPT-/);
    assert.equal(conf.result.payment.cardLast4, undefined);
    assert.equal(conf.result.payment.stripeChargeId, "ch_gov_ok");
    assert.equal(permitOf(acct1, permitId).paid, true);
    assert.equal(permitOf(acct1, permitId).paymentMethod, "card");
    assert.equal(paymentReceived(acct1), true);

    const again = await call("payments-confirm", acct1, { paymentId, paymentIntentId: "pi_gov_ok" });
    assert.equal(again.ok, false);
    assert.equal(again.error, "payment already confirmed");

    const refunded = call("payments-refund", acct1, { paymentId, reason: "duplicate" });
    assert.equal(refunded.ok, true);
    assert.equal(refunded.result.payment.status, "refunded");
    assert.equal(permitOf(acct1, permitId).paid, false);

    const pendingRefund = call("payments-checkout", acct1, { kind: "permit", refId: permitId });
    const refused = call("payments-refund", acct1, { paymentId: pendingRefund.result.payment.id });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "only succeeded payments can be refunded");
  });
});
