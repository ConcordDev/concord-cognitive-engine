// Behavioral macro tests for the defense lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surface drives,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — what killed welding + hvac).
//
// The driven channel:
//   • DefenseActionPanel.tsx → local callMacro(action, { artifact: { data } })
//       → apiHelpers.lens.runDomain('defense', action, { input }) → the
//       dispatch peels the redundant `{ artifact: { data } }` wrapper
//       (server/lib/lens-input-normalize.js) → handler reads art.data.*
//       (== params here). Drives the 3 pure calculators that render result
//       cards: threatAssessment, readinessScore, incidentResponse.
//   • usaspending-dod-contracts is sent FLAT ({ keyword, awardType, limit }) and
//       is network-bound (USAspending.gov) — its field SHAPE alignment is pinned
//       below (the component's DodAward interface was realigned from
//       placeOfPerformance/naics/psc/periodStart/periodEnd → the handler's real
//       placeOfPerformanceState/naicsCode/pscCode/startDate/endDate on
//       2026-06-28), but its live fetch is NOT exercised hermetically.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result card renders (cross-checked field-for-field against
// components/defense/DefenseActionPanel.tsx):
//   - threatAssessment: threats[]{threat,category,likelihood,impact,riskScore,
//     severity,mitigation} + critical + total + overallThreatLevel + topThreat
//   - readinessScore: personnelReadiness/equipmentReadiness/trainingCompletion/
//     supplyLevel/overallReadiness/status/gaps[]
//   - incidentResponse: incidentType/severity/responseTime/escalationLevel/
//     immediateActions[]
//   - VALIDATION-REJECTION: non-array threats / non-object threat entries are
//     tolerated (filtered), the empty case returns the honest CTA message.
//   - DEGRADE-GRACEFUL: the 3 pure calculators are stateless — they compute even
//     with STATE gone (never throw); the STATE-backed C2 macros fail-soft.
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / 1e999 / zero
//     total): no NaN/Infinity leaks into any rendered number (Number.isFinite,
//     NOT parseFloat — parseFloat("Infinity") === Infinity would slip through).
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDefenseActions from "../domains/defense.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "defense", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read art.data)
// and the C2 ops macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`defense.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "defense", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper DefenseActionPanel.callMacro builds before dispatch:
//   runDomain('defense', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. This proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerDefenseActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "cmdr_a", id: "cmdr_a" }, userId: "cmdr_a" };

/* ───────── registration: every macro the lens surfaces drive ───────── */

