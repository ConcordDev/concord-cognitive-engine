/**
 * services — real Stripe Elements/PaymentIntent card-confirmation flow for
 * booking payments (WAVE4: "Card processing honestly gated to pay-on-site —
 * no real Stripe Elements/Terminal client-confirmation flow").
 *
 * Clones domains/retail.js's proven cart-create-payment-intent /
 * cart-confirm-paid-with-intent pattern for services bookings:
 *
 *   services.bookingCreatePaymentIntent — server-side POST to Stripe creates
 *     a real PaymentIntent for the booking total; returns { clientSecret }.
 *     Honest failure ("stripe_not_configured") when STRIPE_SECRET_KEY unset
 *     — never a client_secret Concord didn't actually get from Stripe.
 *
 *   services.bookingConfirmPayment — re-fetches the PaymentIntent from
 *     Stripe and flips the local payment + linked booking to paid ONLY when
 *     status === "succeeded". Never trusts the caller.
 *
 * Pattern mirrors server/tests/retail-domain-parity.test.js's Stripe POS
 * section: register the domain's lens actions into a local macro map,
 * invoke handlers directly with (ctx, artifact, params) — hermetic, no
 * server boot, no real network (globalThis.fetch is stubbed per-test and
 * defaults to throwing so any unstubbed network access fails loudly).
 *
 * Run: node --test server/tests/services-stripe-payment-intent.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerServicesActions from "../domains/services.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`services.${name}`);
  if (!fn) throw new Error(`services.${name} not registered`);
  return fn(ctx, { id: null, data: params || {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "u" }, userId: "u" };

let priorStripeKey;
before(() => { registerServicesActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
  priorStripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
});
afterEach(() => {
  if (priorStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = priorStripeKey;
  else delete process.env.STRIPE_SECRET_KEY;
});

describe("services — bookingCreatePaymentIntent (honest gate)", () => {
  it("errors 'stripe_not_configured' when STRIPE_SECRET_KEY unset — never fabricates a client_secret", async () => {
    const r = await call("bookingCreatePaymentIntent", ctxA, { client: "Ada", subtotal: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "stripe_not_configured");
    assert.equal(r.result, undefined);
    // No payment record was created — a blocked call leaves no trace of a paid/pending charge.
    const list = call("paymentList", ctxA, {});
    assert.equal(list.result.count, 0);
  });

  it("rejects subtotal <= 0 even with Stripe configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const r = await call("bookingCreatePaymentIntent", ctxA, { client: "Ada", subtotal: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /subtotal must be positive/);
  });

  it("rejects amount below Stripe minimum ($0.50 USD)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const r = await call("bookingCreatePaymentIntent", ctxA, { client: "Ada", subtotal: 0.1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /below Stripe minimum/);
  });

  it("errors when bookingId doesn't resolve to a real booking", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const r = await call("bookingCreatePaymentIntent", ctxA, { client: "Ada", subtotal: 50, bookingId: "bk_bogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /booking not found/);
  });

  it("POSTs to the real Stripe endpoint with the correct amount + metadata, returns the stubbed clientSecret", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, method: opts?.method, body: opts?.body, headers: opts?.headers });
      return {
        ok: true,
        json: async () => ({ id: "pi_svc_1", client_secret: "pi_svc_1_secret_xyz", status: "requires_payment_method", amount: 13000 }),
      };
    };
    // subtotal 100, tax 10% = 10, tip 20% = 20 -> total 130.00 -> 13000 cents
    const r = await call("bookingCreatePaymentIntent", ctxA, { client: "Ada", subtotal: 100, taxRate: 10, tipPercent: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.clientSecret, "pi_svc_1_secret_xyz");
    assert.equal(r.result.paymentIntentId, "pi_svc_1");
    assert.equal(r.result.total, 130);
    assert.equal(r.result.tax, 10);
    assert.equal(r.result.tip, 20);
    assert.ok(r.result.paymentId, "returns a local payment id for correlation");

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.stripe\.com\/v1\/payment_intents$/);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].headers.Authorization, /Bearer sk_test_real/);
    assert.match(calls[0].body, /amount=13000/);
    assert.match(calls[0].body, /currency=usd/);
    assert.match(calls[0].body, /metadata%5Bconcord_user_id%5D=u/);
    assert.match(calls[0].body, /metadata%5Bconcord_purpose%5D=services_booking/);
    assert.match(calls[0].body, new RegExp(`metadata%5Bconcord_payment_id%5D=${r.result.paymentId}`));

    // The payment record is real and persisted, in an honest pre-charge state.
    const list = call("paymentList", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.payments[0].status, "awaiting_confirmation");
    assert.equal(list.result.payments[0].stripePaymentIntentId, "pi_svc_1");
    // Not yet counted as captured revenue — no charge has actually happened yet.
    assert.equal(list.result.gross, 0);
  });

  it("links to an existing booking + stamps pendingPaymentId on it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_svc_2", client_secret: "sec", status: "requires_payment_method", amount: 5000 }),
    });
    const bk = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", service: "Cut", time: "10:00", duration: 60 });
    const r = await call("bookingCreatePaymentIntent", ctxA, { bookingId: bk.result.booking.id, subtotal: 50 });
    assert.equal(r.ok, true);

    const list = call("bookingGridList", ctxA, {});
    const booking = list.result.bookings.find((b) => b.id === bk.result.booking.id);
    assert.equal(booking.pendingPaymentId, r.result.paymentId);
    assert.equal(booking.status, "booked", "not paid/completed yet — only a PaymentIntent exists");
  });
});

describe("services — bookingConfirmPayment (paid ONLY on succeeded)", () => {
  it("errors 'stripe_not_configured' when STRIPE_SECRET_KEY unset", async () => {
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_x" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "stripe_not_configured");
  });

  it("requires paymentIntentId", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const r = await call("bookingConfirmPayment", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /paymentIntentId required/);
  });

  it("errors when no pending payment matches this paymentIntentId (nothing to confirm)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_never_created" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no pending payment found/);
  });

  it("marks paid + completes the linked booking ONLY when Stripe reports status:'succeeded'", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const bk = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", service: "Cut", time: "10:00", duration: 60 });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_success", client_secret: "sec", status: "requires_payment_method", amount: 13000 }),
    });
    const created = await call("bookingCreatePaymentIntent", ctxA, {
      bookingId: bk.result.booking.id, client: "Ada", subtotal: 100, taxRate: 10, tipPercent: 20,
    });
    assert.equal(created.ok, true);

    // Now the server independently re-fetches the PaymentIntent — this is
    // the ONLY signal allowed to flip the payment to paid.
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: "pi_success", status: "succeeded", amount: 13000,
        metadata: { concord_user_id: "u", concord_purpose: "services_booking", concord_payment_id: created.result.paymentId },
        latest_charge: "ch_svc_success",
      }),
    });
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_success" });
    assert.equal(r.ok, true);
    assert.equal(r.result.payment.status, "captured");
    assert.equal(r.result.payment.paymentStatus, "paid");
    assert.equal(r.result.payment.total, 130);
    assert.ok(r.result.payment.capturedAt);
    assert.equal(r.result.payment.stripeChargeId, "ch_svc_success");

    // Real revenue now — paymentList's gross/tips only counts status:'captured'.
    const list = call("paymentList", ctxA, {});
    assert.equal(list.result.gross, 130);
    assert.equal(list.result.tips, 20);
    assert.equal(list.result.byMethod.card, 130);

    // Booking flips to completed + linked to the now-real payment.
    const bookings = call("bookingGridList", ctxA, {});
    const booking = bookings.result.bookings.find((b) => b.id === bk.result.booking.id);
    assert.equal(booking.status, "completed");
    assert.equal(booking.paymentId, created.result.paymentId);
    assert.equal(booking.pendingPaymentId, undefined);
  });

  it("refuses to mark paid when PaymentIntent status is 'requires_payment_method' — NOT captured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_pending", client_secret: "sec", status: "requires_payment_method", amount: 5000 }),
    });
    await call("bookingCreatePaymentIntent", ctxA, { client: "Bea", subtotal: 50 });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_pending", status: "requires_payment_method", metadata: {} }),
    });
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_pending" });
    assert.equal(r.ok, false);
    assert.match(r.error, /payment not succeeded/);
    assert.match(r.error, /requires_payment_method/);

    const list = call("paymentList", ctxA, {});
    assert.equal(list.result.payments[0].status, "awaiting_confirmation");
    assert.notEqual(list.result.payments[0].status, "captured");
    assert.equal(list.result.gross, 0, "no fabricated revenue for a payment that hasn't succeeded");
  });

  it("refuses to mark paid when PaymentIntent status is 'processing' — NOT captured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_processing", client_secret: "sec", status: "requires_payment_method", amount: 5000 }),
    });
    await call("bookingCreatePaymentIntent", ctxA, { client: "Cai", subtotal: 50 });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_processing", status: "processing", metadata: {} }),
    });
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_processing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /payment not succeeded/);
    assert.match(r.error, /processing/);
    const list = call("paymentList", ctxA, {});
    assert.notEqual(list.result.payments[0].status, "captured");
  });

  it("rejects metadata mismatch (anti-tamper) — never trusts a succeeded PI for the wrong user/payment", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_tamper", client_secret: "sec", status: "requires_payment_method", amount: 5000 }),
    });
    await call("bookingCreatePaymentIntent", ctxA, { client: "Dee", subtotal: 50 });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: "pi_tamper", status: "succeeded",
        metadata: { concord_user_id: "someone_else", concord_purpose: "services_booking", concord_payment_id: "pmt_forged" },
      }),
    });
    const r = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_tamper" });
    assert.equal(r.ok, false);
    assert.match(r.error, /metadata mismatch/);
    const list = call("paymentList", ctxA, {});
    assert.notEqual(list.result.payments[0].status, "captured");
  });

  it("is idempotent — confirming an already-captured payment again is a safe no-op success", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ id: "pi_dup", client_secret: "sec", status: "requires_payment_method", amount: 5000 }),
    });
    const created = await call("bookingCreatePaymentIntent", ctxA, { client: "Eve", subtotal: 50 });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: "pi_dup", status: "succeeded", amount: 5000,
        metadata: { concord_user_id: "u", concord_purpose: "services_booking", concord_payment_id: created.result.paymentId },
        latest_charge: "ch_dup",
      }),
    });
    const first = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_dup" });
    assert.equal(first.ok, true);
    assert.equal(first.result.payment.status, "captured");

    const second = await call("bookingConfirmPayment", ctxA, { paymentIntentId: "pi_dup" });
    assert.equal(second.ok, true);
    assert.equal(second.result.alreadyCaptured, true);

    // Only counted once toward revenue — no double-credit from the repeat call.
    const list = call("paymentList", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.gross, 50);
  });
});

describe("services — paymentCapture (quick pay-on-site path) stays honest alongside the new flow", () => {
  it("card + no Stripe configured: still records pay-on-site, never fabricates a charge", () => {
    const r = call("paymentCapture", ctxA, { client: "Fay", subtotal: 40, method: "card", cardLast4: "4242" });
    assert.equal(r.ok, true);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.equal(r.result.paymentStatus, "pay_on_site");
    assert.notEqual(r.result.payment.status, "captured");
  });

  it("card + Stripe configured: quick-capture still can't confirm a charge (no token), points at the real flow", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const r = call("paymentCapture", ctxA, { client: "Gia", subtotal: 40, method: "card", cardLast4: "4242" });
    assert.equal(r.ok, true);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.notEqual(r.result.payment.status, "captured");
    assert.match(r.result.note, /bookingCreatePaymentIntent/);
    assert.match(r.result.note, /without charge/i);
  });
});
