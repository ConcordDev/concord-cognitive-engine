// FIX-emergency-services-009 — UNIT_STATUS_FLOW had no dispatched →
// out_of_service transition: a dispatched unit that broke down had to bounce
// through en_route or available first. Pin: the transition is legal, it
// unassigns the unit from its incident, and unit-list's allowedNext carries it.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function run(action, params, ctx) {
  const fn = ACTIONS.get(`emergency-services.${action}`);
  if (!fn) throw new Error(`emergency-services.${action} not registered`);
  return fn(ctx, {}, params || {});
}

before(() => { registerEmergencyServicesActions(register); });
beforeEach(() => { globalThis._concordSTATE = { emergencyServicesLens: {} }; });

const ctxA = { actor: { userId: "dispatcher_a" }, userId: "dispatcher_a" };

describe("FIX-emergency-services-009 — dispatched → out of service", () => {
  it("is a legal transition and unassigns the unit", async () => {
    const add = await run("unit-add", { name: "Engine 9", kind: "fire_engine", station: "ST-1" }, ctxA);
    const unit = add.result.unit;
    const d = await run("unit-status-advance", { id: unit.id, status: "dispatched" }, ctxA);
    assert.equal(d.ok, true);
    const oos = await run("unit-status-advance", { id: unit.id, status: "out_of_service" }, ctxA);
    assert.equal(oos.ok, true, JSON.stringify(oos));
    assert.equal(oos.result.unit.status, "out_of_service");
    assert.equal(oos.result.unit.assignedIncidentId, null);
    const back = await run("unit-status-advance", { id: unit.id, status: "available" }, ctxA);
    assert.equal(back.ok, true);
  });
  it("unit-list allowedNext offers out_of_service from dispatched", async () => {
    const add = await run("unit-add", { name: "Engine 10", kind: "fire_engine", station: "ST-1" }, ctxA);
    await run("unit-status-advance", { id: add.result.unit.id, status: "dispatched" }, ctxA);
    const list = await run("unit-list", {}, ctxA);
    const u = list.result.units.find((x) => x.id === add.result.unit.id);
    assert.ok(u.allowedNext.includes("out_of_service"), JSON.stringify(u.allowedNext));
  });
});
