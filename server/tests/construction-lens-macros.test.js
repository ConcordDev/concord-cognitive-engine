// Behavioral macro tests for server/domains/construction.js — the four GC-bench
// CALCULATORS the /lenses/construction ConstructionActionPanel drives:
// takeoffEstimate (material takeoff + cost roll-up), criticalPath (CPM
// forward/backward pass), safetyCompliance (OSHA TRIR formula), progressReport
// (plan-vs-actual variance). The field-management workflow macros (RFI,
// submittals, punch, change orders, drawings, budget, gantt) already carry a
// behavioral contract in construction-domain-parity.test.js — this file does
// NOT duplicate them; it owns the calculators + the double-wrap regression +
// fail-closed/degrade-graceful coverage they previously lacked.
//
// This mirrors the REAL LENS_ACTIONS dispatch (server.js:39150/39283):
// registerLensAction(domain, action, handler) handlers are invoked as
// `handler(ctx, virtualArtifact, input)` (3-ARG), with virtualArtifact.data ===
// the unwrapped `rest` (= body.input when input is an object). The harness
// reproduces that exactly so a param-position regression surfaces here.
//
// REGRESSION PINNED (double-wrapped-input dead calculator): the GC bench panel
// posts `{ input: { artifact: { data } } }`; the dispatcher sets
// virtualArtifact.data = { artifact: { data } }, a redundant layer that
// silently stranded every calculator on its "Add line items…" empty default
// (the carpentry-sibling dead-calculator class). calcData() now peels exactly
// one such layer, so the panel's paste-JSON path computes. We assert BOTH the
// single-wrap (test/lensRun) AND double-wrap (panel) paths reach identical
// computed values — no fabricated numbers, every expected value hand-derived
// from the documented formula.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerConstructionActions from "../domains/construction.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "construction", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live single-wrap dispatch: virtualArtifact.data === input.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`construction.${name} not registered`);
  const virtualArtifact = { id: null, domain: "construction", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}
