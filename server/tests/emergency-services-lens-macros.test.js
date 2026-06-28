// Phase-2 component-exact-shape gate for the emergency-services lens.
//
// This pins the COMPONENT↔HANDLER contract end-to-end through the REAL
// /api/lens/run dispatch path (the redundant-artifact-wrapper peeler + the
// 3-arg LENS_ACTIONS handler signature), NOT the handler in isolation. The
// component (concord-frontend/components/emergency-services/
// EmergencyServicesActionPanel.tsx) calls:
//   callMacro(action, { artifact: { data: <innerData> } })
//     → runDomain('emergency-services', action, { input: <that> })
//     → POST /api/lens/run { domain, action, input: { artifact: { data } } }
//     → rest = peelRedundantArtifactWrapper(body.input)   // peels ONE layer
//     → handler(ctx, { data: rest }, rest)                // 3-arg dispatch
// so the handler reads `artifact.data.<field>` === the inner data object.
//
// Every assertion below drives the EXACT inner-data object the component
// sends and asserts the EXACT fields the component renders from `r.result`,
// so a field-name drift in either direction (the dead-calculator class that
// silently blanked welding/hvac) fails this test instead of shipping.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

// Faithfully reproduce the /api/lens/run dispatch for a component call.
// `innerData` is exactly what the component nests under `artifact.data`.
async function dispatch(action, innerData, ctx) {
  const fn = ACTIONS.get(`emergency-services.${action}`);
  if (!fn) throw new Error(`emergency-services.${action} not registered`);
  // Body the component produces: { input: { artifact: { data: innerData } } }.
  const bodyInput = { artifact: { data: innerData } };
  const rest = peelRedundantArtifactWrapper(bodyInput);
  const virtualArtifact = { id: null, domain: "emergency-services", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

before(() => { registerEmergencyServicesActions(register); });
beforeEach(() => { globalThis._concordSTATE = { emergencyServicesLens: {} }; });

const ctxA = { actor: { userId: "dispatcher_a" }, userId: "dispatcher_a" };

// ── triageAssess — component sends { severity, vitals:{breathing,conscious,pulse} } ──
describe("emergency-services · triageAssess (component-exact shape)", () => {
  it("computes a real triage from the panel's exact { severity, vitals } payload", async () => {
    // Mirrors actTriage(): severity + vitals.{breathing,conscious,pulse}.
    const r = await dispatch("triageAssess", { severity: 4, vitals: { breathing: true, conscious: true, pulse: 88 } }, ctxA);
    assert.equal(r.ok, true);
    // Every field the component's <TriageResult> render reads MUST be present.
    assert.equal(typeof r.result.triageLevel, "number");      // TRIAGE_COLOR[triageLevel]
    assert.equal(typeof r.result.triageColor, "string");      // headline
    assert.equal(typeof r.result.responseTime, "string");     // "response: {responseTime}"
    assert.ok(Array.isArray(r.result.actions));               // mapped to → rows
    assert.ok(r.result.actions.length > 0);
    // Real computed value: sev 4, breathing+conscious, pulse normal → GREEN (level 4).
    assert.equal(r.result.triageLevel, 4);
    assert.match(r.result.triageColor, /GREEN/);
  });

  it("non-breathing patient is RED/level-1 with Immediate response", async () => {
    const r = await dispatch("triageAssess", { severity: 5, vitals: { breathing: false, conscious: false, pulse: 0 } }, ctxA);
    assert.equal(r.result.triageLevel, 1);
    assert.match(r.result.triageColor, /RED/);
    assert.equal(r.result.responseTime, "Immediate");
  });

  it("tachycardic/bradycardic pulse escalates to YELLOW/level-2", async () => {
    const r = await dispatch("triageAssess", { severity: 4, vitals: { breathing: true, conscious: true, pulse: 140 } }, ctxA);
    assert.equal(r.result.triageLevel, 2);
    assert.match(r.result.triageColor, /YELLOW/);
  });

  it("degrade-graceful: missing vitals defaults to a safe triage, never throws", async () => {
    const r = await dispatch("triageAssess", { severity: 3 }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.breathing, true);
    assert.equal(r.result.conscious, true);
    assert.equal(r.result.pulse, 80);
    assert.ok(Number.isFinite(r.result.triageLevel));
  });

  it("fail-CLOSED poisoned numeric: severity/pulse 'Infinity'/'1e999' collapse to safe defaults", async () => {
    const r = await dispatch("triageAssess", { severity: "Infinity", vitals: { breathing: true, conscious: true, pulse: "1e999" } }, ctxA);
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.triageLevel));
    assert.ok(Number.isFinite(r.result.pulse));
    assert.equal(r.result.pulse, 80);              // poisoned pulse → default, NOT Infinity
    assert.equal(r.result.reportedSeverity, 3);    // poisoned severity → default
  });
});

