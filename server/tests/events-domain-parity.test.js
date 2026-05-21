// Contract tests for server/domains/events.js — the ticketing, public page,
// seating, budget builder, agenda, check-in, and blast macros added to reach
// Eventbrite/Cvent feature parity. Pattern mirrors travel-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEventsActions from "../domains/events.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`events.${name}`);
  if (!fn) throw new Error(`events.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEventsActions(register); });

const ctxA = { actor: { userId: "events_user_a" }, userId: "events_user_a" };

beforeEach(() => {
  // Fresh per-user STATE for every test so collections don't leak.
  globalThis._concordSTATE = {};
});

function newEvent() {
  const r = call("event-create", ctxA, { name: "Test Summit", type: "conference", budget: 10000 });
  assert.equal(r.ok, true);
  return r.result.event.id;
}

describe("events ticketing — tiers + registration + capacity", () => {
  it("creates a ticket tier and lists it with computed remaining", () => {
    const eventId = newEvent();
    const t = call("tier-create", ctxA, { eventId, name: "GA", price: 50, quantity: 100 });
    assert.equal(t.ok, true);
    assert.equal(t.result.tier.name, "GA");
    const list = call("tier-list", ctxA, { eventId });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.tiers[0].remaining, 100);
    assert.equal(list.result.totalCapacity, 100);
  });

  it("registers an attendee, decrements tier, tracks capacity", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "VIP", price: 200, quantity: 2 }).result.tier.id;
    const reg = call("register-attendee", ctxA, { eventId, tierId, name: "Ada", email: "ada@x.io" });
    assert.equal(reg.ok, true);
    assert.ok(reg.result.registration.ticketCode.startsWith("TKT-"));
    const regs = call("registration-list", ctxA, { eventId });
    assert.equal(regs.ok, true);
    assert.equal(regs.result.count, 1);
    assert.equal(regs.result.revenue, 200);
  });

  it("rejects registration when tier is sold out", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "Tiny", price: 10, quantity: 1 }).result.tier.id;
    assert.equal(call("register-attendee", ctxA, { eventId, tierId, name: "A", email: "a@x.io" }).ok, true);
    const second = call("register-attendee", ctxA, { eventId, tierId, name: "B", email: "b@x.io" });
    assert.equal(second.ok, false);
    assert.match(second.error, /sold out/);
  });

  it("cancels a registration and releases tickets back to the tier", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 25, quantity: 10 }).result.tier.id;
    const regId = call("register-attendee", ctxA, { eventId, tierId, name: "C", email: "c@x.io", quantity: 3 }).result.registration.id;
    const cancel = call("registration-cancel", ctxA, { eventId, registrationId: regId });
    assert.equal(cancel.ok, true);
    assert.equal(cancel.result.releasedTickets, 3);
    assert.equal(call("tier-list", ctxA, { eventId }).result.tiers[0].sold, 0);
  });

  it("tier-update and tier-delete work", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "Old", price: 1, quantity: 5 }).result.tier.id;
    assert.equal(call("tier-update", ctxA, { eventId, tierId, price: 99 }).result.tier.price, 99);
    assert.equal(call("tier-delete", ctxA, { eventId, tierId }).ok, true);
    assert.equal(call("tier-list", ctxA, { eventId }).result.count, 0);
  });
});

describe("events public page — publish + slug lookup", () => {
  it("publishes a page with a generated slug and share url", () => {
    const eventId = newEvent();
    const pub = call("publish-page", ctxA, { eventId, headline: "Join us", blurb: "Great event" });
    assert.equal(pub.ok, true);
    assert.ok(pub.result.publicPage.slug);
    assert.ok(pub.result.shareUrl.startsWith("/e/"));
  });

  it("public-page resolves event data by slug and increments views", () => {
    const eventId = newEvent();
    const slug = call("publish-page", ctxA, { eventId, headline: "H" }).result.publicPage.slug;
    const page = call("public-page", ctxA, { slug });
    assert.equal(page.ok, true);
    assert.equal(page.result.event.name, "Test Summit");
    assert.equal(page.result.publicPage.views, 1);
  });

  it("public-page fails for unknown slug", () => {
    assert.equal(call("public-page", ctxA, { slug: "nope-xxxx" }).ok, false);
  });
});

describe("events seating / floor plan builder", () => {
  it("adds a table, assigns a seat, reports the floor plan", () => {
    const eventId = newEvent();
    const tableId = call("table-add", ctxA, { eventId, label: "Table 1", capacity: 4 }).result.table.id;
    const seat = call("seat-assign", ctxA, { eventId, tableId, guestName: "Grace" });
    assert.equal(seat.ok, true);
    assert.equal(seat.result.seated, 1);
    const plan = call("floor-plan", ctxA, { eventId });
    assert.equal(plan.ok, true);
    assert.equal(plan.result.assignedSeats, 1);
    assert.equal(plan.result.openSeats, 3);
  });

  it("rejects seating when the table is full", () => {
    const eventId = newEvent();
    const tableId = call("table-add", ctxA, { eventId, label: "T", capacity: 1 }).result.table.id;
    assert.equal(call("seat-assign", ctxA, { eventId, tableId, guestName: "A" }).ok, true);
    assert.equal(call("seat-assign", ctxA, { eventId, tableId, guestName: "B" }).ok, false);
  });

  it("moves a table and unassigns a seat", () => {
    const eventId = newEvent();
    const tableId = call("table-add", ctxA, { eventId, label: "T", capacity: 4 }).result.table.id;
    assert.equal(call("table-move", ctxA, { eventId, tableId, x: 200, y: 150 }).result.table.x, 200);
    call("seat-assign", ctxA, { eventId, tableId, guestName: "Z" });
    assert.equal(call("seat-unassign", ctxA, { eventId, guestName: "Z" }).ok, true);
    assert.equal(call("table-remove", ctxA, { eventId, tableId }).ok, true);
  });
});

describe("events budget builder — line items", () => {
  it("adds expense + revenue lines and rolls up a summary", () => {
    const eventId = newEvent();
    call("budget-line-add", ctxA, { eventId, label: "Catering", category: "catering", kind: "expense", budgeted: 3000, actual: 3200 });
    call("budget-line-add", ctxA, { eventId, label: "Sponsor", category: "sponsorship", kind: "revenue", actual: 5000 });
    const sum = call("budget-summary", ctxA, { eventId });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.actualExpense, 3200);
    assert.equal(sum.result.overBudget, true);
    assert.equal(sum.result.actualRevenue, 5000);
  });

  it("budget summary folds ticket revenue from tiers", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 100, quantity: 50 }).result.tier.id;
    call("register-attendee", ctxA, { eventId, tierId, name: "X", email: "x@x.io", quantity: 2 });
    const sum = call("budget-summary", ctxA, { eventId });
    assert.equal(sum.result.ticketRevenue, 200);
  });

  it("updates and deletes budget lines", () => {
    const eventId = newEvent();
    const lineId = call("budget-line-add", ctxA, { eventId, label: "AV", budgeted: 1000 }).result.line.id;
    assert.equal(call("budget-line-update", ctxA, { eventId, lineId, actual: 900 }).result.line.actual, 900);
    assert.equal(call("budget-line-delete", ctxA, { eventId, lineId }).ok, true);
  });
});

describe("events agenda / run-of-show", () => {
  it("adds agenda items and builds a day-grouped timeline with end times", () => {
    const eventId = newEvent();
    call("agenda-item-add", ctxA, { eventId, title: "Keynote", day: "2026-06-01", startTime: "09:00", durationMin: 60 });
    call("agenda-item-add", ctxA, { eventId, title: "Lunch", day: "2026-06-01", startTime: "12:00", durationMin: 90 });
    const tl = call("agenda-timeline", ctxA, { eventId });
    assert.equal(tl.ok, true);
    assert.equal(tl.result.totalItems, 2);
    assert.equal(tl.result.days["2026-06-01"][0].endTime, "10:00");
    assert.equal(tl.result.totalDurationMin, 150);
  });

  it("updates and deletes agenda items", () => {
    const eventId = newEvent();
    const itemId = call("agenda-item-add", ctxA, { eventId, title: "Panel" }).result.item.id;
    assert.equal(call("agenda-item-update", ctxA, { eventId, itemId, durationMin: 45 }).result.item.durationMin, 45);
    assert.equal(call("agenda-item-delete", ctxA, { eventId, itemId }).ok, true);
  });
});

describe("events check-in / QR scanning", () => {
  it("checks in by ticket code and tracks attendance", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 0, quantity: 10 }).result.tier.id;
    const reg = call("register-attendee", ctxA, { eventId, tierId, name: "Lin", email: "lin@x.io" }).result.registration;
    const ci = call("check-in", ctxA, { eventId, ticketCode: reg.ticketCode });
    assert.equal(ci.ok, true);
    assert.equal(ci.result.checkedInCount, 1);
  });

  it("rejects an invalid ticket code and double check-in", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 0, quantity: 10 }).result.tier.id;
    const reg = call("register-attendee", ctxA, { eventId, tierId, name: "M", email: "m@x.io" }).result.registration;
    assert.equal(call("check-in", ctxA, { eventId, ticketCode: "BOGUS-1" }).ok, false);
    call("check-in", ctxA, { eventId, ticketCode: reg.ticketCode });
    assert.equal(call("check-in", ctxA, { eventId, ticketCode: reg.ticketCode }).ok, false);
  });

  it("check-in-status and check-in-undo behave correctly", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 0, quantity: 10 }).result.tier.id;
    const reg = call("register-attendee", ctxA, { eventId, tierId, name: "N", email: "n@x.io" }).result.registration;
    call("check-in", ctxA, { eventId, registrationId: reg.id });
    assert.equal(call("check-in-status", ctxA, { eventId }).result.checkedInCount, 1);
    assert.equal(call("check-in-undo", ctxA, { eventId, registrationId: reg.id }).result.registration.checkedIn, false);
    assert.equal(call("check-in-status", ctxA, { eventId }).result.checkedInCount, 0);
  });
});

describe("events email / notification blasts", () => {
  it("sends a blast to all registrants and lists it", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 0, quantity: 10 }).result.tier.id;
    call("register-attendee", ctxA, { eventId, tierId, name: "P", email: "p@x.io" });
    const blast = call("blast-send", ctxA, { eventId, subject: "Reminder", body: "See you soon", segment: "all" });
    assert.equal(blast.ok, true);
    assert.equal(blast.result.delivered, 1);
    const list = call("blast-list", ctxA, { eventId });
    assert.equal(list.result.count, 1);
  });

  it("segments a blast to not-checked-in registrants", () => {
    const eventId = newEvent();
    const tierId = call("tier-create", ctxA, { eventId, name: "GA", price: 0, quantity: 10 }).result.tier.id;
    const r1 = call("register-attendee", ctxA, { eventId, tierId, name: "A", email: "a@x.io" }).result.registration;
    call("register-attendee", ctxA, { eventId, tierId, name: "B", email: "b@x.io" });
    call("check-in", ctxA, { eventId, registrationId: r1.id });
    const blast = call("blast-send", ctxA, { eventId, subject: "Where are you", body: "...", segment: "not-checked-in" });
    assert.equal(blast.result.delivered, 1);
  });

  it("rejects a blast with no subject and deletes a blast", () => {
    const eventId = newEvent();
    assert.equal(call("blast-send", ctxA, { eventId, body: "x" }).ok, false);
    const blastId = call("blast-send", ctxA, { eventId, subject: "S", body: "B" }).result.blast.id;
    assert.equal(call("blast-delete", ctxA, { eventId, blastId }).ok, true);
  });
});

describe("events macro guards — never throw, return ok:false", () => {
  it("every new macro fails gracefully for an unknown event id", () => {
    const macros = [
      "tier-create", "tier-list", "tier-update", "tier-delete",
      "register-attendee", "registration-list", "registration-cancel",
      "publish-page", "table-add", "table-move", "table-remove",
      "seat-assign", "seat-unassign", "floor-plan",
      "budget-line-add", "budget-line-update", "budget-line-delete", "budget-summary",
      "agenda-item-add", "agenda-item-update", "agenda-item-delete", "agenda-timeline",
      "check-in", "check-in-undo", "check-in-status",
      "blast-send", "blast-list", "blast-delete",
    ];
    for (const m of macros) {
      const r = call(m, ctxA, { eventId: "evt_does_not_exist" });
      assert.equal(r.ok, false, `${m} should return ok:false`);
      assert.ok(typeof r.error === "string", `${m} should carry an error string`);
    }
  });
});
