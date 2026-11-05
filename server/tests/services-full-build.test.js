/**
 * SERVICES FULL LENS BUILD — behaviour pins for the F3/F5/F4/F7/F6/F9/F10
 * repair slices (GB-1088 wave 1, B3):
 *
 *   S2  reminderSchedule retains the contact target end-to-end
 *       (schedule → list → dispatch queues it, never "no contact");
 *       reminderGenerate over the Desk-shaped payload (ISO datetimes,
 *       booked/confirmed) counts what falls inside its 24h window.
 *   S3  "configured" means present AND key-shaped; a placeholder env
 *       value is stripe_not_configured; a Stripe rejection surfaces as
 *       plain-language unavailability — raw Stripe errors (which can
 *       quote key material) never reach the caller; the paymentCapture
 *       note asserts presence + no-charge, never "Stripe is configured",
 *       and names no internal macros.
 *   S4  waitlist promotion books only the slot it is given; cancelling
 *       a waitlist-sourced booking reverts its entry to waiting (and
 *       the freed slot is offered to the NEXT matching entry, not back
 *       to the one that just lost it); waitlistRemove really removes.
 *   S5  commissionCalc's result carries the tiers it applied and the
 *       effective rate (the render contract the Desk prints).
 *   S7  every suite record type has an exit: clientProfileDelete,
 *       reminderDelete, paymentDelete, recurringSeriesCancel.
 *   S9  selfBookSlots respects recorded shifts (named staff inside
 *       their own windows; "Any" inside the union) and stays
 *       business-hours when no shifts exist.
 *
 * Harness mirrors services-honest-payment.test.js: register the domain
 * into a local map, invoke handlers directly — hermetic, no network
 * (the one Stripe call is stubbed at globalThis.fetch).
 *
 * Run: node --test server/tests/services-full-build.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerServicesActions from "../domains/services.js";

function buildMacros(register) {
  const map = new Map();
  register((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}
function call(map, name, ctx, params) {
  const fn = map.get(`services.${name}`);
  assert.ok(fn, `services.${name} registered`);
  return fn(ctx, { id: null, data: params || {}, meta: {} }, params || {});
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

let MACROS;
let priorStripeKey;
let priorFetch;
before(() => { MACROS = buildMacros(registerServicesActions); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  priorStripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  priorFetch = globalThis.fetch;
});
afterEach(() => {
  if (priorStripeKey !== undefined) process.env.STRIPE_SECRET_KEY = priorStripeKey;
  else delete process.env.STRIPE_SECRET_KEY;
  globalThis.fetch = priorFetch;
});

/* ── S2: reminder joints ─────────────────────────────────────────── */

describe("services full build — S2 reminder target retention", () => {
  it("schedule retains the entered email; dispatch queues it instead of failing 'no contact'", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const r = call(MACROS, "reminderSchedule", ctxA, {
      client: "Ada", channel: "email", target: "ada@example.com", sendAt: past, body: "See you soon",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.reminder.target, "ada@example.com");

    const list = call(MACROS, "reminderList", ctxA, {});
    assert.equal(list.result.reminders[0].target, "ada@example.com");

    const d = call(MACROS, "reminderDispatch", ctxA, {});
    assert.equal(d.result.queued, 1);
    assert.equal(d.result.failed, 0);
    assert.equal(d.result.deliveredByConcord, 0);
  });

  it("a reminder with no target still fails dispatch honestly", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    call(MACROS, "reminderSchedule", ctxA, { client: "Bo", channel: "sms", target: "", sendAt: past });
    const d = call(MACROS, "reminderDispatch", ctxA, {});
    assert.equal(d.result.failed, 1);
    assert.equal(d.result.failures[0].failureReason, "no contact target");
  });

  it("reminderGenerate over the Desk-shaped payload counts only the in-window appointments", () => {
    const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const inThreeDays = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const r = call(MACROS, "reminderGenerate", ctxA, {
      appointments: [
        { date: inTwoHours, serviceType: "Cut", provider: "Jo", client: "Ada" },
        { date: inThreeDays, serviceType: "Cut", provider: "Jo", client: "Bea" },
      ],
      hoursAhead: 24,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.reminders[0].client, "Ada");
  });
});

/* ── S3: configured truth ────────────────────────────────────────── */