// Mirror the DOUBLE-WRAP dispatch the ConstructionActionPanel produces:
// callMacro(action, { artifact: { data } }) → runDomain spreads input →
// body.input = { artifact: { data } } → virtualArtifact.data = body.input.
function callPanel(name, ctx, data = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`construction.${name} not registered`);
  const rest = { artifact: { data } };
  const virtualArtifact = { id: null, domain: "construction", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

before(() => { registerConstructionActions(registerLensAction); });

const ctx = { actor: { userId: "user_calc" } };

describe("construction — registration (every calculator the GC bench drives)", () => {
  it("registers takeoffEstimate / criticalPath / safetyCompliance / progressReport / ganttSchedule", () => {
    for (const m of ["takeoffEstimate", "criticalPath", "safetyCompliance", "progressReport", "ganttSchedule"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing construction.${m}`);
    }
  });
});

// =========================================================================
// takeoffEstimate — material takeoff + waste + labor/overhead/profit roll-up
// =========================================================================
describe("construction — takeoffEstimate (material takeoff + cost estimate)", () => {
  // Hand-derived from the documented formula:
  //   Concrete: 100 cy × (1 + 10/100) = 110.0000000001 (IEEE-754) → Math.ceil 111
  //              adjQty for ORDERING; lineCost = round(110.0000… × 150) = 16500
  //   Rebar:     50 ea × (1 +  5/100) =  52.5 → Math.ceil 53 adjQty;
  //              lineCost = round(52.5 × 80) = 4200   (lineCost uses raw adjusted)
  //   subtotalMaterials = 16500 + 4200 = 20700
  //   laborCost  = 20700 × 0.40            = 8280
  //   overhead   = (20700 + 8280) × 0.15   = 4347
  //   profit     = (20700 + 8280 + 4347) × 0.10 = 3332.7
  //   grandTotal = 20700 + 8280 + 4347 + 3332.7 = 36659.70
  //   costPerSqFt = 36659.70 / 2000 = 18.3299 → round 18.33
  const input = {
    lineItems: [
      { description: "Concrete", quantity: 100, unit: "cy", unitCost: 150, wastePercent: 10 },
      { description: "Rebar", quantity: 50, unit: "ea", unitCost: 80, wastePercent: 5 },
    ],
    laborPercent: 40,
    squareFootage: 2000,
  };

  it("computes the documented takeoff + cost roll-up (single-wrap path)", () => {
    const r = call("takeoffEstimate", ctx, input);
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.lineItems[0].adjustedQuantity, 111, "Math.ceil of FP-inflated 110.0000…1 rounds up for ordering");
    assert.equal(res.lineItems[0].lineCost, 16500);
    assert.equal(res.lineItems[1].adjustedQuantity, 53, "52.5 rounds UP for ordering");
    assert.equal(res.lineItems[1].lineCost, 4200);
    assert.equal(res.subtotalMaterials, 20700);
    assert.equal(res.laborCost, 8280);
    assert.equal(res.overhead, 4347);
    assert.equal(res.profit, 3332.7);
    assert.equal(res.grandTotal, 36659.7);
    assert.equal(res.costPerSqFt, 18.33);
  });

  it("double-wrap (GC-bench panel) path reaches the IDENTICAL grand total — dead-calculator regression", () => {
    const single = call("takeoffEstimate", ctx, input).result;
    const dbl = callPanel("takeoffEstimate", ctx, input).result;
    assert.ok(dbl.lineItems && dbl.lineItems.length === 2, "panel path is NOT stranded on the empty default");
    assert.equal(dbl.grandTotal, single.grandTotal, "panel computes the same number as a direct call");
    assert.equal(dbl.grandTotal, 36659.7);
  });

  it("empty line items degrade graceful (guidance message, no throw)", () => {
    const r = call("takeoffEstimate", ctx, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add line items/);
  });

  it("zero square footage yields null costPerSqFt (no divide-by-zero)", () => {
    const r = call("takeoffEstimate", ctx, { lineItems: [{ description: "x", quantity: 1, unit: "ea", unitCost: 10, wastePercent: 0 }], squareFootage: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.costPerSqFt, null);
  });

  it("fail-CLOSED on poisoned numerics — every roll-up field stays FINITE", () => {
    const r = call("takeoffEstimate", ctx, {
      lineItems: [
        { description: "poison", quantity: "Infinity", unit: "ea", unitCost: "1e999", wastePercent: "NaN" },
        { description: "ok", quantity: 10, unit: "ea", unitCost: 5, wastePercent: 0 },
      ],
      laborPercent: "Infinity",
      squareFootage: "-1e999",
    });
    assert.equal(r.ok, true);
    for (const k of ["subtotalMaterials", "laborCost", "overhead", "profit", "grandTotal"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
    }
    // 'Infinity'/'1e999'/'NaN' all collapse via finNum → 0/default — poison
    // line contributes 0; only the clean line (10 × 5 = 50) survives.
    assert.equal(r.result.subtotalMaterials, 50);
    // laborPercent 'Infinity' → finNum non-finite → falls back to the 40%
    // default, so laborCost = 50 × 0.40 = 20 (finite, not Infinity).
    assert.equal(r.result.laborCost, 20);
    assert.ok(Number.isFinite(r.result.grandTotal));
  });
});

// =========================================================================
// criticalPath — CPM forward/backward pass, slack, project duration
// =========================================================================
describe("construction — criticalPath (CPM)", () => {
  // Excavate(5) → Foundation(10) → Framing(15), with a parallel Survey(3)
  // off the start that has slack. CP = Excavate→Foundation→Framing, 30 days.
  const tasks = {
    tasks: [
      { name: "Excavate", duration: 5, dependencies: [] },
      { name: "Survey", duration: 3, dependencies: [] },
      { name: "Foundation", duration: 10, dependencies: ["Excavate"] },
      { name: "Framing", duration: 15, dependencies: ["Foundation"] },
    ],
  };

  it("computes project duration, critical path and per-task slack", () => {
    const r = call("criticalPath", ctx, tasks);
    assert.equal(r.ok, true);
    assert.equal(r.result.projectDuration, 30);
    assert.deepEqual(r.result.criticalPath, ["Excavate", "Foundation", "Framing"]);
    const survey = r.result.tasks.find((t) => t.name === "Survey");
    assert.equal(survey.onCriticalPath, false);
    // Survey has no successors → lateFinish = projectDuration (30),
    // lateStart = 30 − 3 = 27, slack = 27 − earlyStart(0) = 27.
    assert.equal(survey.slack, 27, "Survey slack = projectDuration − duration − earlyStart");
    const exc = r.result.tasks.find((t) => t.name === "Excavate");
    assert.equal(exc.slack, 0);
    assert.equal(exc.onCriticalPath, true);
  });

  it("double-wrap path reaches identical project duration", () => {
    assert.equal(callPanel("criticalPath", ctx, tasks).result.projectDuration, 30);
  });

  it("empty tasks degrade graceful", () => {
    const r = call("criticalPath", ctx, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add tasks/);
  });
});

// =========================================================================
// safetyCompliance — OSHA TRIR (incident rate per 200,000 hours)
// =========================================================================
describe("construction — safetyCompliance (OSHA TRIR)", () => {
  it("computes compliance rate, OSHA incident rate and rating", () => {
    // 8 of 10 checklist items pass → 80% → "acceptable".
    // 3 incidents over 120,000 hours: 3/120000 × 200000 = 5.00 TRIR.
    const checklist = [];
    for (let i = 0; i < 8; i++) checklist.push({ item: `c${i}`, passed: true });
    checklist.push({ item: "fall-protection", passed: false, critical: true });
    checklist.push({ item: "signage", passed: false });
    const r = call("safetyCompliance", ctx, {
      safetyChecklist: checklist,
      incidents: [{}, {}, {}],
      workerCount: 25,
      totalHoursWorked: 120000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.complianceRate, 80);
    assert.equal(r.result.rating, "acceptable");
    assert.equal(r.result.incidentRate, 5);
    assert.equal(r.result.incidentRateLabel, "per 200,000 hours worked");
    assert.deepEqual(r.result.criticalFailures, ["fall-protection"]);
    assert.deepEqual(r.result.checklistResults, { passed: 8, failed: 2, total: 10 });
  });

  it("double-wrap path reaches identical TRIR", () => {
    const data = { safetyChecklist: [{ item: "a", passed: true }], incidents: [{}], totalHoursWorked: 200000 };
    assert.equal(callPanel("safetyCompliance", ctx, data).result.incidentRate, 1);
  });

  it("zero hours worked → incidentRate 0 (no divide-by-zero)", () => {
    const r = call("safetyCompliance", ctx, { safetyChecklist: [{ passed: true }], incidents: [{}, {}], totalHoursWorked: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.incidentRate, 0);
    assert.equal(r.result.complianceRate, 100);
    assert.equal(r.result.rating, "excellent");
  });

  it("fail-CLOSED on poisoned hours — incidentRate stays finite", () => {
    const r = call("safetyCompliance", ctx, { safetyChecklist: [{ passed: true }], incidents: [{}], totalHoursWorked: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.incidentRate), `TRIR must be finite, got ${r.result.incidentRate}`);
    // parseInt('1e999') → 1, so rate = 1/1 × 200000 = 200000 (finite, not Inf).
    assert.equal(r.result.incidentRate, 200000);
  });
});

// =========================================================================
// progressReport — plan-vs-actual variance roll-up
// =========================================================================
describe("construction — progressReport (plan vs actual)", () => {
  it("computes per-phase variance, overall roll-up and behind-schedule list", () => {
    // Sitework on-track (+5), Foundation slightly-behind (-8),
    // Framing behind-schedule (-20).
    const r = call("progressReport", ctx, {
      phases: [
        { name: "Sitework", plannedPercent: 90, actualPercent: 95 },
        { name: "Foundation", plannedPercent: 60, actualPercent: 52 },
        { name: "Framing", plannedPercent: 40, actualPercent: 20 },
      ],
    });
    assert.equal(r.ok, true);
    // overall planned = (90+60+40)/3 = 63.33 → round 63
    // overall actual  = (95+52+20)/3 = 55.67 → round 56
    assert.equal(r.result.overallPlannedPercent, 63);
    assert.equal(r.result.overallActualPercent, 56);
    // overallVariance = round(55.67) - round(... ) — computed on raw averages:
    //   round(55.6667 - 63.3333) = round(-7.6667) = -8
    assert.equal(r.result.overallVariance, -8);
    assert.equal(r.result.projectStatus, "minor-delay");
    assert.deepEqual(r.result.behindPhases, ["Framing"]);
    const found = r.result.phases.find((p) => p.phase === "Foundation");
    assert.equal(found.status, "slightly-behind");
    assert.equal(found.variance, -8);
  });

  it("double-wrap path reaches identical overall actual percent", () => {
    const data = { phases: [{ name: "P", plannedPercent: 50, actualPercent: 50 }] };
    const r = callPanel("progressReport", ctx, data);
    assert.equal(r.result.overallActualPercent, 50);
    assert.equal(r.result.projectStatus, "on-schedule");
  });

  it("empty phases degrade graceful", () => {
    const r = call("progressReport", ctx, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add project phases/);
  });
});

// =========================================================================
// ganttSchedule — calcData double-wrap coverage (happy path lives in parity)
// =========================================================================
describe("construction — ganttSchedule (double-wrap tolerance)", () => {
  it("double-wrapped artifact.data still builds the schedule bars", () => {
    const data = { tasks: [{ name: "A", duration: 5, dependencies: [] }, { name: "B", duration: 7, dependencies: ["A"] }] };
    const r = callPanel("ganttSchedule", ctx, data);
    assert.equal(r.ok, true);
    assert.equal(r.result.projectDuration, 12);
    assert.equal(r.result.bars.length, 2);
  });
});
