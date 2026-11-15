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
describe("FIX-emergency-services-001 drive — unit-delete contract", () => {
  it("a dispatched unit is refused with unit_is_assigned; an available unit deletes", async () => {
    const a = await call("unit-add", u1, { name: "qa-unit-b", kind: "ambulance" });
    assert.equal(a.ok, true);
    const idB = a.result.unit.id;
    const inc = await call("incident-create", u1, { summary: "medical", kind: "medical", priority: 2 });
    assert.equal(inc.ok, true);
    const d = await call("dispatch-unit", u1, { incidentId: inc.result.incident.id, unitId: idB });
    assert.equal(d.ok, true);
    const refused = await call("unit-delete", u1, { id: idB });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "unit_is_assigned");
    let list = await call("unit-list", u1, {});
    assert.equal(list.result.units.length, 1, "the refused unit stays on the roster");

    const b = await call("unit-add", u1, { name: "qa-unit-c", kind: "engine" });
    const idC = b.result.unit.id;
    const gone = await call("unit-delete", u1, { id: idC });
    assert.equal(gone.ok, true);
    list = await call("unit-list", u1, {});
    assert.deepEqual(list.result.units.map((u) => u.id), [idB]);
  });
});
