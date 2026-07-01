// Contract tests for server/domains/services.js — booking grid, online
// self-booking, POS payment capture, automated reminder delivery, staff
// shift management, client profiles, recurring appointments + waitlist.
// Pattern mirrors travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerServicesActions from "../domains/services.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`services.${name}`);
  if (!fn) throw new Error(`services.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerServicesActions(register); });

// Each test gets a clean per-user substrate.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("services — booking grid", () => {
  it("creates a booking and lists it", () => {
    const c = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", time: "10:00", duration: 60 });
    assert.equal(c.ok, true);
    assert.equal(c.result.booking.time, "10:00");
    const l = call("bookingGridList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.deepEqual(l.result.staffLanes, ["Jo"]);
  });

  it("rejects an overlapping booking for the same staff", () => {
    call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", time: "10:00", duration: 60 });
    const conflict = call("bookingGridCreate", ctxA, { client: "Bea", staff: "Jo", time: "10:30", duration: 30 });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /conflict/);
  });

  it("rejects an invalid time", () => {
    const r = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", time: "nope" });
    assert.equal(r.ok, false);
  });

  it("moves a booking to a free slot", () => {
    const c = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", time: "10:00", duration: 60 });
    const m = call("bookingGridMove", ctxA, { id: c.result.booking.id, time: "13:00" });
    assert.equal(m.ok, true);
    assert.equal(m.result.booking.time, "13:00");
  });

  it("cancel promotes a matching waitlist entry", () => {
    const c = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", service: "Cut", time: "10:00", duration: 60 });
    call("waitlistAdd", ctxA, { client: "Bea", service: "Cut" });
    const x = call("bookingGridCancel", ctxA, { id: c.result.booking.id });
    assert.equal(x.ok, true);
    assert.equal(x.result.promotedFromWaitlist.client, "Bea");
  });

  it("isolates bookings per user", () => {
    call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", time: "10:00" });
    const l = call("bookingGridList", ctxB, {});
    assert.equal(l.result.count, 0);
  });
});

describe("services — online self-booking", () => {
  it("returns open slots inside business hours", () => {
    const r = call("selfBookSlots", ctxA, { date: "2026-06-01", duration: 60, staff: ["Jo"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.count > 0);
  });

  it("excludes already-booked slots", () => {
    call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", date: "2026-06-01", time: "10:00", duration: 60 });
    const r = call("selfBookSlots", ctxA, { date: "2026-06-01", duration: 60, staff: ["Jo"] });
    assert.ok(!r.result.slots.some((s) => s.time === "10:00"));
  });

  it("confirms a self-booking and auto-queues a reminder", () => {
    const r = call("selfBookConfirm", ctxA, { client: "Ada", staff: "Jo", date: "2026-06-01", time: "11:00", email: "ada@x.io" });
    assert.equal(r.ok, true);
    assert.ok(r.result.confirmation);
    const rem = call("reminderList", ctxA, {});
    assert.equal(rem.result.count, 1);
    assert.equal(rem.result.reminders[0].channel, "email");
  });

  it("rejects a confirm without a client name", () => {
    const r = call("selfBookConfirm", ctxA, { staff: "Jo", date: "2026-06-01", time: "11:00" });
    assert.equal(r.ok, false);
  });
});

describe("services — POS payment capture", () => {
  it("records a card sale honestly as pay-on-site (no processor → never 'captured')", () => {
    const r = call("paymentCapture", ctxA, { client: "Ada", subtotal: 100, taxRate: 10, tipPercent: 20, method: "card", cardLast4: "4242" });
    assert.equal(r.ok, true);
    assert.equal(r.result.payment.tax, 10);
    assert.equal(r.result.payment.tip, 20);
    assert.equal(r.result.payment.total, 130);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.equal(r.result.paymentStatus, "pay_on_site");
    assert.equal(r.result.payment.status, "unprovisioned");
  });

  it("the '0000' magic-decline simulation is gone — same honest shape as any card", () => {
    const r = call("paymentCapture", ctxA, { client: "Ada", subtotal: 50, method: "card", cardLast4: "0000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.authStatus, "unprovisioned");
    assert.notEqual(r.result.payment.status, "declined");
    assert.notEqual(r.result.payment.status, "captured");
  });

  it("rejects a non-positive subtotal", () => {
    const r = call("paymentCapture", ctxA, { client: "Ada", subtotal: 0 });
    assert.equal(r.ok, false);
  });

  it("refunds a captured payment", () => {
    const p = call("paymentCapture", ctxA, { client: "Ada", subtotal: 80, method: "cash" });
    const r = call("paymentRefund", ctxA, { id: p.result.payment.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.payment.status, "refunded");
  });

  it("aggregates captured payments by method — pay-on-site card records never count as captured", () => {
    call("paymentCapture", ctxA, { client: "Ada", subtotal: 100, method: "card", cardLast4: "1111" });
    call("paymentCapture", ctxA, { client: "Bea", subtotal: 50, method: "cash" });
    const l = call("paymentList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 2);
    assert.equal(l.result.gross, 50);              // cash only — no card was charged
    assert.ok(l.result.byMethod.cash > 0);
    assert.equal(l.result.byMethod.card, undefined); // unprovisioned ≠ captured
  });
});

describe("services — automated reminder delivery", () => {
  it("schedules and dispatches a due reminder", () => {
    call("reminderSchedule", ctxA, { client: "Ada", channel: "sms", target: "555-0100", sendAt: "2020-01-01T09:00:00Z" });
    const d = call("reminderDispatch", ctxA, { now: "2026-01-01T00:00:00Z" });
    assert.equal(d.ok, true);
    assert.equal(d.result.dispatched, 1);
  });

  it("fails a reminder with no contact target", () => {
    call("reminderSchedule", ctxA, { client: "Ada", channel: "sms", target: "", sendAt: "2020-01-01T09:00:00Z" });
    const d = call("reminderDispatch", ctxA, { now: "2026-01-01T00:00:00Z" });
    assert.equal(d.result.failed, 1);
  });

  it("rejects a reminder with neither bookingId nor client", () => {
    const r = call("reminderSchedule", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("counts reminders by status", () => {
    call("reminderSchedule", ctxA, { client: "Ada", target: "x", sendAt: "2030-01-01T00:00:00Z" });
    const l = call("reminderList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.counts.scheduled, 1);
  });
});

describe("services — staff shifts", () => {
  it("creates a shift and computes hours", () => {
    const r = call("shiftCreate", ctxA, { staff: "Jo", start: "09:00", end: "17:00" });
    assert.equal(r.ok, true);
    assert.equal(r.result.shift.hours, 8);
  });

  it("rejects an overlapping shift", () => {
    call("shiftCreate", ctxA, { staff: "Jo", start: "09:00", end: "17:00" });
    const r = call("shiftCreate", ctxA, { staff: "Jo", start: "12:00", end: "18:00" });
    assert.equal(r.ok, false);
  });

  it("updates a shift status", () => {
    const c = call("shiftCreate", ctxA, { staff: "Jo", start: "09:00", end: "17:00" });
    const u = call("shiftUpdate", ctxA, { id: c.result.shift.id, status: "vacation" });
    assert.equal(u.ok, true);
    assert.equal(u.result.shift.status, "vacation");
  });

  it("reports free slots from staff availability", () => {
    call("shiftCreate", ctxA, { staff: "Jo", date: "2026-06-02", start: "09:00", end: "12:00" });
    const a = call("staffAvailability", ctxA, { staff: "Jo", date: "2026-06-02", duration: 60 });
    assert.equal(a.ok, true);
    assert.equal(a.result.available, true);
    assert.ok(a.result.freeSlots.length > 0);
  });

  it("reports unavailable when no shift exists", () => {
    const a = call("staffAvailability", ctxA, { staff: "Jo", date: "2026-06-09" });
    assert.equal(a.ok, true);
    assert.equal(a.result.available, false);
  });
});

describe("services — client profiles", () => {
  it("upserts a profile then lists it", () => {
    const u = call("clientProfileUpsert", ctxA, { client: "Ada Lovelace", phone: "555-0100", allergies: "latex" });
    assert.equal(u.ok, true);
    const l = call("clientProfileList", ctxA, {});
    assert.equal(l.result.count, 1);
    assert.equal(l.result.profiles[0].allergies, "latex");
  });

  it("rejects an upsert without a client name", () => {
    const r = call("clientProfileUpsert", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("derives client history from bookings + payments", () => {
    call("clientProfileUpsert", ctxA, { client: "Ada", preferredProvider: "Jo" });
    const c = call("bookingGridCreate", ctxA, { client: "Ada", staff: "Jo", service: "Cut", time: "10:00" });
    call("paymentCapture", ctxA, { client: "Ada", bookingId: c.result.booking.id, subtotal: 60, method: "cash" });
    const h = call("clientHistory", ctxA, { client: "Ada" });
    assert.equal(h.ok, true);
    assert.equal(h.result.visits, 1);
    assert.equal(h.result.totalSpend, 60);
    assert.ok(h.result.rebookSuggestion);
  });
});

describe("services — recurring + waitlist", () => {
  it("creates a recurring weekly series", () => {
    const r = call("recurringSeries", ctxA, { client: "Ada", staff: "Jo", date: "2026-06-01", time: "10:00", frequency: "weekly", occurrences: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.createdCount, 4);
    assert.equal(r.result.frequency, "weekly");
  });

  it("rejects a series without a client", () => {
    const r = call("recurringSeries", ctxA, { staff: "Jo", time: "10:00" });
    assert.equal(r.ok, false);
  });

  it("adds, promotes and removes waitlist entries", () => {
    const a = call("waitlistAdd", ctxA, { client: "Ada", service: "Cut", priority: "high" });
    assert.equal(a.ok, true);
    const p = call("waitlistPromote", ctxA, { id: a.result.entry.id, date: "2026-06-03", time: "11:00" });
    assert.equal(p.ok, true);
    assert.equal(p.result.entry.status, "booked");
    const b = call("waitlistAdd", ctxA, { client: "Bea" });
    const rm = call("waitlistRemove", ctxA, { id: b.result.entry.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.entry.status, "removed");
  });

  it("orders the waitlist by priority", () => {
    call("waitlistAdd", ctxA, { client: "Low", priority: "low" });
    call("waitlistAdd", ctxA, { client: "High", priority: "high" });
    const l = call("waitlistList", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.waitlist[0].client, "High");
  });
});

describe("services — original analytics macros still register", () => {
  it("scheduleOptimize / reminderGenerate / supplyCheck respond ok", () => {
    for (const name of ["scheduleOptimize", "reminderGenerate", "supplyCheck"]) {
      const fn = ACTIONS.get(`services.${name}`);
      const r = fn(ctxA, { id: null, data: {}, meta: {} }, {});
      assert.equal(r.ok, true, `${name} should return ok`);
    }
  });
});