describe("defense lens — registration of the driven macros", () => {
  it("registers every macro the DefenseActionPanel + boards call", () => {
    const driven = [
      // DefenseActionPanel pure calculators + the contracts macro
      "threatAssessment", "readinessScore", "incidentResponse",
      "resourceAllocation", "usaspending-dod-contracts",
      // C2 STATE-backed board macros mounted by the page
      "cop-add", "cop-map", "cop-remove",
      "mission-task-add", "mission-task-update", "mission-task-delete", "mission-plan",
      "asset-upsert", "asset-delete", "asset-rollup",
      "threat-add", "threat-escalate", "threat-update", "threat-delete", "threat-board",
      "personnel-upsert", "personnel-delete", "personnel-roster",
      "supply-request", "supply-advance", "supply-delete", "supply-board",
      "comms-post", "comms-ack", "comms-delete", "comms-log",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing defense.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("defense lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a readinessScore call sent the way DefenseActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read defaults
    // (0/1/...) and emit 0% readiness — the silent-dead class. Drive it through
    // the exact double-wrap and assert the REAL inputs landed.
    const r = callViaComponent("readinessScore", ctxA, {
      personnelReady: 90, personnelTotal: 100, equipmentOperational: 45, equipmentTotal: 50,
      trainingCompletionPercent: 80, suppliesPercent: 95,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.personnelReadiness, 90, "the real 90/100 input must reach the handler (not the 0/1 default)");
    assert.equal(r.result.equipmentReadiness, 90);
  });
});

/* ───── threatAssessment: the EXACT fields the threat card renders ───── */

describe("defense lens — threatAssessment (the DefenseActionPanel threat card)", () => {
  it("returns threats[]{threat,category,likelihood,impact,riskScore,severity,mitigation} + critical/total/overallThreatLevel/topThreat with real computed values", () => {
    // The panel pastes { threats: [...] } JSON. likelihood 0.8 × impact 0.9 ×
    // 100 = 72 → critical (>=60). Sorted desc by riskScore.
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [
        { name: "Insider exfil", category: "insider", likelihood: 0.8, impact: 0.9, mitigation: "DLP + UEBA" },
        { name: "Phishing", category: "cyber", likelihood: 0.6, impact: 0.4 },
        { name: "Supply tamper", category: "supply", likelihood: 0.3, impact: 0.5 },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    // top-level fields the card header renders
    assert.equal(res.total, 3);
    assert.equal(res.critical, 1);
    assert.equal(res.overallThreatLevel, "critical");
    assert.equal(res.topThreat, "Insider exfil");
    // threats[] is the array the card maps over (slice(0,6)) — exact per-row fields
    assert.ok(Array.isArray(res.threats) && res.threats.length === 3);
    const top = res.threats[0]; // sorted desc → highest riskScore first
    assert.equal(top.threat, "Insider exfil");
    assert.equal(top.category, "insider");
    assert.equal(top.likelihood, 80); // rounded to a percent — the card shows "L 80%"
    assert.equal(top.impact, 90);     // "I 90%"
    assert.equal(top.riskScore, 72);
    assert.equal(top.severity, "critical");
    assert.equal(top.mitigation, "DLP + UEBA");
    // the default mitigation when none supplied
    const phishing = res.threats.find((t) => t.threat === "Phishing");
    assert.equal(phishing.riskScore, 24); // 0.6 × 0.4 × 100
    assert.equal(phishing.severity, "medium"); // 24 → [20,40) medium
    assert.equal(phishing.mitigation, "Develop response plan");
    const supply = res.threats.find((t) => t.threat === "Supply tamper");
    assert.equal(supply.riskScore, 15); // 0.3 × 0.5 × 100
    assert.equal(supply.severity, "low"); // <20 low
  });

  it("uses `description` as a fallback label when `name` is absent (the card's <strong> source)", () => {
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [{ description: "Unattributed drone overflight", likelihood: 0.5, impact: 0.7 }],
    });
    assert.equal(r.result.threats[0].threat, "Unattributed drone overflight");
  });

  it("VALIDATION: empty threats returns the honest add-threats CTA message (the card hides until populated)", () => {
    const r = callViaComponent("threatAssessment", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Add threats with likelihood and impact to assess.");
    assert.equal(r.result.threats, undefined);
  });

  it("VALIDATION: a non-array threats payload is tolerated → CTA message, never a crash", () => {
    const r = callViaComponent("threatAssessment", ctxA, { threats: "not-an-array" });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Add threats with likelihood and impact to assess.");
  });

  it("VALIDATION: non-object threat entries are dropped, not exploded", () => {
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [null, "junk", 42, { name: "Real threat", likelihood: 0.5, impact: 0.6 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.threats[0].threat, "Real threat");
  });
});

/* ───── readinessScore: the EXACT fields the readiness card renders ───── */

describe("defense lens — readinessScore (the DefenseActionPanel readiness card)", () => {
  it("returns personnelReadiness/equipmentReadiness/trainingCompletion/supplyLevel/overallReadiness/status/gaps with real computed values", () => {
    // P 85/100 = 85% ; E 40/50 = 80% ; T 70 ; S 90
    // overall = 85×0.3 + 80×0.3 + 70×0.2 + 90×0.2 = 81.5 → 82 → combat-ready (>=80)
    // gaps: only training (70 < 80)
    const r = callViaComponent("readinessScore", ctxA, {
      personnelReady: 85, personnelTotal: 100, equipmentOperational: 40, equipmentTotal: 50,
      trainingCompletionPercent: 70, suppliesPercent: 90,
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.personnelReadiness, 85);
    assert.equal(res.equipmentReadiness, 80);
    assert.equal(res.trainingCompletion, 70);
    assert.equal(res.supplyLevel, 90);
    assert.equal(res.overallReadiness, 82);
    assert.equal(res.status, "combat-ready");
    assert.deepEqual(res.gaps, ["Training"]);
  });

  it("status bands: not-ready / limited / operational map from overallReadiness", () => {
    // all low → 0% → not-ready, every gap listed
    const low = callViaComponent("readinessScore", ctxA, {
      personnelReady: 0, personnelTotal: 100, equipmentOperational: 0, equipmentTotal: 100,
      trainingCompletionPercent: 0, suppliesPercent: 0,
    });
    assert.equal(low.result.overallReadiness, 0);
    assert.equal(low.result.status, "not-ready");
    assert.deepEqual(low.result.gaps, ["Personnel", "Equipment", "Training", "Supplies"]);
    // mid → 50% → limited-readiness (>=40)
    const mid = callViaComponent("readinessScore", ctxA, {
      personnelReady: 50, personnelTotal: 100, equipmentOperational: 50, equipmentTotal: 100,
      trainingCompletionPercent: 50, suppliesPercent: 50,
    });
    assert.equal(mid.result.overallReadiness, 50);
    assert.equal(mid.result.status, "limited-readiness");
    // 65% → operationally-ready (>=60)
    const ops = callViaComponent("readinessScore", ctxA, {
      personnelReady: 65, personnelTotal: 100, equipmentOperational: 65, equipmentTotal: 100,
      trainingCompletionPercent: 65, suppliesPercent: 65,
    });
    assert.equal(ops.result.overallReadiness, 65);
    assert.equal(ops.result.status, "operationally-ready");
  });
});

/* ───── incidentResponse: the EXACT fields the incident card renders ───── */

describe("defense lens — incidentResponse (the DefenseActionPanel incident card)", () => {
  it("returns incidentType/severity/responseTime/escalationLevel/immediateActions with the high-severity protocol", () => {
    const r = callViaComponent("incidentResponse", ctxA, {
      type: "perimeter breach", severity: "high", location: "Sector 7G", reporter: "sentry-04",
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.incidentType, "perimeter breach");
    assert.equal(res.severity, "high");
    assert.equal(res.responseTime, "< 15 min");
    assert.equal(res.escalationLevel, "Senior officer");
    assert.ok(Array.isArray(res.immediateActions) && res.immediateActions.length >= 1);
    assert.ok(res.immediateActions.includes("Alert response team"));
  });

  it("critical severity escalates to command level with an immediate (<5 min) response", () => {
    const r = callViaComponent("incidentResponse", ctxA, { type: "active intrusion", severity: "critical" });
    assert.equal(r.result.severity, "critical");
    assert.equal(r.result.responseTime, "Immediate (< 5 min)");
    assert.equal(r.result.escalationLevel, "Command level");
    assert.ok(r.result.immediateActions.includes("Secure perimeter"));
  });

  it("an unknown severity falls back to the medium protocol (never undefined)", () => {
    const r = callViaComponent("incidentResponse", ctxA, { type: "anomaly", severity: "weird" });
    assert.equal(r.result.responseTime, "< 1 hour");
    assert.equal(r.result.escalationLevel, "Watch officer");
  });

  it("defaults incidentType to 'unspecified' when no type is supplied (the card's <strong> source)", () => {
    const r = callViaComponent("incidentResponse", ctxA, { severity: "low" });
    assert.equal(r.result.incidentType, "unspecified");
    assert.equal(r.result.responseTime, "< 4 hours");
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("defense lens — fail-closed on poisoned numeric inputs", () => {
  it("readinessScore: NaN/Infinity/zero-total/garbage inputs produce finite, clamped numbers (no NaN/Infinity leak)", () => {
    // parseFloat("Infinity") === Infinity would slip through a `parseFloat||d`
    // guard; finiteNum rejects it. personnelReady:Infinity → 0, total:0 → 1,
    // training:"Infinity" string → 0, supplies:1e999 (→Infinity) → 0.
    const r = callViaComponent("readinessScore", ctxA, {
      personnelReady: Infinity, personnelTotal: 0, equipmentOperational: NaN, equipmentTotal: "abc",
      trainingCompletionPercent: "Infinity", suppliesPercent: 1e999,
    });
    assert.equal(r.ok, true);
    for (const k of ["personnelReadiness", "equipmentReadiness", "trainingCompletion", "supplyLevel", "overallReadiness"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} = ${r.result[k]} must be finite`);
    }
    assert.equal(r.result.overallReadiness, 0);
    assert.equal(r.result.status, "not-ready");
  });

  it("readinessScore: a percent over 100 clamps so the rendered bar can't exceed 100", () => {
    const r = callViaComponent("readinessScore", ctxA, {
      personnelReady: 500, personnelTotal: 100, equipmentOperational: 1000, equipmentTotal: 100,
      trainingCompletionPercent: 9999, suppliesPercent: 9999,
    });
    assert.equal(r.result.personnelReadiness, 100);
    assert.equal(r.result.equipmentReadiness, 100);
    assert.equal(r.result.trainingCompletion, 100);
    assert.equal(r.result.supplyLevel, 100);
    assert.equal(r.result.overallReadiness, 100);
  });

  it("threatAssessment: NaN/Infinity likelihood & impact fall to finite defaults — riskScore never NaN/Infinity", () => {
    const r = callViaComponent("threatAssessment", ctxA, {
      threats: [{ name: "Poisoned", likelihood: Infinity, impact: "NaN" }],
    });
    assert.equal(r.ok, true);
    const t = r.result.threats[0];
    assert.ok(Number.isFinite(t.riskScore), `riskScore = ${t.riskScore} must be finite`);
    assert.ok(Number.isFinite(t.likelihood) && Number.isFinite(t.impact));
    // Infinity likelihood → default 0.5 → 50% ; "NaN" → default 0.5 → 50% ; 25 risk
    assert.equal(t.likelihood, 50);
    assert.equal(t.impact, 50);
    assert.equal(t.riskScore, 25);
  });

  it("resourceAllocation: an Infinity resourcesNeeded clamps so availableAfter stays finite", () => {
    const r = callViaComponent("resourceAllocation", ctxA, {
      resources: ["sqd-1", "sqd-2", "sqd-3"],
      missions: [{ name: "Hold ridge", priority: "critical", resourcesNeeded: Infinity }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.availableAfter));
    assert.ok(Number.isFinite(r.result.allocations[0].resourcesNeeded));
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators are stateless; C2 macros fail-soft ───── */

describe("defense lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the 3 pure calculators DON'T need STATE — they still compute with STATE gone (never throw)", () => {
    let r;
    assert.doesNotThrow(() => {
      r = callViaComponent("threatAssessment", ctxA, { threats: [{ name: "X", likelihood: 0.5, impact: 0.5 }] });
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.doesNotThrow(() => {
      r = callViaComponent("readinessScore", ctxA, { personnelReady: 50, personnelTotal: 100, equipmentOperational: 50, equipmentTotal: 100, trainingCompletionPercent: 50, suppliesPercent: 50 });
    });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => {
      r = callViaComponent("incidentResponse", ctxA, { type: "X", severity: "high" });
    });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => {
      r = callViaComponent("resourceAllocation", ctxA, { resources: ["a"], missions: [{ name: "m", resourcesNeeded: 1 }] });
    });
    assert.equal(r.ok, true);
  });

  it("STATE-backed C2 macros fail-soft with {ok:false, error:'STATE unavailable'} (no throw)", () => {
    const stateBacked = [
      ["cop-map", {}], ["cop-add", { kind: "asset", label: "x", lat: 0, lon: 0 }],
      ["mission-plan", {}], ["mission-task-add", { name: "x" }],
      ["asset-rollup", {}], ["asset-upsert", { designation: "x" }],
      ["threat-board", {}], ["threat-add", { name: "x" }],
      ["personnel-roster", {}], ["supply-board", {}], ["comms-log", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.equal(r.error, "STATE unavailable", `${name} error`);
    }
  });
});

/* ───── VALIDATION-REJECTION on the STATE-backed C2 macros (real rejection paths) ───── */

describe("defense lens — STATE-backed validation rejection", () => {
  it("cop-add rejects a bad kind / missing label / out-of-range lat-lon", () => {
    assert.equal(call("cop-add", ctxA, { kind: "spaceship", label: "x", lat: 0, lon: 0 }).error, "kind must be asset|threat|operation");
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "", lat: 0, lon: 0 }).error, "label required");
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "x", lat: 999, lon: 0 }).error, "lat must be -90..90");
    assert.equal(call("cop-add", ctxA, { kind: "asset", label: "x", lat: 0, lon: 999 }).error, "lon must be -180..180");
  });

  it("supply-request rejects a non-positive / non-finite quantity (fail-closed numeric)", () => {
    assert.equal(call("supply-request", ctxA, { item: "5.56mm", quantity: 0 }).error, "quantity must be > 0");
    assert.equal(call("supply-request", ctxA, { item: "5.56mm", quantity: -10 }).error, "quantity must be > 0");
    assert.equal(call("supply-request", ctxA, { item: "5.56mm", quantity: Infinity }).error, "quantity must be > 0");
    assert.equal(call("supply-request", ctxA, { item: "5.56mm", quantity: "abc" }).error, "quantity must be > 0");
    // a valid request round-trips
    const ok = call("supply-request", ctxA, { item: "5.56mm", quantity: 5000, category: "ammunition", priority: "urgent" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.request.item, "5.56mm");
    assert.equal(ok.result.request.quantity, 5000);
    assert.equal(ok.result.request.category, "ammunition");
    assert.equal(ok.result.request.priority, "urgent");
  });

  it("threat-add round-trips then threat-board ranks critical first (real STATE compute)", () => {
    call("threat-add", ctxA, { name: "Low one", severity: "low" });
    call("threat-add", ctxA, { name: "Crit one", severity: "critical" });
    const board = call("threat-board", ctxA, {});
    assert.equal(board.ok, true);
    assert.equal(board.result.total, 2);
    assert.equal(board.result.threats[0].name, "Crit one"); // critical ranks first
    assert.equal(board.result.highestSeverity, "critical");
    assert.equal(board.result.bySeverity.critical, 1);
    assert.equal(board.result.bySeverity.low, 1);
  });
});
