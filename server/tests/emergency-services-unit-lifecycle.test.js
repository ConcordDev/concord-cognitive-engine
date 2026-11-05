// Emergency-services roster lifecycle (S2) — behaviour tests for the
// split the first pass priced (cross-check #71(b)):
//   · the STATUS path is a surfacing — unit-status-advance stood
//     registered but unrostered; these tests pin the full legal flow,
//     including the non-dispatch path the slice requires (a unit can
//     be taken out of service and returned without being dispatched);
//   · EDIT and DELETE were absent at registry — unit-update and
//     unit-delete are the builds, pinned here end-to-end.
//
// All fixtures are synthetic and local to this harness (a fresh STATE
// per test); no incident is created and no dispatch is performed —
// unit-status-advance is exercised as the pure state machine it is,
// on roster records this suite itself creates.

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
const ctxB = { actor: { userId: "dispatcher_b" }, userId: "dispatcher_b" };

async function addUnit(ctx, name = "Engine 3") {
  const r = await run("unit-add", { name, kind: "fire_engine", station: "ST-1" }, ctx);
  assert.equal(r.ok, true);
  return r.result.unit;
}

describe("emergency-services · unit-update (the edit build)", () => {
  it("corrects call-sign, kind and station, and sets a map position", async () => {
    const unit = await addUnit(ctxA, "Engin 3"); // the mistyped call-sign of record
    const r = await run("unit-update", { id: unit.id, name: "Engine 3", kind: "ladder", station: "ST-9", lat: 41.7, lng: -73.9 }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.unit.name, "Engine 3");
    assert.equal(r.result.unit.kind, "ladder");
    assert.equal(r.result.unit.station, "ST-9");
    assert.equal(r.result.unit.lat, 41.7);
    assert.equal(r.result.unit.lng, -73.9);
    const list = await run("unit-list", {}, ctxA);
    assert.equal(list.result.units[0].name, "Engine 3");
    assert.equal(list.result.units[0].lat, 41.7);
  });

  it("clears the map position on an explicit null pair", async () => {
    const unit = await addUnit(ctxA);
    await run("unit-position", { id: unit.id, lat: 41.7, lng: -73.9 }, ctxA);
    const r = await run("unit-update", { id: unit.id, lat: null, lng: null }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.unit.lat, undefined);
    assert.equal(r.result.unit.lng, undefined);
  });

  it("refuses an unknown kind and an empty call-sign instead of coercing silently", async () => {
    const unit = await addUnit(ctxA);
    const badKind = await run("unit-update", { id: unit.id, kind: "hovercraft" }, ctxA);
    assert.equal(badKind.ok, false);
    assert.equal(badKind.error, "unknown unit kind");
    const badName = await run("unit-update", { id: unit.id, name: "   " }, ctxA);
    assert.equal(badName.ok, false);
    assert.equal(badName.error, "unit name required");
    const list = await run("unit-list", {}, ctxA);
    assert.equal(list.result.units[0].kind, "fire_engine"); // unchanged by either refusal
  });

  it("answers unit not found for an unknown id and for another user's unit", async () => {
    const unit = await addUnit(ctxA);
    const missing = await run("unit-update", { id: "unit_nope", name: "X" }, ctxA);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "unit not found");
    const foreign = await run("unit-update", { id: unit.id, name: "Hijacked" }, ctxB);
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error, "unit not found");
  });
});

describe("emergency-services · unit-delete (the delete build)", () => {
  it("removes an available unit from the roster permanently", async () => {
    const unit = await addUnit(ctxA);
    const r = await run("unit-delete", { id: unit.id }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, true);
    assert.equal(r.result.unit.name, "Engine 3");
    const list = await run("unit-list", {}, ctxA);
    assert.equal(list.result.count, 0);
  });

  it("removes an out-of-service unit (the retired-unit exit)", async () => {
    const unit = await addUnit(ctxA);
    await run("unit-status-advance", { id: unit.id, status: "out_of_service" }, ctxA);
    const r = await run("unit-delete", { id: unit.id }, ctxA);
    assert.equal(r.ok, true);
    const list = await run("unit-list", {}, ctxA);
    assert.equal(list.result.count, 0);
  });

  it("refuses to delete a unit committed to an incident, with its reason", async () => {
    const unit = await addUnit(ctxA);
    // Pure state-machine move on a synthetic record: the unit is now in
    // the committed half of the flow, as dispatch-unit would leave it.
    await run("unit-status-advance", { id: unit.id, status: "dispatched" }, ctxA);
    const r = await run("unit-delete", { id: unit.id }, ctxA);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unit_is_assigned");
    const list = await run("unit-list", {}, ctxA);
    assert.equal(list.result.count, 1); // the record survives the refusal
  });

  it("answers unit not found for an unknown id", async () => {
    const r = await run("unit-delete", { id: "unit_nope" }, ctxA);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unit not found");
  });
});

describe("emergency-services · the status path, surfaced whole", () => {
  it("takes a unit out of service and back without any dispatch", async () => {
    const unit = await addUnit(ctxA);
    const out = await run("unit-status-advance", { id: unit.id, status: "out_of_service" }, ctxA);
    assert.equal(out.ok, true);
    assert.equal(out.result.unit.status, "out_of_service");
    const back = await run("unit-status-advance", { id: unit.id, status: "available" }, ctxA);
    assert.equal(back.ok, true);
    assert.equal(back.result.unit.status, "available");
  });

  it("refuses an illegal transition and reports the legal set", async () => {
    const unit = await addUnit(ctxA);
    const r = await run("unit-status-advance", { id: unit.id, status: "on_scene" }, ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /illegal transition available→on_scene/);
    assert.deepEqual(r.result.allowed, ["dispatched", "out_of_service"]);
  });

  it("unit-list carries the server's legal next set per unit", async () => {
    const a = await addUnit(ctxA, "Engine 3");
    await addUnit(ctxA, "Medic 1");
    await run("unit-status-advance", { id: a.id, status: "out_of_service" }, ctxA);
    const list = await run("unit-list", {}, ctxA);
    const byName = Object.fromEntries(list.result.units.map((u) => [u.name, u.allowedNext]));
    assert.deepEqual(byName["Engine 3"], ["available"]);
    assert.deepEqual(byName["Medic 1"], ["dispatched", "out_of_service"]);
  });
});
