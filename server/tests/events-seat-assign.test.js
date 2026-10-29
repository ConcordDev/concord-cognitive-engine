// server/tests/events-seat-assign.test.js
//
// Q18 (E-80): a failed seat-assign must not cost the guest their seat.
// The old seat-assign removed the guest from every table BEFORE the
// capacity check, so a "table is full" refusal left them unseated.
// Pins: failed move preserves the original seat; successful move still
// de-seats the old table; same-table re-assign at full capacity is a
// no-op success; a fresh guest is still refused at a full table.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEventsActions from "../domains/events.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`events.${name}`);
  if (!fn) throw new Error(`events.${name} not registered`);
  return fn({ actor: { userId: "host-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEventsActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function setup() {
  const ev = call("event-create", { name: "Gala" }).result.event;
  const t1 = call("table-add", { eventId: ev.id, label: "T1", capacity: 1 }).result.table;
  const t2 = call("table-add", { eventId: ev.id, label: "T2", capacity: 1 }).result.table;
  return { ev, t1, t2 };
}
const seatedAt = (eventId, tableId) =>
  call("floor-plan", { eventId }).result.tables.find((t) => t.id === tableId).seats.map((s) => s.guestName);

describe("events seat-assign (Q18)", () => {
  it("a failed move to a full table preserves the guest's original seat", () => {
    const { ev, t1, t2 } = setup();
    call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "Ada" });
    call("seat-assign", { eventId: ev.id, tableId: t2.id, guestName: "Grace" });
    const r = call("seat-assign", { eventId: ev.id, tableId: t2.id, guestName: "Ada" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "table is full");
    assert.deepEqual(seatedAt(ev.id, t1.id), ["Ada"], "Ada keeps her T1 seat after the refused move");
    assert.deepEqual(seatedAt(ev.id, t2.id), ["Grace"], "T2 is untouched");
  });

  it("a successful move still de-seats the old table (no double-seating)", () => {
    const { ev, t1, t2 } = setup();
    call("table-move", { eventId: ev.id, tableId: t2.id, capacity: 2 });
    call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "Ada" });
    const r = call("seat-assign", { eventId: ev.id, tableId: t2.id, guestName: "Ada" });
    assert.equal(r.ok, true);
    assert.deepEqual(seatedAt(ev.id, t1.id), []);
    assert.deepEqual(seatedAt(ev.id, t2.id), ["Ada"]);
  });

  it("re-assigning a guest to the full table they already sit at succeeds", () => {
    const { ev, t1 } = setup();
    call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "Ada", registrationId: "r1" });
    const r = call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "Ada", registrationId: "r2" });
    assert.equal(r.ok, true);
    assert.deepEqual(seatedAt(ev.id, t1.id), ["Ada"]);
  });

  it("a fresh guest is still refused at a full table", () => {
    const { ev, t1 } = setup();
    call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "Ada" });
    const r = call("seat-assign", { eventId: ev.id, tableId: t1.id, guestName: "New Guest" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "table is full");
    assert.deepEqual(seatedAt(ev.id, t1.id), ["Ada"]);
  });
});
