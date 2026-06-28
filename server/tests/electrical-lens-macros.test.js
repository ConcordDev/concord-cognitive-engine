// Behavioral macro tests for the electrical lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields). Electrical is safety-relevant (NEC wire /
// breaker / conduit / box sizing) so a blank field or a leaked NaN/Infinity in
// an ampacity or fill verdict is a genuine hazard — every assertion below uses
// the EXACT inner-data object each component sends and asserts the EXACT fields
// it renders from `r.result`.
//
// Two real channels, BOTH proven here:
//   • NecCodeCalc.tsx → apiHelpers.lens.runDomain('electrical', action,
//       { input: { artifact: { data } } })  → dispatch peels the redundant
//       artifact wrapper → handler reads art.data.* (== params here).
//       Drives 4 calculators: loadCalculation, voltageDropCalc, circuitTrace,
//       safetyInspection.
//   • NecCalculators.tsx → lensRun('electrical', action, { ...data })  →
//       body.input === data → no wrapper → handler reads art.data.* / params.
//       Drives 3 calculators: conduitFill, boxFill, wireSize.
//
// Field-alignment audit (component reads ⇄ handler returns), cross-checked
// field-for-field against components/electrical/NecCodeCalc.tsx +
// NecCalculators.tsx — every rendered field below has a real receiver field, so
// the surface is NOT dead (unlike welding pre-2026-06-28):
//   - loadCalculation: circuits[].{name,amps,breakerSize,wireGauge} +
//     totalWatts / totalAmps / panelSizeRecommended / utilization /
//     safetyMargin / nec80PercentRule
//   - voltageDropCalc: voltageDrop / dropPercent / acceptable / wireGauge /
//     recommendation / necLimit / distance / current / voltage
//   - circuitTrace: panels / totalCircuits / unassigned / avgDevicesPerCircuit
//   - safetyInspection: results[].{item,code,passed,severity,notes} + total /
//     passed / failed / criticalFailures / passRate / overallResult
//   - conduitFill: recommendedConduitSize / recommendedActualFillPercent /
//     necFillLimitPercent / fillRule / totalConductors / totalConductorArea /
//     requested.{size,actualFillPercent,allowedFillPercent,pass}
//   - boxFill: totalConductorEquivalents / requiredBoxVolume / providedBoxVolume
//     / breakdown[].{item,equivalents} / pass / verdict
//   - wireSize: recommendedWire / minBreaker / voltageDropAtRecommended /
//     designAmps / ampacityRequiredWire / recommendedAmpacity /
//     upsizedForVoltageDrop / basis
//   - VALIDATION-REJECTION: empty/missing payloads return honest prompts, not
//     a fabricated tally; non-positive wireSize load returns the prompt.
//   - DEGRADE-GRACEFUL: every calculator is STATELESS — it computes with STATE
//     gone (never throws). (The STATE-backed persistence macros fail-soft, also
//     pinned.)
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / negative): no
//     non-finite value and no nonsensical-negative ampacity/area/volume leaks
//     into ANY rendered number, and a poisoned safety load never fabricates a
//     "success" recommendation.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB — runs in <1s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerElectricalActions from "../domains/electrical.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "electrical", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data ===
// rest AND the 3rd `params` arg === rest. So both the calculators (read
// art.data) and the ops macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`electrical.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "electrical", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper NecCodeCalc.callElec builds before dispatch:
//   runDomain('electrical', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. This proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaCodeCalc(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}
// NecCalculators sends lensRun('electrical', action, data) → body.input === data
// (flat, no wrapper). Modelled by calling with the data object directly.
function callViaCalculators(name, ctx, data = {}) {
  return call(name, ctx, data);
}

before(() => {
  registerElectricalActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "elec_a", id: "elec_a" }, userId: "elec_a" };

const FINITE = (x) => Number.isFinite(x);

/* ───────── registration: every macro the lens channels drive ───────── */

