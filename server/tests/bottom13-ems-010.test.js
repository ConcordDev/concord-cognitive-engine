// FIX-emergency-services-010 — opening an incident's detail recorded
// exactly 1 failed request on the shell's SystemStatus tracker: the
// detail fires incident-timeline + nearest-unit, and nearest-unit
// answered { ok:false, "incident has no map position" } for every
// position-less incident — a normal state (geo is optional at create),
// not a failure. nearest-unit now answers ok:true with the empty
// ranking + noPosition for that case; genuine errors (unknown
// incident) still refuse.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, domain: "emergency-services", type: "domain_action", data: input, meta: {} }, input);
}

before(() => { registerEmergencyServicesActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctx = { actor: { userId: "dispatcher_a" }, userId: "dispatcher_a" };

describe("FIX-emergency-services-010 — nearest-unit on a position-less incident", () => {
  it("answers ok with noPosition and an empty ranking instead of a failed request", () => {
    const created = call("incident-create-geo", ctx, { summary: "No geo incident", kind: "medical", priority: 2, location: "Main St" });
    assert.equal(created.ok, true);
    const id = created.result.incident.id;
    const tl = call("incident-timeline", ctx, { incidentId: id });
    assert.equal(tl.ok, true);
    const nr = call("nearest-unit", ctx, { incidentId: id });
    assert.equal(nr.ok, true);
    assert.equal(nr.result.noPosition, true);
    assert.deepEqual(nr.result.ranked, []);
    assert.equal(nr.result.recommended, null);
  });

  it("a positioned incident still ranks a positioned available unit", () => {
    const unit = call("unit-add", ctx, { name: "Amb 1", kind: "ambulance", station: "Central" });
    assert.equal(unit.ok, true);
    const placed = call("unit-update", ctx, { id: unit.result.unit.id, lat: 41.7, lng: -73.93 });
    assert.equal(placed.ok, true);
    const created = call("incident-create-geo", ctx, { summary: "Geo incident", kind: "medical", priority: 1, location: "HQ", lat: 41.71, lng: -73.94 });
    assert.equal(created.ok, true);
    const nr = call("nearest-unit", ctx, { incidentId: created.result.incident.id });
    assert.equal(nr.ok, true);
    assert.equal(nr.result.noPosition, undefined);
    assert.equal(nr.result.ranked.length, 1);
    assert.equal(nr.result.recommended.name, "Amb 1");
  });

  it("an unknown incident still refuses", () => {
    const nr = call("nearest-unit", ctx, { incidentId: "inc_missing" });
    assert.equal(nr.ok, false);
    assert.match(nr.error, /not found/);
  });
});
