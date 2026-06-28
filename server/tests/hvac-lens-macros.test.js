// Behavioral macro tests for the hvac lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — exactly what had silently killed the
// ENTIRE ManualJCalc surface here before the 2026-06-28 alignment fix).
//
// One real channel:
//   • ManualJCalc.tsx → apiHelpers.lens.runDomain('hvac', action,
//       { input: { artifact: { data } } })  → dispatch peels the redundant
//       artifact wrapper → handler reads art.data.* (== params here).
//       Drives the 4 pure calculators: loadCalculation, energyAudit,
//       maintenanceSchedule, zoneBalance.
//   (The ServiceTitan field-service ops + round-trips are pinned by
//    hvac-domain-parity.test.js — NOT duplicated here.)
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// components/hvac/ManualJCalc.tsx after the 2026-06-28 alignment fix):
//   - loadCalculation: heatingBTU / coolingBTU / tonnageRecommended /
//     equipmentSize / recommendation / squareFootage
//     (was DEAD: card read heatingBTU/coolingBTU/tonnageRecommended/
//     equipmentSize/recommendation — handler returned only requiredBTU/tonnage/
//     unitSize/estimatedCost/energyEstimate/seerRecommendation → every load
//     card was blank but the shape test passed)
//   - energyAudit: annualCost / costPerSqFt / estimatedAnnualSavings /
//     systemEfficiency / expectedLifespan / savingsOpportunities[] / roiScore /
//     recommendation  (was DEAD: card read estimatedAnnualSavings/
//     systemEfficiency/expectedLifespan/savingsOpportunities/roiScore — handler
//     returned potentialAnnualSavings/efficiencyLoss/issues/grade)
//   - maintenanceSchedule: tasks[].nextDue / systemType / overdueCount /
//     lastServiceDate / recommendation  (was DEAD: card read overdueCount/
//     lastServiceDate/recommendation/tasks[].nextDue — handler returned
//     overdue(bool)/lastService/nextServiceDue)
//   - zoneBalance: zones[].{zone,current,target,deviation} / maxDeviation /
//     avgDeviation / verdict / balanceScore / recommendation  (was DEAD: card
//     read verdict/balanceScore/recommendation — handler returned balanced(bool)/
//     worstZone/recommendations[])
//   - VALIDATION-REJECTION: zoneBalance with no zones returns the empty-shape
//     verdict, never a crash.
//   - DEGRADE-GRACEFUL: the 4 calculators are stateless pure compute — they
//     compute even with STATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / "12abc"):
//     coercion is Number()+Number.isFinite (NOT parseFloat) so no NaN/Infinity
//     leaks into any rendered number, no crash, and a "12abc" prefix is REJECTED
//     to the default rather than silently accepted as 12.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHVACActions from "../domains/hvac.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "hvac", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So the calculators (read art.data) see
// the peeled input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`hvac.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "hvac", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper ManualJCalc.callHvac builds before dispatch:
//   runDomain('hvac', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double-wrap
// the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerHVACActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "hvac_a", id: "hvac_a" }, userId: "hvac_a" };

// Helper: every numeric the component renders must be a real finite number
// (no NaN/Infinity leak). Strings are exempt; we scan only number-typed leaves.
function assertNoNonFiniteNumbers(obj, path = "result") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} leaked a non-finite number: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const [k, v] of Object.entries(obj)) assertNoNonFiniteNumbers(v, `${path}.${k}`); }
}

/* ───────── registration: every macro the lens channels drive ───────── */