// ── dispatchOptimize — component sends parsed JSON { units, incidents } ──
describe("emergency-services · dispatchOptimize (component-exact shape)", () => {
  it("assigns nearest unit + computes ETA from the panel's parsed { units, incidents }", async () => {
    const parsed = {
      units: [
        { name: "Medic 1", status: "available", distanceKm: 2 },
        { name: "Medic 9", status: "available", distanceKm: 25 },
      ],
      incidents: [{ description: "Cardiac arrest", type: "medical", priority: 1 }],
    };
    const r = await dispatch("dispatchOptimize", parsed, ctxA);
    assert.equal(r.ok, true);
    // Fields the <DispResult> render reads.
    assert.equal(r.result.totalUnits, 2);
    assert.equal(r.result.available, 2);
    assert.equal(r.result.activeIncidents, 1);
    assert.equal(r.result.coverageGap, false);
    assert.ok(Array.isArray(r.result.assignments));
    // Assignment row fields the panel renders: priority, assignedUnit, eta.
    const a = r.result.assignments[0];
    assert.equal(a.priority, 1);
    assert.equal(a.assignedUnit, "Medic 1");        // nearest by distance
    assert.equal(a.eta, `${Math.round(2 / 50 * 60)} minutes`); // real computed ETA
  });

  it("flags a coverage gap when incidents outnumber available units", async () => {
    const r = await dispatch("dispatchOptimize", {
      units: [{ name: "Engine 1", status: "available", distanceKm: 1 }],
      incidents: [{ type: "fire", priority: 1 }, { type: "medical", priority: 2 }],
    }, ctxA);
    assert.equal(r.result.coverageGap, true);
  });

  it("degrade-graceful: empty units returns a guidance message, never crashes", async () => {
    const r = await dispatch("dispatchOptimize", { units: [], incidents: [] }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("fail-CLOSED poisoned numeric: distanceKm 'Infinity' yields a FINITE ETA, not 'Infinity minutes'", async () => {
    const r = await dispatch("dispatchOptimize", {
      units: [{ name: "Ghost", status: "available", distanceKm: "1e999" }],
      incidents: [{ type: "medical", priority: 2 }],
    }, ctxA);
    assert.equal(r.ok, true);
    const eta = r.result.assignments[0].eta;
    const etaNum = parseInt(eta, 10);
    assert.ok(Number.isFinite(etaNum), `eta must be finite, got "${eta}"`);
    assert.ok(!/Infinity/.test(eta), `eta leaked Infinity: "${eta}"`);
  });
});

// ── incidentLog — component sends parsed JSON { incidents } ──
describe("emergency-services · incidentLog (component-exact shape)", () => {
  it("rolls up 24h volume from the panel's parsed { incidents }", async () => {
    const now = Date.now();
    const parsed = {
      incidents: [
        { type: "medical", timestamp: new Date(now - 1000).toISOString(), responseMinutes: 8 },
        { type: "medical", timestamp: new Date(now - 2000).toISOString(), responseMinutes: 12 },
        { type: "fire", timestamp: new Date(now - 3000).toISOString(), responseMinutes: 10 },
      ],
    };
    const r = await dispatch("incidentLog", parsed, ctxA);
    assert.equal(r.ok, true);
    // Fields the <LogResult> render reads.
    assert.equal(r.result.total24h, 3);
    assert.equal(typeof r.result.trend, "string");
    assert.equal(r.result.avgResponseMinutes, 10);  // round((8+12+10)/3)
    assert.equal(r.result.mostCommon, "medical");   // 2 vs 1
    assert.ok(r.result.byType && typeof r.result.byType === "object");
    assert.equal(r.result.byType.medical, 2);
  });

  it("degrade-graceful: empty incident list returns zeroed rollup", async () => {
    const r = await dispatch("incidentLog", { incidents: [] }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.total24h, 0);
    assert.equal(r.result.avgResponseMinutes, 0);
    assert.equal(r.result.mostCommon, "none");
  });

  it("fail-CLOSED poisoned numeric: responseMinutes 'Infinity' keeps avgResponseMinutes FINITE", async () => {
    const r = await dispatch("incidentLog", {
      incidents: [{ type: "medical", timestamp: new Date().toISOString(), responseMinutes: "1e999" }],
    }, ctxA);
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.avgResponseMinutes), `avg must be finite, got ${r.result.avgResponseMinutes}`);
  });
});

// ── resourceReadiness — component sends { resources:{...5 fields} } ──
describe("emergency-services · resourceReadiness (component-exact shape)", () => {
  it("computes readiness from the panel's exact { resources } payload", async () => {
    const r = await dispatch("resourceReadiness", {
      resources: { vehicles: 10, vehiclesReady: 9, personnel: 40, personnelOnDuty: 35, suppliesPercent: 80 },
    }, ctxA);
    assert.equal(r.ok, true);
    // Fields the <ReadyResult> render reads.
    assert.equal(r.result.vehicleReadiness, 90);    // round(9/10*100)
    assert.equal(r.result.personnelReadiness, 88);  // round(35/40*100)
    assert.equal(r.result.suppliesLevel, 80);
    // overall = round(90*.35 + 88*.35 + 80*.3) = round(31.5+30.8+24) = 86
    assert.equal(r.result.overallReadiness, 86);
    assert.equal(r.result.status, "fully-operational");
    assert.ok(Array.isArray(r.result.shortages));
    assert.equal(r.result.shortages.length, 0);
  });

  it("surfaces shortages + a critical status when resources are depleted", async () => {
    const r = await dispatch("resourceReadiness", {
      resources: { vehicles: 10, vehiclesReady: 2, personnel: 40, personnelOnDuty: 5, suppliesPercent: 20 },
    }, ctxA);
    assert.equal(r.result.status, "critical");
    assert.ok(r.result.shortages.includes("Vehicles"));
    assert.ok(r.result.shortages.includes("Personnel"));
    assert.ok(r.result.shortages.includes("Supplies"));
  });

  it("validation/degrade-graceful: zero fleet yields 0 readiness, never NaN/divide-by-zero", async () => {
    const r = await dispatch("resourceReadiness", { resources: {} }, ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.vehicleReadiness, 0);
    assert.equal(r.result.personnelReadiness, 0);
    assert.ok(Number.isFinite(r.result.overallReadiness));
  });

  it("fail-CLOSED poisoned numeric: suppliesPercent 'Infinity' keeps overallReadiness FINITE + bounded", async () => {
    const r = await dispatch("resourceReadiness", {
      resources: { vehicles: 4, vehiclesReady: 4, personnel: 4, personnelOnDuty: 4, suppliesPercent: "1e999" },
    }, ctxA);
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.suppliesLevel), `suppliesLevel leaked: ${r.result.suppliesLevel}`);
    assert.ok(Number.isFinite(r.result.overallReadiness), `overallReadiness leaked: ${r.result.overallReadiness}`);
    assert.ok(r.result.overallReadiness <= 100);
  });
});