describe("services full build — S3 Stripe configured truth", () => {
  it("no key: intent refuses stripe_not_configured; the capture note says not configured, without charge", async () => {
    const r = await call(MACROS, "bookingCreatePaymentIntent", ctxA, { subtotal: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "stripe_not_configured");

    const cap = call(MACROS, "paymentCapture", ctxA, { client: "Fay", subtotal: 40, method: "card", cardLast4: "4242" });
    assert.equal(cap.ok, true);
    assert.match(cap.result.note, /not configured/i);
    assert.match(cap.result.note, /without charge/i);
    assert.doesNotMatch(cap.result.note, /Stripe is configured/);
  });

  it("a placeholder env value (not key-shaped) is NOT configured", async () => {
    process.env.STRIPE_SECRET_KEY = "placeholder-replace-me";
    const r = await call(MACROS, "bookingCreatePaymentIntent", ctxA, { subtotal: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "stripe_not_configured");
  });

  it("a key-shaped value: the capture note states presence + no charge and names no internals", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const cap = call(MACROS, "paymentCapture", ctxA, { client: "Gia", subtotal: 40, method: "card", cardLast4: "4242" });
    assert.equal(cap.ok, true);
    assert.match(cap.result.note, /Stripe key is present/);
    assert.match(cap.result.note, /without charge/i);
    assert.doesNotMatch(cap.result.note, /Stripe is configured/);
    assert.doesNotMatch(cap.result.note, /bookingCreatePaymentIntent|bookingConfirmPayment/);
  });

  it("a Stripe 401 is sanitized: plain-language unavailability, no key material, no macro names", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API Key provided: sk_test_****1234" } }),
    });
    const r = await call(MACROS, "bookingCreatePaymentIntent", ctxA, { subtotal: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Stripe key was rejected/);
    assert.doesNotMatch(r.error, /sk_test|Invalid API Key|bookingCreatePaymentIntent/);
  });
});

/* ── S4: waitlist reconciliation ─────────────────────────────────── */