describe("electrical lens — registration of the driven macros", () => {
  it("registers every calculator NecCodeCalc + NecCalculators call", () => {
    const driven = [
      // NecCodeCalc (runDomain → artifact-wrapped)
      "loadCalculation", "voltageDropCalc", "circuitTrace", "safetyInspection",
      // NecCalculators (lensRun → flat input)
      "conduitFill", "boxFill", "wireSize",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing electrical.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end (NecCodeCalc) ───── */

describe("electrical lens — NecCodeCalc { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a loadCalculation sent the way NecCodeCalc sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read
    // artifact.data.circuits === undefined → the empty-prompt branch, and the
    // result cards would render blank. Proving the peel reaches the real path.
    const r = callViaCodeCalc("loadCalculation", ctxA, {
      circuits: [{ name: "Kitchen", watts: 1800, voltage: 120 }],
    });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.circuits), "circuits array must populate (not the empty prompt)");
    assert.equal(r.result.circuits.length, 1);
    assert.equal(r.result.circuits[0].name, "Kitchen");
  });
});

/* ───── loadCalculation: the Panel-load-calc result cards (NecCodeCalc) ───── */

describe("electrical lens — loadCalculation (PanelLoadCalc cards)", () => {
  it("amps = W/V, breaker/wire sized at 125%, totals + NEC 80% + utilization", () => {
    // 1800W @ 120V = 15A. design = 15×1.25 = 18.75 → breaker 20A (first ≥18.75),
    // wire 14 AWG (ampacity 20 ≥ 18.75). panel ≤100A → 100A.
    // util = round(15/100×100)=15 ; safetyMargin = round((1−15/80)×100)=81 ; NEC PASS.
    const r = callViaCodeCalc("loadCalculation", ctxA, {
      circuits: [{ name: "Kitchen", watts: 1800, voltage: 120 }],
    });
    assert.equal(r.ok, true);
    const c = r.result.circuits[0];
    assert.equal(c.amps, 15);
    assert.equal(c.breakerSize, 20);
    assert.equal(c.wireGauge, "14 AWG");
    assert.equal(r.result.totalWatts, 1800);
    assert.equal(r.result.totalAmps, 15);
    assert.equal(r.result.panelSizeRecommended, "100A");
    assert.equal(r.result.utilization, 15);
    assert.equal(r.result.safetyMargin, 81);
    assert.equal(r.result.nec80PercentRule, "PASS");
  });

  it("an over-loaded panel trips the NEC 80% FAIL the badge renders red on", () => {
    // 9600W @ 120V = 80A on a 100A panel → 80 ≤ 80? PASS exactly at the edge.
    // 9700W @ 120V = 80.83A → > 80 → FAIL.
    const r = callViaCodeCalc("loadCalculation", ctxA, {
      circuits: [{ name: "Big", watts: 9700, voltage: 120 }],
    });
    assert.equal(r.ok, true);
    assert.match(r.result.nec80PercentRule, /^FAIL/);
  });

  it("VALIDATION: empty circuits returns the honest prompt, not a fabricated tally", () => {
    const r = callViaCodeCalc("loadCalculation", ctxA, { circuits: [] });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Add circuits/i);
    assert.equal(r.result.totalAmps, undefined, "no fabricated total on empty input");
  });
});

/* ───── voltageDropCalc: the VoltageDropChart result cards (NecCodeCalc) ───── */

