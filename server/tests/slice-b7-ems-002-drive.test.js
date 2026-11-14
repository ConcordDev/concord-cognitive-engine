import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEms from "../domains/emergencyservices.js";
const ACTIONS = new Map();
function register(d, n, fn) { ACTIONS.set(`${d}.${n}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`emergency-services.${name}`);
  assert.ok(fn, `emergency-services.${name} missing`);
  return await fn(ctx, { id: null, domain: "emergency-services", type: "domain_action", data: params, meta: {} }, params);
}
before(() => registerEms(register));
beforeEach(() => { globalThis._concordSTATE = {}; });
const u1 = { actor: { userId: "u1" } };
describe("FIX-emergency-services-002 drive — incident-delete", () => {
  it("deletes a plain incident; refuses while a unit works it; deletes after stand-down", async () => {
    const a = await call("incident-create", u1, { summary: "qa incident a", kind: "medical", priority: 2 });
    assert.equal(a.ok, true);
    const idA = a.result.incident.id;
    const del1 = await call("incident-delete", u1, { id: idA });
    assert.equal(del1.ok, true);
    let list = await call("incident-list", u1, {});
    assert.equal(list.result.incidents.length, 0);

    const b = await call("incident-create", u1, { summary: "qa incident b", kind: "fire", priority: 1 });
    const idB = b.result.incident.id;
    const unit = await call("unit-add", u1, { name: "Engine 9", kind: "fire_engine" });
    const d = await call("dispatch-unit", u1, { incidentId: idB, unitId: unit.result.unit.id });
    assert.equal(d.ok, true);
    const refused = await call("incident-delete", u1, { id: idB });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "incident_has_active_unit");
    list = await call("incident-list", u1, {});
    assert.equal(list.result.incidents.length, 1, "the refused incident stays on the board");

    const missing = await call("incident-delete", u1, { id: "inc_nope" });
    assert.equal(missing.ok, false);
  });
});