describe("services full build — S4 waitlist truth", () => {
  it("promotion books the given slot; cancelling it reverts the entry to waiting", () => {
    const a = call(MACROS, "waitlistAdd", ctxA, { client: "Ada", service: "Cut" });
    const p = call(MACROS, "waitlistPromote", ctxA, { id: a.result.entry.id, date: "2026-06-03", time: "14:30", duration: 45 });
    assert.equal(p.ok, true);
    assert.equal(p.result.booking.date, "2026-06-03");
    assert.equal(p.result.booking.time, "14:30");

    let list = call(MACROS, "waitlistList", ctxA, {});
    assert.equal(list.result.counts.booked, 1);

    const c = call(MACROS, "bookingGridCancel", ctxA, { id: p.result.booking.id });
    assert.equal(c.ok, true);
    list = call(MACROS, "waitlistList", ctxA, {});
    assert.equal(list.result.counts.booked, 0);
    assert.equal(list.result.counts.waiting, 1);
    const entry = list.result.waitlist.find((w) => w.id === a.result.entry.id);
    assert.equal(entry.status, "waiting");
    assert.equal(entry.bookingId, undefined);
  });

  it("the freed slot is offered to the next matching entry, not back to the one that lost it", () => {
    const first = call(MACROS, "waitlistAdd", ctxA, { client: "Ada", service: "Cut" });
    const second = call(MACROS, "waitlistAdd", ctxA, { client: "Bea", service: "Cut" });
    const p = call(MACROS, "waitlistPromote", ctxA, { id: first.result.entry.id, date: "2026-06-03", time: "10:00" });
    assert.equal(p.ok, true);
    call(MACROS, "bookingGridCancel", ctxA, { id: p.result.booking.id });
    const list = call(MACROS, "waitlistList", ctxA, {});
    const bea = list.result.waitlist.find((w) => w.id === second.result.entry.id);
    assert.equal(bea.status, "offered");
    assert.deepEqual(bea.offeredSlot, { date: "2026-06-03", time: "10:00", staff: "Unassigned" });
    const ada = list.result.waitlist.find((w) => w.id === first.result.entry.id);
    assert.equal(ada.status, "waiting");
  });

  it("promotion without a time is refused — the server never invents a slot", () => {
    const a = call(MACROS, "waitlistAdd", ctxA, { client: "Ada", service: "Cut" });
    const p = call(MACROS, "waitlistPromote", ctxA, { id: a.result.entry.id, date: "2026-06-03" });
    assert.equal(p.ok, false);
    assert.match(p.error, /valid time/);
  });

  it("waitlistRemove really removes: gone from list and counts", () => {
    const a = call(MACROS, "waitlistAdd", ctxA, { client: "Ada" });
    const rm = call(MACROS, "waitlistRemove", ctxA, { id: a.result.entry.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, true);
    const list = call(MACROS, "waitlistList", ctxA, {});
    assert.equal(list.result.count, 0);
    assert.equal(list.result.counts.waiting, 0);
  });
});

/* ── S5: commission disclosure contract ──────────────────────────── */

describe("services full build — S5 commissionCalc discloses its rates", () => {
  it("the result carries the applied tiers and the effective rate", () => {
    const fn = MACROS.get("services.commissionCalc");
    const r = fn(ctxA, { id: null, data: { sales: [{ amount: 100, salesperson: "Jo" }] }, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCommission, 5);
    assert.equal(r.result.effectiveRate, 5);
    assert.ok(Array.isArray(r.result.tiers) && r.result.tiers.length >= 1);
    assert.equal(r.result.tiers[0].rate, 0.05);
  });
});

/* ── S7: exits for suite records ─────────────────────────────────── */

describe("services full build — S7 suite record exits", () => {
  it("clientProfileDelete removes the profile; a second delete errors", () => {
    call(MACROS, "clientProfileUpsert", ctxA, { client: "Ada", email: "ada@x.io" });
    assert.equal(call(MACROS, "clientProfileList", ctxA, {}).result.count, 1);
    const d = call(MACROS, "clientProfileDelete", ctxA, { clientKey: "ada" });
    assert.equal(d.ok, true);
    assert.equal(call(MACROS, "clientProfileList", ctxA, {}).result.count, 0);
    assert.equal(call(MACROS, "clientProfileDelete", ctxA, { clientKey: "ada" }).ok, false);
  });

  it("reminderDelete removes the reminder", () => {
    const r = call(MACROS, "reminderSchedule", ctxA, { client: "Ada", target: "ada@x.io", sendAt: "2026-06-01T09:00" });
    const d = call(MACROS, "reminderDelete", ctxA, { id: r.result.reminder.id });
    assert.equal(d.ok, true);
    assert.equal(call(MACROS, "reminderList", ctxA, {}).result.count, 0);
  });

  it("paymentDelete removes the payment record", () => {
    const cap = call(MACROS, "paymentCapture", ctxA, { client: "Ada", subtotal: 25, method: "cash" });
    assert.equal(cap.ok, true);
    const d = call(MACROS, "paymentDelete", ctxA, { id: cap.result.payment.id });
    assert.equal(d.ok, true);
    assert.equal(call(MACROS, "paymentList", ctxA, {}).result.count, 0);
  });

  it("recurringSeriesCancel cancels the series' active bookings exactly once", () => {
    const s = call(MACROS, "recurringSeries", ctxA, {
      client: "Ada", service: "Cut", staff: "Jo", date: "2026-06-01", time: "10:00", frequency: "weekly", occurrences: 3,
    });
    assert.equal(s.ok, true);
    assert.equal(s.result.createdCount, 3);
    const c = call(MACROS, "recurringSeriesCancel", ctxA, { seriesId: s.result.seriesId });
    assert.equal(c.ok, true);
    assert.equal(c.result.cancelled, 3);
    const list = call(MACROS, "bookingGridList", ctxA, { date: "2026-06-01" });
    assert.equal(list.result.bookings[0].status, "cancelled");
    assert.equal(call(MACROS, "recurringSeriesCancel", ctxA, { seriesId: s.result.seriesId }).ok, false);
  });
});

/* ── S9: shift-aware self-booking ────────────────────────────────── */

describe("services full build — S9 selfBookSlots respects shifts", () => {
  it("a named staff member's slots live inside their shift window", () => {
    call(MACROS, "shiftCreate", ctxA, { staff: "Jo", date: "2026-06-01", start: "09:00", end: "12:00" });
    const r = call(MACROS, "selfBookSlots", ctxA, { date: "2026-06-01", duration: 60, staff: ["Jo"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.shiftAware, true);
    assert.ok(r.result.slots.length > 0);
    assert.ok(r.result.slots.every((s) => s.time >= "09:00" && s.time <= "11:00"));
  });

  it('"Any" slots live inside the union of the day\'s shifts when shifts exist', () => {
    call(MACROS, "shiftCreate", ctxA, { staff: "Jo", date: "2026-06-01", start: "14:00", end: "16:00" });
    const r = call(MACROS, "selfBookSlots", ctxA, { date: "2026-06-01", duration: 60, staff: ["Any"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.slots.length > 0);
    assert.ok(r.result.slots.every((s) => s.time >= "14:00" && s.time <= "15:00"));
  });

  it("with no shifts recorded, business hours apply as before", () => {
    const r = call(MACROS, "selfBookSlots", ctxA, { date: "2026-06-01", duration: 60, staff: ["Kim"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.shiftAware, false);
    assert.ok(r.result.count > 0);
  });
});