describe("electrical lens — voltageDropCalc (VoltageDropChart cards)", () => {
  it("1-phase drop = (R/1000)×ft×A×2, % vs voltage, ≤3% acceptable + necLimit", () => {
    // 20A, 100ft, 10 AWG (R=1.21Ω/1000ft), 240V, 1-phase:
    //   drop = 1.21/1000 × 100 × 20 × 2 = 4.84V ; % = 4.84/240×100 = 2.0167 → 2.02%
    const r = callViaCodeCalc("voltageDropCalc", ctxA, {
      amps: 20, distanceFeet: 100, wireGauge: 10, voltage: 240,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.voltageDrop, "4.84V");
    assert.equal(r.result.dropPercent, "2.02%");
    assert.equal(r.result.acceptable, true);
    assert.equal(r.result.wireGauge, "10 AWG");
    assert.equal(r.result.distance, "100 ft");
    assert.equal(r.result.current, "20A");
    assert.equal(r.result.voltage, "240V");
    assert.match(r.result.necLimit, /3%/);
    assert.match(r.result.recommendation, /Within acceptable/i);
  });

  it("an excessive drop flips acceptable:false + emits an upgrade recommendation", () => {
    // 30A, 200ft, 14 AWG (R=3.07), 120V: drop = 3.07/1000×200×30×2 = 36.84V →
    //   30.7% → not acceptable, recommends a heavier gauge.
    const r = callViaCodeCalc("voltageDropCalc", ctxA, {
      amps: 30, distanceFeet: 200, wireGauge: 14, voltage: 120,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.acceptable, false);
    assert.match(r.result.recommendation, /Upgrade to/i);
  });
});

/* ───── circuitTrace: the CircuitMap summary cards (NecCodeCalc) ───── */

describe("electrical lens — circuitTrace (CircuitMap cards)", () => {
  it("counts circuits, derives unassigned (no room) + avg devices/circuit", () => {
    const r = callViaCodeCalc("circuitTrace", ctxA, {
      circuits: [
        { name: "C1", panel: "Main", breaker: "20A", room: "Kitchen", devices: ["recept", "lights"], wireRunFeet: 40 },
        { name: "C2", panel: "Main", breaker: "15A", room: "", devices: ["lights"], wireRunFeet: 25 },
      ],
    });
    assert.equal(r.ok, true);
    // component never sends `panels`, so handler defaults panels.length || 1 → 1.
    assert.equal(r.result.panels, 1);
    assert.equal(r.result.totalCircuits, 2);
    assert.equal(r.result.unassigned, 1, "the room-less circuit is unassigned");
    // avg devices = (2 + 1) / 2 = 1.5
    assert.equal(r.result.avgDevicesPerCircuit, 1.5);
  });
});

/* ───── safetyInspection: the SafetyChecklist verdict cards (NecCodeCalc) ───── */

describe("electrical lens — safetyInspection (SafetyChecklist cards)", () => {
  it("a clean sheet → PASS with per-item results the card renders", () => {
    const r = callViaCodeCalc("safetyInspection", ctxA, {
      inspectionItems: [
        { name: "GFCI present", necCode: "210.8", passed: true, critical: false, notes: "ok" },
        { name: "AFCI present", necCode: "210.12", passed: true, critical: false, notes: "" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.passed, 2);
    assert.equal(r.result.failed, 0);
    assert.equal(r.result.criticalFailures, 0);
    assert.equal(r.result.passRate, 100);
    assert.equal(r.result.overallResult, "PASS");
    const item = r.result.results[0];
    assert.equal(item.item, "GFCI present");
    assert.equal(item.code, "210.8");
    assert.equal(item.passed, true);
    assert.equal(item.severity, "ok");
  });

  it("a critical failure → FAIL; a non-critical failure → CONDITIONAL", () => {
    const crit = callViaCodeCalc("safetyInspection", ctxA, {
      inspectionItems: [
        { name: "Ground bond", necCode: "250.28", passed: false, critical: true, notes: "missing" },
        { name: "Cover plates", necCode: "406.6", passed: true, critical: false, notes: "" },
      ],
    });
    assert.equal(crit.result.criticalFailures, 1);
    assert.match(crit.result.overallResult, /^FAIL/);
    assert.equal(crit.result.results[0].severity, "critical");

    const minor = callViaCodeCalc("safetyInspection", ctxA, {
      inspectionItems: [
        { name: "Labeling", necCode: "408.4", passed: false, critical: false, notes: "" },
        { name: "GFCI", necCode: "210.8", passed: true, critical: false, notes: "" },
      ],
    });
    assert.equal(minor.result.criticalFailures, 0);
    assert.match(minor.result.overallResult, /^CONDITIONAL/);
    assert.equal(minor.result.results[0].severity, "minor");
  });

  it("VALIDATION: empty items returns the honest prompt, not a fabricated verdict", () => {
    const r = callViaCodeCalc("safetyInspection", ctxA, { inspectionItems: [] });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Add inspection items/i);
    assert.equal(r.result.overallResult, undefined);
  });
});

/* ───── conduitFill: the ConduitFillCalc cards (NecCalculators, flat input) ───── */

describe("electrical lens — conduitFill (ConduitFillCalc cards)", () => {
  it("sizes conduit by 40% fill (3+ conductors), reports rule + areas the card shows", () => {
    // 3 × #12 THHN, area 0.0133 each → 0.0399 total. 3+ conductors → 40% limit.
    // 1/2" EMT 100% area = 0.304 → 0.304×0.40 = 0.1216 ≥ 0.0399 → 1/2".
    const r = callViaCalculators("conduitFill", ctxA, {
      conductors: [{ awg: 12, count: 3 }], conduitType: "EMT",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConductors, 3);
    assert.equal(r.result.totalConductorArea, 0.0399);
    assert.equal(r.result.recommendedConduitSize, '1/2"');
    assert.equal(r.result.necFillLimitPercent, 40);
    assert.match(r.result.fillRule, /3\+ conductors/);
    assert.ok(FINITE(r.result.recommendedActualFillPercent));
  });

  it("a verify-size request returns the requested PASS/FAIL block the card renders", () => {
    // 9 × #4 THHN (0.0824 ea) = 0.7416 total; 40% limit. Verify 3/4": 100%=0.533
    //   ×0.40 = 0.2132 < 0.7416 → FAIL (too full).
    const r = callViaCalculators("conduitFill", ctxA, {
      conductors: [{ awg: 4, count: 9 }], conduitType: "EMT", conduitSize: "3/4",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.requested, "requested block present when conduitSize sent");
    assert.equal(r.result.requested.size, "3/4");
    assert.equal(r.result.requested.allowedFillPercent, 40);
    assert.equal(r.result.requested.pass, false);
    assert.ok(FINITE(r.result.requested.actualFillPercent));
  });

  it("single & double conductor fill limits (53% / 31%) are applied", () => {
    const one = callViaCalculators("conduitFill", ctxA, { conductors: [{ awg: 12, count: 1 }] });
    assert.equal(one.result.necFillLimitPercent, 53);
    assert.match(one.result.fillRule, /1 conductor/);
    const two = callViaCalculators("conduitFill", ctxA, { conductors: [{ awg: 12, count: 2 }] });
    assert.equal(two.result.necFillLimitPercent, 31);
    assert.match(two.result.fillRule, /2 conductors/);
  });

  it("VALIDATION: empty conductor list returns the honest prompt", () => {
    const r = callViaCalculators("conduitFill", ctxA, { conductors: [] });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Add conductors/i);
    assert.equal(r.result.recommendedConduitSize, undefined);
  });
});

/* ───── boxFill: the BoxFillCalc cards (NecCalculators, flat input) ───── */

describe("electrical lens — boxFill (BoxFillCalc cards)", () => {
  it("NEC 314.16 equivalents × per-AWG volume, PASS when box ≥ required", () => {
    // 14 AWG → 2.0 in³ per equivalent. 4 hots + grounds(=1) + clamps(=1) +
    //   1 device(×2 = 2) = 8 equivalents → 8 × 2.0 = 16 in³ required.
    // provided 18 ≥ 16 → PASS.
    const r = callViaCalculators("boxFill", ctxA, {
      largestAwg: 14, currentCarrying: 4, groundConductors: 2, devices: 1,
      internalClamps: true, supportFittings: 0, boxVolumeCubicInches: 18,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.largestConductor, "14 AWG");
    assert.equal(r.result.volumePerConductor, 2.0);
    assert.equal(r.result.totalConductorEquivalents, 8);
    assert.equal(r.result.requiredBoxVolume, 16);
    assert.equal(r.result.providedBoxVolume, 18);
    assert.equal(r.result.pass, true);
    assert.match(r.result.verdict, /PASS/);
    assert.ok(Array.isArray(r.result.breakdown) && r.result.breakdown.length > 0);
    assert.equal(typeof r.result.breakdown[0].item, "string");
    assert.ok(FINITE(r.result.breakdown[0].equivalents));
  });

  it("a too-small box FAILs with the shortfall the verdict renders", () => {
    const r = callViaCalculators("boxFill", ctxA, {
      largestAwg: 12, currentCarrying: 6, groundConductors: 1, devices: 2,
      internalClamps: true, boxVolumeCubicInches: 10,
    });
    assert.equal(r.ok, true);
    // 12 AWG → 2.25. equiv = 6 + 1 + 1 + (2×2)=4 = 12 → 27 in³ req > 10 → FAIL.
    assert.equal(r.result.requiredBoxVolume, 27);
    assert.equal(r.result.pass, false);
    assert.match(r.result.verdict, /^FAIL/);
  });

  it("no box volume entered → pass:null + the honest 'enter volume' verdict", () => {
    const r = callViaCalculators("boxFill", ctxA, {
      largestAwg: 14, currentCarrying: 4, devices: 1, internalClamps: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pass, null);
    assert.match(r.result.verdict, /Enter box volume/i);
  });
});

/* ───── wireSize: the WireSizeCalc cards (NecCalculators, flat input) ───── */

describe("electrical lens — wireSize (WireSizeCalc cards)", () => {
  it("125% continuous design, ampacity wire, breaker, ≤3% drop upsize", () => {
    // 40A continuous → design 50A. wire for 50A = 8 AWG (ampacity 50). breaker 50A.
    // drop @ 8 AWG, 50ft, 40A, 240V = 0.764/1000×50×40×2 = 3.056V → 1.27% ≤ 3% → no upsize.
    const r = callViaCalculators("wireSize", ctxA, {
      loadAmps: 40, continuous: true, distanceFeet: 50, voltage: 240,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.loadAmps, 40);
    assert.equal(r.result.continuous, true);
    assert.equal(r.result.designAmps, 50);
    assert.equal(r.result.ampacityRequiredWire, "8 AWG");
    assert.equal(r.result.minBreaker, "50A");
    assert.equal(r.result.recommendedWire, "8 AWG");
    assert.equal(r.result.recommendedAmpacity, 50);
    assert.equal(r.result.voltageDropAtRecommended, "1.27%");
    assert.equal(r.result.upsizedForVoltageDrop, false);
    assert.match(r.result.basis, /NEC 310.16/);
  });

  it("a long run upsizes the wire past the ampacity-minimum for ≤3% drop", () => {
    // 20A, 300ft, 120V continuous → design 25A → ampacity wire 10 AWG (35A).
    // drop @ 10 AWG = 1.21/1000×300×20×2 = 14.52V → 12.1% ≫ 3% → walk up gauges.
    const r = callViaCalculators("wireSize", ctxA, {
      loadAmps: 20, continuous: true, distanceFeet: 300, voltage: 120,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.upsizedForVoltageDrop, true, "must upsize for the long run");
    assert.ok(FINITE(parseFloat(r.result.voltageDropAtRecommended)));
  });

  it("VALIDATION: non-positive load returns the honest prompt, not a fake wire", () => {
    const r = callViaCalculators("wireSize", ctxA, { loadAmps: 0, distanceFeet: 50, voltage: 120 });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Enter the circuit load/i);
    assert.equal(r.result.recommendedWire, undefined);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("electrical lens — fail-closed on poisoned numeric inputs", () => {
  it("loadCalculation: Infinity / NaN / negative watts never leak into amps or totals", () => {
    const r = callViaCodeCalc("loadCalculation", ctxA, {
      circuits: [
        { name: "inf", watts: Infinity, voltage: 120 },
        { name: "nan", watts: NaN, voltage: 120 },
        { name: "neg", watts: -500, voltage: 120 },
        { name: "str", watts: "abc", voltage: 0 },
      ],
    });
    assert.equal(r.ok, true);
    for (const c of r.result.circuits) {
      assert.ok(FINITE(c.amps) && c.amps >= 0, `circuit amps must be finite & ≥0, got ${c.amps}`);
      assert.ok(FINITE(c.watts) && c.watts >= 0, `circuit watts must be finite & ≥0, got ${c.watts}`);
      assert.ok(FINITE(c.breakerSize), "breaker finite");
    }
    for (const k of ["totalWatts", "totalAmps", "utilization", "safetyMargin"]) {
      assert.ok(FINITE(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
    }
    assert.ok(r.result.totalAmps >= 0, "total amps never negative");
    assert.equal(typeof r.result.nec80PercentRule, "string");
  });

  it("voltageDropCalc: Infinity amps / NaN distance never leak a non-finite drop %", () => {
    const r = callViaCodeCalc("voltageDropCalc", ctxA, {
      amps: Infinity, distanceFeet: NaN, wireGauge: 12, voltage: 0,
    });
    assert.equal(r.ok, true);
    assert.ok(FINITE(r.result.dropPercentValue), `dropPercentValue finite, got ${r.result.dropPercentValue}`);
    assert.match(r.result.voltageDrop, /^[\d.]+V$/, "voltageDrop is a finite number string");
    assert.match(r.result.dropPercent, /^[\d.]+%$/, "dropPercent is a finite number string");
    assert.equal(typeof r.result.acceptable, "boolean");
  });

  it("circuitTrace: poisoned wireRunFeet + non-array devices sanitise (no NaN leak)", () => {
    const r = callViaCodeCalc("circuitTrace", ctxA, {
      circuits: [
        { name: "C", panel: "Main", breaker: "20A", room: "K", devices: "not-an-array", wireRunFeet: Infinity },
        { name: "D", room: "", devices: NaN, wireRunFeet: "abc" },
      ],
    });
    assert.equal(r.ok, true);
    for (const c of r.result.circuitMap) {
      assert.ok(FINITE(c.wireRun) && c.wireRun >= 0, `wireRun finite & ≥0, got ${c.wireRun}`);
      assert.ok(Array.isArray(c.devices), "devices coerced to array");
    }
    assert.ok(FINITE(r.result.avgDevicesPerCircuit), "avg devices finite");
  });

  it("conduitFill: negative / NaN / Infinity conductor counts never leak negative area", () => {
    const r = callViaCalculators("conduitFill", ctxA, {
      conductors: [{ awg: 12, count: -3 }, { awg: 10, count: NaN }, { awg: 8, count: Infinity }],
    });
    assert.equal(r.ok, true);
    assert.ok(FINITE(r.result.totalConductors) && r.result.totalConductors >= 0,
      `totalConductors finite & ≥0, got ${r.result.totalConductors}`);
    assert.ok(FINITE(r.result.totalConductorArea) && r.result.totalConductorArea >= 0,
      `totalConductorArea finite & ≥0, got ${r.result.totalConductorArea}`);
    for (const d of r.result.conductors) {
      assert.ok(FINITE(d.count) && d.count >= 1, `per-conductor count ≥1, got ${d.count}`);
      assert.ok(FINITE(d.areaTotal) && d.areaTotal >= 0, "per-conductor area finite & ≥0");
    }
  });

  it("boxFill: Infinity box volume never fabricates a PASS on an unverifiable box", () => {
    const r = callViaCalculators("boxFill", ctxA, {
      largestAwg: 14, currentCarrying: 4, devices: 1, internalClamps: true,
      boxVolumeCubicInches: Infinity,
    });
    assert.equal(r.ok, true);
    // Infinity sanitises to 0 → treated as "no volume entered" → pass:null, NOT true.
    assert.ok(FINITE(r.result.providedBoxVolume), "providedBoxVolume finite");
    assert.notEqual(r.result.pass, true, "must never fake-PASS on a non-finite box volume");
    assert.ok(FINITE(r.result.requiredBoxVolume), "requiredBoxVolume finite");
    assert.ok(FINITE(r.result.totalConductorEquivalents), "equivalents finite");
  });

  it("boxFill: negative counts clamp to 0, never producing a negative required volume", () => {
    const r = callViaCalculators("boxFill", ctxA, {
      largestAwg: 14, currentCarrying: -5, groundConductors: -2, devices: -1,
      supportFittings: NaN, boxVolumeCubicInches: 20,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.requiredBoxVolume >= 0, "required volume never negative");
    assert.ok(FINITE(r.result.requiredBoxVolume));
  });

  it("wireSize: a poisoned load fails CLOSED — no fabricated wire/breaker recommendation", () => {
    for (const bad of [Infinity, NaN, "abc", -10]) {
      const r = callViaCalculators("wireSize", ctxA, { loadAmps: bad, distanceFeet: 50, voltage: 120 });
      assert.equal(r.ok, true, `wireSize(${String(bad)}) must not crash`);
      assert.match(String(r.result.message), /Enter the circuit load/i,
        `wireSize(${String(bad)}) must return the honest prompt, not a fake wire`);
      assert.equal(r.result.recommendedWire, undefined, `no fabricated wire for ${String(bad)}`);
    }
  });

  it("wireSize: poisoned distance/voltage with a VALID load yields a finite design + drop", () => {
    const r = callViaCalculators("wireSize", ctxA, {
      loadAmps: 30, continuous: true, distanceFeet: Infinity, voltage: NaN,
    });
    assert.equal(r.ok, true);
    assert.ok(FINITE(r.result.designAmps), "designAmps finite");
    assert.ok(FINITE(parseFloat(r.result.voltageDropAtRecommended)) ||
      r.result.voltageDropAtRecommended === "n/a", "drop finite or n/a");
    assert.ok(FINITE(r.result.recommendedAmpacity), "recommendedAmpacity finite");
  });
});

/* ───── DEGRADE-GRACEFUL: the calculators are STATELESS — compute w/ STATE gone ───── */

describe("electrical lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("every pure NEC calculator still computes with STATE absent (never throws)", () => {
    const cases = [
      () => callViaCodeCalc("loadCalculation", ctxA, { circuits: [{ name: "x", watts: 1200, voltage: 120 }] }),
      () => callViaCodeCalc("voltageDropCalc", ctxA, { amps: 15, distanceFeet: 50, wireGauge: 12, voltage: 120 }),
      () => callViaCodeCalc("circuitTrace", ctxA, { circuits: [{ name: "c", room: "K", devices: ["r"], wireRunFeet: 20 }] }),
      () => callViaCodeCalc("safetyInspection", ctxA, { inspectionItems: [{ name: "i", necCode: "210.8", passed: true }] }),
      () => callViaCalculators("conduitFill", ctxA, { conductors: [{ awg: 12, count: 3 }] }),
      () => callViaCalculators("boxFill", ctxA, { largestAwg: 14, currentCarrying: 4, devices: 1, boxVolumeCubicInches: 18 }),
      () => callViaCalculators("wireSize", ctxA, { loadAmps: 30, distanceFeet: 50, voltage: 240 }),
    ];
    for (const fn of cases) {
      let r;
      assert.doesNotThrow(() => { r = fn(); }, "stateless calculator must not throw when STATE is gone");
      assert.equal(r.ok, true, "stateless calculator computes regardless of STATE");
    }
  });

  it("the STATE-backed persistence macros fail-soft {ok:false} (no throw)", () => {
    const stateBacked = [
      ["panelList", {}], ["panelCreate", { name: "P" }],
      ["estimateList", {}], ["invoiceList", {}],
      ["checklistList", {}], ["diagramList", {}], ["priceListGet", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.match(String(r.error), /state unavailable/i, `${name} error message`);
    }
  });
});
