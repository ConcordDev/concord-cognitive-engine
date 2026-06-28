// Behavioral macro tests for server/domains/manufacturing.js — the shop-floor
// calculator + work-order substrate the /lenses/manufacturing lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150 +
// lib/lens-input-normalize.js): a panel that posts
// `{ artifact: { data: {...} } }` has the wrapper PEELED at the dispatch, so a
// handler registered via `registerLensAction(domain, action, handler)` is
// invoked as `handler(ctx, virtualArtifact, input)` with
// `virtualArtifact.data === input === <the inner data object>`. Our harness
// therefore drives each handler with the EXACT post-peel inner-data object the
// live component sends — so a field-name drift between caller and receiver
// (the silent dead-calculator class) surfaces here, not just in production.
//
// COMPONENT-EXACT field contracts pinned below (verified against the live
// components in concord-frontend/components/manufacturing/*):
//   • ManufacturingActionPanel.tsx → oeeCalculate / bomCost / safetyRate /
//     scheduleOptimize (post-peel inner data).
//   • page.tsx (useRunArtifact → /api/lens/:domain/:id/run) → advanceStep /
//     defectAnalysis / generateTraveler / logDowntime (real saved artifact).
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values: OEE = A×P×Q with the exact A/P/Q math, BOM line + total cost, OSHA
// TRIR = recordable×200000/hours, scheduleOptimize priority/due ordering,
// advanceStep progress %, defect-rate %, traveler line count, downtime
// availability impact %. Validation-rejection, degrade-graceful, and
// fail-CLOSED poisoned-numeric cases are pinned.
//
// The parity test (manufacturing-domain-parity.test.js) already covers the
// read-feed macros (oee-status / work-orders / spc-chart) + the ext-state CRUD;
// this file covers the calculator + artifact-action substrate it does NOT.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerManufacturingActions from "../domains/manufacturing.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "manufacturing", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Drive a handler the way the LENS_ACTIONS dispatch does. `body` is the raw
// post-`{domain,action,input}` payload's `input` field exactly as the live
// component builds it (so we exercise the real wrapper-peel too); the peeled
// result becomes virtualArtifact.data AND the third positional arg.
function callRaw(name, ctx, bodyInput) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`manufacturing.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(bodyInput || {});
  const virtualArtifact = { id: null, domain: "manufacturing", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// For the page.tsx useRunArtifact path: the handler runs against a REAL saved
// artifact (with id + title + data). `artifact` is the full artifact; `params`
// the optional run params.
function callArtifact(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`manufacturing.${name} not registered`);
  return fn(ctx, { meta: {}, ...artifact }, params);
}

before(() => { registerManufacturingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in test"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// ─────────────────────────────────────────────────────────────────────────
// oeeCalculate — ManufacturingActionPanel.tsx actOee()
//   sends: { artifact: { title:'Line 1', data: { plannedTime, downtime,
//           idealCycleTime, totalPieces, goodPieces } } }
//   renders: oee, availability, performance, quality, rating
// ─────────────────────────────────────────────────────────────────────────
describe("oeeCalculate (Action panel — A×P×Q)", () => {
  it("computes availability/performance/quality/oee with the exact component input fields", () => {
    // plannedTime 480, downtime 80 → runTime 400, availability 400/480 = 83.33%.
    // performance = (idealCycle 0.5 × total 700) / 400 = 350/400 = 87.5%.
    // quality = good 680 / 700 = 97.14%. oee = 0.8333×0.875×0.9714 = 0.7083 → 71%.
    const r = callRaw("oeeCalculate", ctxA, { artifact: { title: "Line 1", data: { plannedTime: 480, downtime: 80, idealCycleTime: 0.5, totalPieces: 700, goodPieces: 680 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.availability, 83);
    assert.equal(r.result.performance, 88); // 87.5 rounds to 88
    assert.equal(r.result.quality, 97);
    assert.equal(r.result.oee, 71);
    assert.equal(r.result.rating, "typical");
  });

  it("rates world_class when A,P,Q are all high", () => {
    // 480 planned, 24 downtime → 456 run, avail 95%. perf = (1×450)/456 = 98.7%.
    // quality 449/450 = 99.8%. oee = 0.95×0.987×0.9978 = 0.9355 → 94%.
    const r = callRaw("oeeCalculate", ctxA, { artifact: { data: { plannedTime: 480, downtime: 24, idealCycleTime: 1, totalPieces: 450, goodPieces: 449 } } });
    assert.equal(r.result.rating, "world_class");
    assert.ok(r.result.oee >= 85);
  });

  it("rates needs_improvement when oee is low", () => {
    const r = callRaw("oeeCalculate", ctxA, { artifact: { data: { plannedTime: 480, downtime: 240, idealCycleTime: 0.5, totalPieces: 300, goodPieces: 250 } } });
    assert.equal(r.result.rating, "needs_improvement");
  });

  it("degrades gracefully on empty data (defaults, never throws)", () => {
    const r = callRaw("oeeCalculate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.oee, "number");
    assert.ok(Number.isFinite(r.result.oee));
  });

  it("fails CLOSED on poisoned-numeric input (no NaN leaks into rendered fields)", () => {
    const r = callRaw("oeeCalculate", ctxA, { artifact: { data: { plannedTime: "NaN", downtime: "oops", idealCycleTime: null, totalPieces: undefined, goodPieces: {} } } });
    assert.equal(r.ok, true);
    for (const k of ["availability", "performance", "quality", "oee"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
      assert.ok(!Number.isNaN(r.result[k]), `${k} must not be NaN`);
    }
    assert.ok(["world_class", "typical", "needs_improvement"].includes(r.result.rating));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// bomCost — ManufacturingActionPanel.tsx actBom()
//   sends (post-fix): { artifact: { data: { product, components:[{name,
//           quantity,unitCost}] } } }
//   renders: totalCost, componentCount, components[].part, .quantity, .lineCost,
//            product
// ─────────────────────────────────────────────────────────────────────────
describe("bomCost (Action panel — unit cost roll-up)", () => {
  it("rolls up line + total cost from the exact component input fields", () => {
    const r = callRaw("bomCost", ctxA, { artifact: { data: { product: "HA-400", components: [
      { name: "Housing", quantity: 2, unitCost: 12.5 },
      { name: "Bolt M6", quantity: 10, unitCost: 0.25 },
    ] } } });
    assert.equal(r.ok, true);
    // 2×12.5 = 25 + 10×0.25 = 2.5 → 27.5
    assert.equal(r.result.totalCost, 27.5);
    assert.equal(r.result.componentCount, 2);
    assert.equal(r.result.product, "HA-400");
    // rendered line fields: part + quantity + lineCost
    assert.equal(r.result.components[0].part, "Housing");
    assert.equal(r.result.components[0].quantity, 2);
    assert.equal(r.result.components[0].lineCost, 25);
    assert.equal(r.result.components[1].lineCost, 2.5);
  });

  it("falls back to data.product for the rendered product label (title peeled at dispatch)", () => {
    const r = callRaw("bomCost", ctxA, { artifact: { data: { product: "Pump-9", components: [{ name: "x", quantity: 1, unitCost: 5 }] } } });
    assert.equal(r.result.product, "Pump-9");
  });

  it("degrades gracefully on empty components (total 0, never throws)", () => {
    const r = callRaw("bomCost", ctxA, { artifact: { data: { product: "Empty", components: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCost, 0);
    assert.equal(r.result.componentCount, 0);
  });

  it("fails CLOSED on poisoned-numeric component cost (no NaN total)", () => {
    const r = callRaw("bomCost", ctxA, { artifact: { data: { components: [
      { name: "bad", quantity: "lots", unitCost: "free" },
      { name: "ok", quantity: 3, unitCost: 2 },
    ] } } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalCost), `total must be finite, got ${r.result.totalCost}`);
    assert.equal(r.result.totalCost, 6); // bad row contributes 0, ok row 6
  });
});

// ─────────────────────────────────────────────────────────────────────────
// safetyRate — ManufacturingActionPanel.tsx actSafe()
//   sends: { artifact: { data: { hoursWorked, incidents:[{type, severity,
//           oshaRecordable}] } } }
//   renders: incidentRate, recordableIncidents, totalIncidents, hoursWorked,
//            benchmark
// ─────────────────────────────────────────────────────────────────────────
describe("safetyRate (Action panel — OSHA TRIR)", () => {
  it("computes TRIR = recordable × 200000 / hoursWorked with exact incident fields", () => {
    // 3 recordable over 300000 hrs → 3×200000/300000 = 2.0 → below_average.
    const r = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: 300000, incidents: [
      { type: "laceration", oshaRecordable: true },
      { type: "strain", oshaRecordable: true },
      { type: "burn", oshaRecordable: true },
      { type: "near-miss", oshaRecordable: false },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.recordableIncidents, 3);
    assert.equal(r.result.totalIncidents, 4);
    assert.equal(r.result.hoursWorked, 300000);
    assert.equal(r.result.incidentRate, 2);
    assert.equal(r.result.benchmark, "below_average");
  });

  it("accepts the `recordable` alias for the OSHA flag", () => {
    const r = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: 200000, incidents: [{ type: "x", recordable: true }] } } });
    assert.equal(r.result.recordableIncidents, 1);
    assert.equal(r.result.incidentRate, 1);
  });

  it("classifies above_average benchmark for a high rate", () => {
    // 8 recordable / 200000 → 8.0 → above_average
    const incidents = Array.from({ length: 8 }, () => ({ oshaRecordable: true }));
    const r = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: 200000, incidents } } });
    assert.equal(r.result.incidentRate, 8);
    assert.equal(r.result.benchmark, "above_average");
  });

  it("degrades gracefully with no incidents (rate 0)", () => {
    const r = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: 200000, incidents: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.incidentRate, 0);
    assert.equal(r.result.benchmark, "below_average");
  });

  it("fails CLOSED on poisoned hoursWorked (no NaN / Infinity rate)", () => {
    // hoursWorked 0 is falsy → the handler falls back to the 200000 OSHA base,
    // so 1 recordable → rate 1.0 (a defined, finite value, never Infinity).
    const r = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: 0, incidents: [{ oshaRecordable: true }] } } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.incidentRate), `rate must be finite, got ${r.result.incidentRate}`);
    assert.equal(r.result.incidentRate, 1);
    // A poisoned non-numeric hoursWorked also stays finite (NaN > 0 is false → rate 0).
    const r2 = callRaw("safetyRate", ctxA, { artifact: { data: { hoursWorked: "bad", incidents: [{ oshaRecordable: true }] } } });
    assert.ok(Number.isFinite(r2.result.incidentRate), `rate must be finite, got ${r2.result.incidentRate}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// scheduleOptimize — ManufacturingActionPanel.tsx actSched()
