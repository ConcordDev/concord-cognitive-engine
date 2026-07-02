/**
 * PRODUCTION HONESTY — services POS card payments never fabricate a charge.
 *
 * A previous build of services.paymentCapture "captured" any card whose last4
 * wasn't the magic "0000" with NO payment processor behind it, returning
 * authStatus "captured" + a receipt (surfaced in BookingSuite.tsx). A real
 * user could believe they charged a customer's card. This file pins the
 * honest contract:
 *
 *   (a) card sale with no STRIPE_SECRET_KEY → ok:true, booked:true,
 *       authStatus "unprovisioned", paymentStatus "pay_on_site" — and NEVER
 *       any "captured" claim;
 *   (b) the "0000" magic-decline simulation is gone entirely;
 *   (c) non-payment services macros (booking grid, self-book, reminders) and
 *       honest non-card tenders (cash) are unaffected.
 *
 * Pattern mirrors server/tests/connector-extra-paths.test.js: register the
 * domain's lens actions into a local macro map, invoke handlers directly with
 * (ctx, virtualArtifact, params) — hermetic, no server boot, no network.
 *
 * Run: node --test server/tests/services-honest-payment.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerServicesActions from "../domains/services.js";

function buildMacros(register) {
  const map = new Map();
  register((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}
function callMacro(map, key, ctx, params) {
  const fn = map.get(key);
  assert.ok(fn, `${key} registered`);
  return fn(ctx, { id: null, data: params || {}, meta: {} }, params || {});
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

let MACROS;
let priorStripeKey;
before(() => { MACROS = buildMacros(registerServicesActions); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  priorStripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
});
afterEach(() => {
  if (priorStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = priorStripeKey;
  else delete process.env.STRIPE_SECRET_KEY;
});

describe("services — honest card payments (no Stripe env)", () => {
  it("(a) card + booking: booked:true, authStatus 'unprovisioned', pay_on_site — never 'captured'", () => {
    const bk = callMacro(MACROS, "services.bookingGridCreate", ctxA, {
      client: "Ada", staff: "Jo", service: "Cut", time: "10:00", duration: 60,
    });
    assert.equal(bk.ok, true, "booking itself is real (a recorded row)");

    const r = callMacro(MACROS, "services.paymentCapture", ctxA, {
      client: "Ada", bookingId: bk.result.booking.id,
      subtotal: 100, taxRate: 10, tipPercent: 20, method: "card", cardLast4: "4242",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.booked, true);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.equal(r.result.paymentStatus, "pay_on_site");
    assert.match(r.result.note, /not configured/i);
    assert.match(r.result.note, /without charge/i);

    // NO "captured" claim anywhere in the result values.
    assert.notEqual(r.result.authStatus, "captured");
    assert.notEqual(r.result.payment.status, "captured");
    assert.equal(r.result.payment.status, "unprovisioned");
    assert.equal(r.result.payment.capturedAt, null, "no capture timestamp on an uncaptured payment");

    // Math is still real (recorded amount owed on site).
    assert.equal(r.result.payment.tax, 10);
    assert.equal(r.result.payment.tip, 20);
    assert.equal(r.result.payment.total, 130);

    // The linked booking stays booked (NOT completed/paid — no funds moved),
    // with the pending payment linked for on-site settlement.
    const list = callMacro(MACROS, "services.bookingGridList", ctxA, {});
    const booking = list.result.bookings.find((b) => b.id === bk.result.booking.id);
    assert.equal(booking.status, "booked");
    assert.equal(booking.paymentId, undefined, "no paymentId — nothing was paid");
    assert.equal(booking.pendingPaymentId, r.result.payment.id);
  });

  it("(a2) unprovisioned card records never count toward captured gross / byMethod, and are not refundable", () => {
    callMacro(MACROS, "services.paymentCapture", ctxA, {
      client: "Ada", subtotal: 100, method: "card", cardLast4: "4242",
    });
    const l = callMacro(MACROS, "services.paymentList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.gross, 0, "nothing was charged → zero captured gross");
    assert.equal(l.result.byMethod.card, undefined);

    const refund = callMacro(MACROS, "services.paymentRefund", ctxA, {
      id: l.result.payments[0].id,
    });
    assert.equal(refund.ok, false, "cannot refund a charge that never happened");
    assert.match(refund.error, /captured/);
  });

  it("(a3) even with STRIPE_SECRET_KEY set, a last4-only macro never fabricates a capture", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const r = callMacro(MACROS, "services.paymentCapture", ctxA, {
      client: "Ada", subtotal: 60, method: "card", cardLast4: "4242",
    });
    // No confirmable payment token flows through this macro, so an honest
    // implementation cannot claim capture regardless of the env key.
    assert.equal(r.ok, true);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.equal(r.result.paymentStatus, "pay_on_site");
    assert.notEqual(r.result.payment.status, "captured");
    assert.match(r.result.note, /without charge/i);
  });

  it("(b) the '0000' magic-decline simulation is gone", () => {
    const r = callMacro(MACROS, "services.paymentCapture", ctxA, {
      client: "Rae", subtotal: 50, method: "card", cardLast4: "0000",
    });
    assert.equal(r.ok, true, "no fake decline — same honest shape as any card");
    assert.notEqual(r.result.payment.status, "declined");
    assert.notEqual(r.result.payment.status, "captured");
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.equal(r.result.payment.cardLast4, "0000");
    // And the old {ok:false, error:"card declined"} shape must not resurface.
    assert.equal(r.error, undefined);
  });

  it("(c) cash tender is a real POS capture: refundable + completes the linked booking", () => {
    const bk = callMacro(MACROS, "services.bookingGridCreate", ctxA, {
      client: "Bea", staff: "Jo", service: "Trim", time: "13:00", duration: 30,
    });
    const cap = callMacro(MACROS, "services.paymentCapture", ctxA, {
      client: "Bea", bookingId: bk.result.booking.id, subtotal: 80, method: "cash",
    });
    assert.equal(cap.ok, true);
    assert.equal(cap.result.payment.status, "captured", "cash physically received is an honest capture");
    assert.ok(cap.result.payment.capturedAt);

    const list = callMacro(MACROS, "services.bookingGridList", ctxA, {});
    const booking = list.result.bookings.find((b) => b.id === bk.result.booking.id);
    assert.equal(booking.status, "completed");
    assert.equal(booking.paymentId, cap.result.payment.id);

    const refund = callMacro(MACROS, "services.paymentRefund", ctxA, { id: cap.result.payment.id });
    assert.equal(refund.ok, true);
    assert.equal(refund.result.refunded, 80);
  });

  it("(c2) non-payment services macros are unaffected", () => {
    const bk = callMacro(MACROS, "services.bookingGridCreate", ctxA, {
      client: "Cai", staff: "Jo", time: "09:00", duration: 30,
    });
    assert.equal(bk.ok, true);

    const slots = callMacro(MACROS, "services.selfBookSlots", ctxA, {
      date: "2026-07-01", duration: 30, staff: ["Jo"],
    });
    assert.equal(slots.ok, true);
    assert.ok(slots.result.count > 0);

    const confirm = callMacro(MACROS, "services.selfBookConfirm", ctxA, {
      client: "Dee", staff: "Jo", date: "2026-07-01", time: "15:00", email: "dee@x.io",
    });
    assert.equal(confirm.ok, true);
    assert.ok(confirm.result.confirmation);

    const rem = callMacro(MACROS, "services.reminderList", ctxA, {});
    assert.equal(rem.ok, true);
    assert.equal(rem.result.count, 1);

    const badSubtotal = callMacro(MACROS, "services.paymentCapture", ctxA, { client: "Eve", subtotal: 0 });
    assert.equal(badSubtotal.ok, false, "validation rejection unchanged");
  });
});
