// veterinary-reminders-appointments.test.js
// FIX-veterinary-010 (GB-1521 slice B6) — vaccine-reminders ignored
// booked appointments entirely: an appointment inside the look-ahead
// window never appeared as due soon. Scheduled appointments now ride
// both lists (past-dated still-scheduled = overdue/missed).
//
// Run: node --test server/domains/veterinary-reminders-appointments.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVeterinaryActions from "./veterinary.js";

const actions = new Map();
registerVeterinaryActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };

beforeEach(() => { globalThis._concordSTATE = {}; });

function inDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

describe("veterinary-010 — reminders include appointments", () => {
  it("an appointment within 30 days shows as due soon", () => {
    const book = actions.get("veterinary:appointment-book");
    const r = book(ctx, null, { patientName: "Biscuit", date: inDays(5), type: "checkup" });
    assert.equal(r.ok, true);
    const rem = actions.get("veterinary:vaccine-reminders")(ctx, null, { horizonDays: 30 });
    assert.equal(rem.ok, true);
    const hit = rem.result.dueSoon.find((e) => e.kind === "appointment");
    assert.ok(hit, "expected an appointment entry in dueSoon");
    assert.equal(hit.patientName, "Biscuit");
  });

  it("a cancelled appointment does not appear; an appointment beyond the horizon does not either", () => {
    const book = actions.get("veterinary:appointment-book");
    const a = book(ctx, null, { patientName: "Miso", date: inDays(3) }).result.appointment;
    book(ctx, null, { patientName: "Far", date: inDays(90) });
    actions.get("veterinary:appointment-status")(ctx, null, { id: a.id, status: "cancelled" });
    const rem = actions.get("veterinary:vaccine-reminders")(ctx, null, { horizonDays: 30 });
    assert.equal(rem.result.dueSoon.filter((e) => e.kind === "appointment").length, 0);
  });
});