//   sends (post-fix): { artifact: { data: { workOrders:[{id,priority,
//           dueDate}] } } }
//   renders: count, sequence[].position, .id, .priority, .dueDate
// ─────────────────────────────────────────────────────────────────────────
describe("scheduleOptimize (Action panel — priority/due ordering)", () => {
  it("orders by priority then due date and returns sequence + count", () => {
    const r = callRaw("scheduleOptimize", ctxA, { artifact: { data: { workOrders: [
      { id: "WO-A", priority: 3, dueDate: "2026-07-10" },
      { id: "WO-B", priority: 1, dueDate: "2026-07-20" },
      { id: "WO-C", priority: 1, dueDate: "2026-07-05" },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    // priority 1 first; within priority 1, earlier due date first → C then B; then A.
    assert.deepEqual(r.result.sequence.map((s) => s.id), ["WO-C", "WO-B", "WO-A"]);
    assert.equal(r.result.sequence[0].position, 1);
    assert.equal(r.result.sequence[0].priority, 1);
    assert.equal(r.result.sequence[0].dueDate, "2026-07-05");
    assert.equal(r.result.sequence[2].position, 3);
  });

  it("defaults missing priority to 3 in ordering", () => {
    const r = callRaw("scheduleOptimize", ctxA, { artifact: { data: { workOrders: [
      { id: "no-prio" },
      { id: "high", priority: 1 },
    ] } } });
    assert.deepEqual(r.result.sequence.map((s) => s.id), ["high", "no-prio"]);
  });

  it("degrades gracefully on empty work orders (count 0)", () => {
    const r = callRaw("scheduleOptimize", ctxA, { artifact: { data: { workOrders: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.sequence, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// advanceStep — page.tsx handleAction('advanceStep') via useRunArtifact
//   artifact.data.{steps, currentStep}; renders currentStep/totalSteps/status/
//   percentComplete/currentStepName/nextStepName
// ─────────────────────────────────────────────────────────────────────────
describe("advanceStep (page — work-order routing)", () => {
  it("advances one step and computes percentComplete + step names", () => {
    const r = callArtifact("advanceStep", ctxA, { id: "wo1", title: "WO-301", data: { steps: [{ name: "Cut" }, { name: "Weld" }, { name: "Inspect" }], currentStep: 0 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentStep, 1);
    assert.equal(r.result.totalSteps, 3);
    assert.equal(r.result.status, "in_progress");
    assert.equal(r.result.percentComplete, 33);
    assert.equal(r.result.currentStepName, "Cut");
    assert.equal(r.result.nextStepName, "Weld");
  });

  it("marks complete on the final step", () => {
    const r = callArtifact("advanceStep", ctxA, { id: "wo1", title: "WO", data: { steps: ["a", "b"], currentStep: 1 } });
    assert.equal(r.result.currentStep, 2);
    assert.equal(r.result.status, "complete");
    assert.equal(r.result.percentComplete, 100);
    assert.equal(r.result.nextStepName, null);
  });

  it("degrades gracefully with no steps defined", () => {
    const r = callArtifact("advanceStep", ctxA, { id: "wo1", title: "WO", data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "no_steps_defined");
    assert.equal(r.result.percentComplete, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// defectAnalysis — page.tsx handleAction('defectAnalysis')
//   artifact.data.{defects, inspected}; renders defectCount/inspected/
//   defectRatePct/byType/bySeverity/topDefect/riskLevel
// ─────────────────────────────────────────────────────────────────────────
describe("defectAnalysis (page — defect roll-up)", () => {
  it("computes defect rate %, by-type, top defect, and risk level", () => {
    const r = callArtifact("defectAnalysis", ctxA, { id: "d1", title: "Lot", data: {
      inspected: 200,
      defects: [
        { type: "scratch", severity: "minor" },
        { type: "scratch", severity: "minor" },
        { type: "crack", severity: "critical" },
      ],
    } });
    assert.equal(r.ok, true);
    assert.equal(r.result.defectCount, 3);
    assert.equal(r.result.inspected, 200);
    assert.equal(r.result.defectRatePct, 1.5); // 3/200 = 1.5%
    assert.equal(r.result.topDefect, "scratch");
    assert.equal(r.result.byType.scratch, 2);
    assert.equal(r.result.bySeverity.critical, 1);
    assert.equal(r.result.riskLevel, "high"); // any critical → high
  });

  it("risk none with zero defects", () => {
    const r = callArtifact("defectAnalysis", ctxA, { id: "d1", title: "Lot", data: { inspected: 50, defects: [] } });
    assert.equal(r.result.riskLevel, "none");
    assert.equal(r.result.defectRatePct, 0);
  });

  it("fails CLOSED on poisoned inspected count (no NaN/Infinity rate)", () => {
    const r = callArtifact("defectAnalysis", ctxA, { id: "d1", title: "Lot", data: { inspected: "bad", defects: [{ type: "x" }] } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.defectRatePct), `rate must be finite, got ${r.result.defectRatePct}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// generateTraveler — page.tsx handleAction('generateTraveler')
//   artifact.data.{steps, partNumber, quantity}; renders travelerId/partNumber/
//   quantity/stepCount/content
// ─────────────────────────────────────────────────────────────────────────
describe("generateTraveler (page — routing traveler)", () => {
  it("builds a traveler with the exact rendered fields + one content line per step", () => {
    const r = callArtifact("generateTraveler", ctxA, { id: "wo9", title: "Pump body", data: { partNumber: "PB-12", quantity: 5, steps: [{ name: "Mill" }, { name: "Drill" }] } });
    assert.equal(r.ok, true);
    assert.match(r.result.travelerId, /^TRV-/);
    assert.equal(r.result.partNumber, "PB-12");
    assert.equal(r.result.quantity, 5);
    assert.equal(r.result.stepCount, 2);
    assert.match(r.result.content, /ROUTING TRAVELER/);
    assert.match(r.result.content, /Mill/);
    assert.match(r.result.content, /Drill/);
  });

  it("degrades gracefully with no routing steps", () => {
    const r = callArtifact("generateTraveler", ctxA, { id: "wo9", title: "WO", data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.stepCount, 0);
    assert.match(r.result.content, /no routing steps/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// logDowntime — page.tsx handleAction('logDowntime')
//   artifact.data.{machine, plannedTime} + params.{reason, durationMinutes};
//   renders downtimeId/machine/reason/durationMinutes/availabilityImpactPct/
//   category
// ─────────────────────────────────────────────────────────────────────────
describe("logDowntime (page — downtime + availability impact)", () => {
  it("computes availability impact % and categorizes the reason", () => {
    const r = callArtifact("logDowntime", ctxA, { id: "m1", title: "CNC-01", data: { machine: "CNC-01", plannedTime: 480 } }, { reason: "tool change setup", durationMinutes: 48 });
    assert.equal(r.ok, true);
    assert.match(r.result.downtimeId, /^DT-/);
    assert.equal(r.result.machine, "CNC-01");
    assert.equal(r.result.durationMinutes, 48);
    assert.equal(r.result.availabilityImpactPct, 10); // 48/480 = 10%
    assert.equal(r.result.category, "setup"); // "setup" keyword
  });

  it("categorizes maintenance reasons", () => {
    const r = callArtifact("logDowntime", ctxA, { id: "m1", title: "M", data: { plannedTime: 480 } }, { reason: "bearing repair", durationMinutes: 60 });
    assert.equal(r.result.category, "maintenance");
    assert.equal(r.result.availabilityImpactPct, 12.5);
  });

  it("fails CLOSED on poisoned duration (no NaN impact)", () => {
    const r = callArtifact("logDowntime", ctxA, { id: "m1", title: "M", data: { plannedTime: 480 } }, { reason: "x", durationMinutes: "lots" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.availabilityImpactPct), `impact must be finite, got ${r.result.availabilityImpactPct}`);
    assert.equal(r.result.durationMinutes, 0); // poisoned → clamped to 0
  });
});
