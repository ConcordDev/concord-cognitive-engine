// Contract tests for server/domains/emergencyservices.js — the CAD
// (computer-aided-dispatch) operational layer: incident intake with map
// pins, unit roster + positions, the live map, triage queue, nearest-unit
// dispatch, the unit status lifecycle, incident timeline, readiness
// rollup, and high-priority alerting. Pure-compute calculators too.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`emergency-services.${name}`);
  if (!fn) throw new Error(`emergency-services.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerEmergencyServicesActions(register); });

beforeEach(() => {
  // fresh per-user CAD substrate every test
  globalThis._concordSTATE = { emergencyServicesLens: {} };
});

const ctxA = { actor: { userId: "dispatcher_a" }, userId: "dispatcher_a" };

describe("emergency-services — field calculators", () => {
  it("triageAssess returns RED for a non-breathing patient", () => {
    const r = call("triageAssess", ctxA, { data: { severity: 4, vitals: { breathing: false } } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.triageLevel, 1);
    assert.match(r.result.triageColor, /RED/);
  });

  it("resourceReadiness rolls up an overall readiness score", () => {
    const r = call("resourceReadiness", ctxA, {
      data: { resources: { vehicles: 10, vehiclesReady: 9, personnel: 40, personnelOnDuty: 35, suppliesPercent: 80 } },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.overallReadiness > 0 && r.result.overallReadiness <= 100);
  });
});

describe("emergency-services — incident intake + map pins", () => {
  it("incident-create-geo persists an incident with a map position", () => {
    const r = call("incident-create-geo", ctxA, {}, {
      summary: "Structure fire, 4th & Main", kind: "fire", priority: 1, lat: 40.71, lng: -74.0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.kind, "fire");
    assert.equal(r.result.incident.lat, 40.71);
    assert.equal(r.result.incident.status, "open");
  });

  it("incident-create-geo fires an alert for a P1/P2 incident", () => {
    const r = call("incident-create-geo", ctxA, {}, { summary: "Cardiac arrest", priority: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.alert.fired, true);
    assert.equal(r.result.alert.level, "critical");
  });

  it("incident-create-geo does not fire an alert for a routine call", () => {
    const r = call("incident-create-geo", ctxA, {}, { summary: "Noise complaint", priority: 4 });
    assert.equal(r.result.alert.fired, false);
  });

  it("incident-create-geo rejects an empty summary", () => {
    const r = call("incident-create-geo", ctxA, {}, { summary: "" });
    assert.equal(r.ok, false);
  });

  it("map-state returns incident pins for geo-located open incidents", () => {
    call("incident-create-geo", ctxA, {}, { summary: "Crash", kind: "traffic", priority: 2, lat: 1, lng: 2 });
    call("incident-create-geo", ctxA, {}, { summary: "No-geo call", priority: 3 });
    const r = call("map-state", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.incidentPins.length, 1);
    assert.equal(r.result.incidentPins[0].lat, 1);
  });
});

describe("emergency-services — unit roster + positions", () => {
  it("unit-add then unit-position places a unit on the map", () => {
    const add = call("unit-add", ctxA, {}, { name: "Engine 3", kind: "fire_engine" });
    assert.equal(add.ok, true);
    const pos = call("unit-position", ctxA, {}, { id: add.result.unit.id, lat: 5, lng: 6 });
    assert.equal(pos.ok, true);
    assert.equal(pos.result.unit.lat, 5);
    const map = call("map-state", ctxA, {}, {});
    assert.equal(map.result.unitPins.length, 1);
  });

  it("unit-position rejects an unknown unit", () => {
    const r = call("unit-position", ctxA, {}, { id: "nope", lat: 1, lng: 1 });
    assert.equal(r.ok, false);
  });
});

describe("emergency-services — nearest-unit dispatch", () => {
  it("nearest-unit ranks available units by distance to an incident", () => {
    const inc = call("incident-create-geo", ctxA, {}, { summary: "Medical", priority: 2, lat: 0, lng: 0 });
    const near = call("unit-add", ctxA, {}, { name: "Medic 1" });
    const far = call("unit-add", ctxA, {}, { name: "Medic 9" });
    call("unit-position", ctxA, {}, { id: near.result.unit.id, lat: 0.01, lng: 0.01 });
    call("unit-position", ctxA, {}, { id: far.result.unit.id, lat: 1, lng: 1 });
    const r = call("nearest-unit", ctxA, {}, { incidentId: inc.result.incident.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended.name, "Medic 1");
    assert.ok(r.result.ranked[0].distanceKm < r.result.ranked[1].distanceKm);
  });

  it("nearest-unit fails when the incident has no map position", () => {
    const inc = call("incident-create-geo", ctxA, {}, { summary: "No geo", priority: 3 });
    const r = call("nearest-unit", ctxA, {}, { incidentId: inc.result.incident.id });
    assert.equal(r.ok, false);
  });
});

describe("emergency-services — dispatch + unit status lifecycle", () => {
  it("dispatch-unit assigns a unit and moves both into dispatched", () => {
    const inc = call("incident-create-geo", ctxA, {}, { summary: "Fire", priority: 1, lat: 0, lng: 0 });
    const unit = call("unit-add", ctxA, {}, { name: "Engine 1" });
    const r = call("dispatch-unit", ctxA, {}, {
      incidentId: inc.result.incident.id, unitId: unit.result.unit.id,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.unit.status, "dispatched");
    assert.equal(r.result.incident.status, "dispatched");
    assert.equal(r.result.incident.assignedUnitId, unit.result.unit.id);
  });

  it("unit-status-advance walks the legal lifecycle and resolves the incident", () => {
    const inc = call("incident-create-geo", ctxA, {}, { summary: "EMS", priority: 2, lat: 0, lng: 0 });
    const unit = call("unit-add", ctxA, {}, { name: "Medic 2" });
    call("dispatch-unit", ctxA, {}, { incidentId: inc.result.incident.id, unitId: unit.result.unit.id });
    const enRoute = call("unit-status-advance", ctxA, {}, { id: unit.result.unit.id, status: "en_route" });
    assert.equal(enRoute.ok, true);
    const onScene = call("unit-status-advance", ctxA, {}, { id: unit.result.unit.id, status: "on_scene" });
    assert.equal(onScene.result.unit.status, "on_scene");
    const clear = call("unit-status-advance", ctxA, {}, { id: unit.result.unit.id, status: "clear" });
    assert.equal(clear.ok, true);
    assert.equal(clear.result.unit.status, "available");
    assert.equal(clear.result.incident.status, "resolved");
  });

  it("unit-status-advance rejects an illegal transition", () => {
    const unit = call("unit-add", ctxA, {}, { name: "Engine 7" });
    const r = call("unit-status-advance", ctxA, {}, { id: unit.result.unit.id, status: "on_scene" });
    assert.equal(r.ok, false);
    assert.ok(Array.isArray(r.result.allowed));
  });
});

describe("emergency-services — triage queue + timeline + readiness + alerts", () => {
  it("triage-queue orders open incidents by dispatch score", () => {
    call("incident-create-geo", ctxA, {}, { summary: "Minor", priority: 5 });
    call("incident-create-geo", ctxA, {}, { summary: "Critical", priority: 1 });
    const r = call("triage-queue", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.depth, 2);
    assert.equal(r.result.topPriority.priority, 1);
  });

  it("incident-timeline returns the chronological event log for one incident", () => {
    const inc = call("incident-create-geo", ctxA, {}, { summary: "Fire", priority: 1, lat: 0, lng: 0 });
    const unit = call("unit-add", ctxA, {}, { name: "Engine 5" });
    call("dispatch-unit", ctxA, {}, { incidentId: inc.result.incident.id, unitId: unit.result.unit.id });
    const r = call("incident-timeline", ctxA, {}, { incidentId: inc.result.incident.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.eventCount >= 2);
    assert.equal(r.result.events[0].kind, "created");
  });

  it("readiness-rollup derives readiness straight from the live unit roster", () => {
    call("unit-add", ctxA, {}, { name: "U1", kind: "ambulance" });
    call("unit-add", ctxA, {}, { name: "U2", kind: "patrol", status: "out_of_service" });
    const r = call("readiness-rollup", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalUnits, 2);
    assert.equal(r.result.available, 1);
    assert.equal(r.result.outOfService, 1);
  });

  it("active-alerts surfaces open P1/P2 incidents with SLA flags", () => {
    call("incident-create-geo", ctxA, {}, { summary: "Critical", priority: 1 });
    call("incident-create-geo", ctxA, {}, { summary: "Routine", priority: 4 });
    const r = call("active-alerts", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.critical, 1);
  });

  it("CAD substrate is per-user — dispatcher B never sees dispatcher A's incidents", () => {
    call("incident-create-geo", ctxA, {}, { summary: "A's call", priority: 2 });
    const ctxB = { actor: { userId: "dispatcher_b" }, userId: "dispatcher_b" };
    const r = call("triage-queue", ctxB, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.depth, 0);
  });
});