describe("hvac lens — registration of the driven calculators", () => {
  it("registers every macro ManualJCalc drives", () => {
    for (const m of ["loadCalculation", "energyAudit", "maintenanceSchedule", "zoneBalance"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing hvac.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("hvac lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a loadCalculation call sent the way ManualJCalc sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read defaults
    // (1000 sqft) and emit the wrong numbers — the silent-dead class. Drive the
    // exact double-wrap and assert the REAL input (1800 sqft) landed.
    const r = callViaComponent("loadCalculation", ctxA, { squareFootage: 1800, stories: 1, insulation: "average", climate: "temperate" });
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 1800, "the 1800 sqft input must reach the handler (not the 1000 default)");
  });
});

/* ───────────────────── loadCalculation ───────────────────── */

describe("hvac.loadCalculation — EXACT fields LoadCalculator renders", () => {
  it("renders heatingBTU / coolingBTU / tonnageRecommended / equipmentSize / recommendation with real computed values", () => {
    // ManualJCalc.LoadCalculator sends { squareFootage, stories, insulation, climate }.
    const r = callViaComponent("loadCalculation", ctxA, { squareFootage: 2000, stories: 2, insulation: "good", climate: "hot-humid" });
    assert.equal(r.ok, true);
    const x = r.result;
    // EXACT rendered fields (component reads result.heatingBTU?.toLocaleString(),
    // result.coolingBTU, result.tonnageRecommended, result.equipmentSize, result.recommendation):
    assert.equal(typeof x.heatingBTU, "number");
    assert.equal(typeof x.coolingBTU, "number");
    assert.equal(typeof x.tonnageRecommended, "string");
    assert.equal(typeof x.equipmentSize, "string");
    assert.equal(typeof x.recommendation, "string");
    assert.equal(typeof x.squareFootage, "number");
    // real math: base 2000*25 = 50000; good insulation 0.9; hot-humid 1.25; 2-story 1.1
    // cooling = round(50000 * 0.9 * 1.25 * 1.1) = 61875
    assert.equal(x.coolingBTU, 61875, "cooling BTU is the computed Manual-J load");
    assert.equal(x.requiredBTU, 61875);
    assert.equal(x.heatingBTU, Math.round(61875 * 0.85)); // not a cold climate
    assert.equal(x.tonnage, Math.round(61875 / 12000 * 10) / 10);
    assert.equal(x.tonnageRecommended, `${x.tonnage} ton`);
    assert.equal(x.equipmentSize, `${Math.ceil(x.tonnage * 2) / 2} ton system`);
    assertNoNonFiniteNumbers(x);
  });

  it("cold climate biases heating above cooling and the recommendation reflects it", () => {
    const r = callViaComponent("loadCalculation", ctxA, { squareFootage: 1500, stories: 1, insulation: "average", climate: "very-cold" });
    assert.equal(r.ok, true);
    // very-cold multiplier 1.35; base 1500*25=37500; avg 1.0 → cooling 50625
    assert.equal(r.result.coolingBTU, 50625);
    assert.ok(r.result.heatingBTU > r.result.coolingBTU, "cold climate heats harder than it cools");
    assert.match(r.result.recommendation, /[Cc]old/);
  });
});

/* ───────────────────── energyAudit ───────────────────── */

describe("hvac.energyAudit — EXACT fields EnergyAudit renders", () => {
  it("renders annualCost / costPerSqFt / estimatedAnnualSavings / systemEfficiency / expectedLifespan / savingsOpportunities / roiScore / recommendation", () => {
    const r = callViaComponent("energyAudit", ctxA, { monthlyBill: 300, squareFootage: 1500, systemAge: 12 });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.annualCost, "number");
    assert.equal(typeof x.costPerSqFt, "number");
    assert.equal(typeof x.estimatedAnnualSavings, "number");
    assert.equal(typeof x.systemEfficiency, "string");
    assert.equal(typeof x.expectedLifespan, "string");
    assert.ok(Array.isArray(x.savingsOpportunities), "savingsOpportunities is the array the <ul> maps");
    assert.equal(typeof x.roiScore, "number");
    assert.equal(typeof x.recommendation, "string");
    assert.equal(typeof x.monthlyBill, "number");
    // real math: annual 300*12 = 3600; cost/sqft round(3600/1500,2)=2.4; loss min(50,12*2)=24%
    assert.equal(x.annualCost, 3600);
    assert.equal(x.costPerSqFt, 2.4);
    assert.equal(x.estimatedAnnualSavings, Math.round(300 * 24 / 100) * 12);
    assert.equal(x.roiScore, Math.min(100, 24 * 2));
    assert.ok(x.savingsOpportunities.length > 0);
    assertNoNonFiniteNumbers(x);
  });

  it("a clean efficient system still produces a non-empty opportunities list (no blank <ul>)", () => {
    const r = callViaComponent("energyAudit", ctxA, { monthlyBill: 90, squareFootage: 1800, systemAge: 3 });
    assert.equal(r.ok, true);
    assert.ok(r.result.savingsOpportunities.length > 0, "list is never empty so the card never renders a bare header");
    assert.ok(["A", "B", "C", "D"].includes(r.result.grade));
  });
});

/* ───────────────────── maintenanceSchedule ───────────────────── */

describe("hvac.maintenanceSchedule — EXACT fields MaintenanceCalendar renders", () => {
  it("renders tasks[].nextDue / systemType / overdueCount / lastServiceDate / recommendation", () => {
    const r = callViaComponent("maintenanceSchedule", ctxA, { systemType: "heat-pump", lastServiceDate: "2020-01-01" });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(x.systemType, "heat-pump");
    assert.equal(typeof x.overdueCount, "number");
    assert.equal(typeof x.lastServiceDate, "string");
    assert.equal(x.lastServiceDate, "2020-01-01");
    assert.equal(typeof x.recommendation, "string");
    assert.ok(Array.isArray(x.tasks) && x.tasks.length > 0);
    for (const t of x.tasks) {
      assert.equal(typeof t.task, "string");
      assert.equal(typeof t.frequency, "string");
      assert.equal(typeof t.priority, "string");
      assert.equal(typeof t.diy, "boolean");
      assert.equal(typeof t.nextDue, "string", "every task carries the nextDue the card renders");
    }
    // a 2020 service is years overdue → all annual-or-faster tasks overdue
    assert.ok(x.overdueCount > 0, "stale service date flags overdue tasks");
    assertNoNonFiniteNumbers(x);
  });

  it("an empty/absent service date renders lastServiceDate=null and a 'due now' nextDue (no crash on bad date)", () => {
    const r = callViaComponent("maintenanceSchedule", ctxA, { systemType: "furnace", lastServiceDate: "" });
    assert.equal(r.ok, true);
    assert.equal(r.result.lastServiceDate, null);
    assert.ok(r.result.tasks.every((t) => typeof t.nextDue === "string"));
    assert.ok(r.result.overdueCount > 0);
  });
});

/* ───────────────────── zoneBalance ───────────────────── */

describe("hvac.zoneBalance — EXACT fields ZoneBalanceMonitor renders", () => {
  it("renders zones[].{zone,current,target,deviation} / maxDeviation / avgDeviation / verdict / balanceScore / recommendation", () => {
    // ManualJCalc sends zones: [{ name, currentTemp:number, targetTemp:number }]
    const r = callViaComponent("zoneBalance", ctxA, { zones: [
      { name: "Living room", currentTemp: 75, targetTemp: 72 },
      { name: "Bedroom", currentTemp: 68, targetTemp: 72 },
    ] });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.ok(Array.isArray(x.zones) && x.zones.length === 2);
    for (const z of x.zones) {
      assert.equal(typeof z.zone, "string");
      assert.equal(typeof z.current, "number");
      assert.equal(typeof z.target, "number");
      assert.equal(typeof z.deviation, "number");
    }
    assert.equal(typeof x.maxDeviation, "number");
    assert.equal(typeof x.avgDeviation, "number");
    assert.equal(typeof x.verdict, "string");
    assert.equal(typeof x.balanceScore, "number");
    assert.equal(typeof x.recommendation, "string");
    // real math: deviations 3 and 4 → max 4, avg 3.5; verdict "minor imbalance"; score 100-40=60
    assert.equal(x.maxDeviation, 4);
    assert.equal(x.avgDeviation, 3.5);
    assert.equal(x.verdict, "minor imbalance");
    assert.equal(x.balanceScore, 60);
    assert.equal(x.recommendation, "Adjust dampers");
    assertNoNonFiniteNumbers(x);
  });

  it("VALIDATION: no zones → empty-shape verdict the card can still render, never a crash", () => {
    const r = callViaComponent("zoneBalance", ctxA, { zones: [] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.zones, []);
    assert.equal(r.result.verdict, "no zones");
    assert.equal(r.result.balanceScore, 100);
    assert.equal(typeof r.result.recommendation, "string");
    assertNoNonFiniteNumbers(r.result);
  });

  it("a well-balanced set reads verdict 'balanced' with the top score", () => {
    const r = callViaComponent("zoneBalance", ctxA, { zones: [
      { name: "A", currentTemp: 72, targetTemp: 72 },
      { name: "B", currentTemp: 72.5, targetTemp: 72 },
    ] });
    assert.equal(r.result.verdict, "balanced");
    assert.ok(r.result.balanceScore >= 90);
  });
});

/* ───────── DEGRADE-GRACEFUL: pure compute survives STATE loss ───────── */

describe("hvac lens — degrade-graceful (stateless calculators never throw)", () => {
  it("loadCalculation / energyAudit / maintenanceSchedule / zoneBalance compute with STATE gone", () => {
    globalThis._concordSTATE = undefined;
    for (const [name, data] of [
      ["loadCalculation", { squareFootage: 1200, climate: "cold" }],
      ["energyAudit", { monthlyBill: 150, squareFootage: 1200, systemAge: 8 }],
      ["maintenanceSchedule", { systemType: "boiler" }],
      ["zoneBalance", { zones: [{ name: "Den", currentTemp: 70, targetTemp: 72 }] }],
    ]) {
      const r = callViaComponent(name, ctxA, data);
      assert.equal(r.ok, true, `${name} must degrade-graceful with no STATE`);
      assertNoNonFiniteNumbers(r.result);
    }
  });
});

/* ───────── FAIL-CLOSED: poisoned numerics never leak NaN/Infinity ───────── */

describe("hvac lens — fail-CLOSED on poisoned numerics (Number.isFinite, not parseFloat)", () => {
  it("loadCalculation: 'Infinity' / 'NaN' / '12abc' fall to defaults — no non-finite leak, prefix NOT silently accepted", () => {
    const r = callViaComponent("loadCalculation", ctxA, { squareFootage: "Infinity", stories: "NaN", insulation: "poor", climate: "made-up" });
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 1000, "'Infinity' string rejected → 1000 default (parseFloat would have yielded Infinity)");
    assertNoNonFiniteNumbers(r.result);
    // "12abc" must NOT be coerced to 12 (parseFloat hazard) — Number("12abc")=NaN → default.
    const r2 = callViaComponent("loadCalculation", ctxA, { squareFootage: "12abc" });
    assert.equal(r2.result.squareFootage, 1000, "'12abc' rejected to default, not accepted as 12");
    assertNoNonFiniteNumbers(r2.result);
  });

  it("energyAudit: poisoned bill/sqft/age never produce NaN annualCost or costPerSqFt", () => {
    const r = callViaComponent("energyAudit", ctxA, { monthlyBill: "abc", squareFootage: "Infinity", systemAge: "NaN" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.annualCost));
    assert.ok(Number.isFinite(r.result.costPerSqFt));
    assert.ok(Number.isFinite(r.result.roiScore));
    assertNoNonFiniteNumbers(r.result);
  });

  it("zoneBalance: poisoned temps fall to 72°F default — deviations stay finite", () => {
    const r = callViaComponent("zoneBalance", ctxA, { zones: [
      { name: "X", currentTemp: "Infinity", targetTemp: "NaN" },
      { name: "Y", currentTemp: "abc", targetTemp: 72 },
    ] });
    assert.equal(r.ok, true);
    for (const z of r.result.zones) {
      assert.ok(Number.isFinite(z.current));
      assert.ok(Number.isFinite(z.target));
      assert.ok(Number.isFinite(z.deviation));
    }
    assertNoNonFiniteNumbers(r.result);
  });

  it("maintenanceSchedule: a garbage lastServiceDate degrades to null, never NaN daysSinceService", () => {
    const r = callViaComponent("maintenanceSchedule", ctxA, { systemType: "central-ac", lastServiceDate: "not-a-date" });
    assert.equal(r.ok, true);
    assert.equal(r.result.lastServiceDate, null);
    assert.ok(Number.isFinite(r.result.daysSinceService));
    assertNoNonFiniteNumbers(r.result);
  });
});
