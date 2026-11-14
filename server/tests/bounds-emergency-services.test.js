// GB-1539 bounds enforcement — FIX-emergency-services-003 (dispatch
// priority / distance) and FIX-emergency-services-004 (incident
// summary length). The walks: priority -99 and distance 999999999 were
// accepted and produced "P-99 QA Unit → 1199999999 minutes"; a
// 300-character incident summary was accepted with no maxlength.
// Priorities outside 1–5 used to clamp silently into range; summaries
// truncated silently at 200. Both now refuse with invalid_input.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`emergency-services.${name}`);
  if (!fn) throw new Error(`emergency-services.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerEmergencyServicesActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_ems_a" }, userId: "bnd_ems_a" };

describe("emergency-services bounds (FIX-emergency-services-003/004)", () => {
  it("incident-create refuses priority -99 instead of clamping it to 1", () => {
    const r = call("incident-create", ctxA, { summary: "Structure fire", priority: -99 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /between 1 and 5/);
  });

  it("incident-create refuses priority 99", () => {
    const r = call("incident-create", ctxA, { summary: "Structure fire", priority: 99 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("a 300-character summary refuses with the title limit named", () => {
    const r = call("incident-create", ctxA, { summary: "x".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("an in-policy incident creates with its real priority", () => {
    const r = call("incident-create", ctxA, { summary: "Structure fire", priority: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.priority, 2);
    assert.equal(r.result.incident.summary, "Structure fire");
  });

  it("a refused incident writes nothing", () => {
    call("incident-create", ctxA, { summary: "x".repeat(300) });
    const list = call("incident-list", ctxA, {});
    const items = list.result?.incidents || list.result?.items || [];
    assert.equal(items.length, 0);
  });

  it("dispatchOptimize refuses a poisoned distance instead of a nonsense ETA", () => {
    const artifact = {
      id: "a1",
      data: {
        units: [{ name: "QA Unit", status: "available", distanceKm: 999999999 }],
        incidents: [{ description: "Fire", priority: 1 }],
      },
      meta: {},
    };
    const r = call("dispatchOptimize", ctxA, {}, artifact);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /distanceKm/);
  });

  it("dispatchOptimize refuses a poisoned priority", () => {
    const artifact = {
      id: "a1",
      data: {
        units: [{ name: "QA Unit", status: "available", distanceKm: 4 }],
        incidents: [{ description: "Fire", priority: -99 }],
      },
      meta: {},
    };
    const r = call("dispatchOptimize", ctxA, {}, artifact);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("dispatchOptimize still assigns sane data", () => {
    const artifact = {
      id: "a1",
      data: {
        units: [{ name: "Unit 1", status: "available", distanceKm: 5 }],
        incidents: [{ description: "Fire", priority: 2 }],
      },
      meta: {},
    };
    const r = call("dispatchOptimize", ctxA, {}, artifact);
    assert.equal(r.ok, true);
    assert.equal(r.result.assignments[0].assignedUnit, "Unit 1");
  });
});
