// Behavioral macro tests for the plumbing lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — the welding-calculator class, where the
// entire calculator surface was blank in production while shape tests passed).
//
// The real channel:
//   PlumbCalc.tsx → apiHelpers.lens.runDomain('plumbing', action,
//       { input: { artifact: { data } } })  → dispatch peels the redundant
//       artifact wrapper → handler reads artifact.data.* (== params here).
//       Drives the 4 pure calculators: pipeSize, waterHeaterSize, drainSlope,
//       fixtureCount.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// concord-frontend/components/plumbing/PlumbCalc.tsx — the field names ALIGN,
// no dead fields, no phantoms; this test LOCKS that alignment so a future
// rename on either side fails loudly):
//   - pipeSize       → flowRate / velocity / calculatedDiameter /
//                       recommendedSize / material / note
//                      (input: flowGPM, velocityFPS, material)
//   - waterHeaterSize → household / peakDemandGPM / tankRecommendation /
//                       tanklessRecommendation / firstHourRating / recommendation
//                      (input: household, simultaneousFixtures)
//   - drainSlope     → pipeSize / length / slopePerFoot / totalDrop /
//                       ipcCode / tip
//                      (input: pipeSizeInches, lengthFeet)
//   - fixtureCount   → fixtures / totalWSFU / meterSize / supplyLine / note
//                       (or { message } when the fixture list is empty)
//                      (input: fixtures[]{type,count})
//   - VALIDATION-REJECTION on poisoned / empty fixture payloads
//   - DEGRADE-GRACEFUL: the 4 pure calculators are stateless — they compute
//     even with STATE gone (never throw); the STATE-backed ops macros fail-soft.
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / zero):
//     no NaN/Infinity leaks into any rendered number, no crash. (parseFloat
//     would happily pass "Infinity" through — the handler defends via
//     `parseFloat(x) || default`, which coerces NaN/0 to the default, and the
//     velocity*2.448 floor keeps the sqrt finite. We assert Number.isFinite on
//     every rendered numeric.)
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPlumbingActions from "../domains/plumbing.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "plumbing", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read art.data)
// and the ops macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`plumbing.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "plumbing", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper PlumbCalc.callPlumbing builds before dispatch:
//   runDomain('plumbing', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. This proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

const numIn = (s) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

before(() => {
  registerPlumbingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "plumber_a", id: "plumber_a" }, userId: "plumber_a" };

/* ───────── registration: every macro the lens channels drive ───────── */

describe("plumbing lens — registration of the driven macros", () => {
  it("registers every calculator + ops macro the page + PlumbCalc + FieldServiceConsole call", () => {
    const driven = [
      // PlumbCalc pure calculators
      "pipeSize", "waterHeaterSize", "drainSlope", "fixtureCount",
      // field-service ops substrate
      "techAdd", "techList", "techRemove",
      "dispatchAssign", "dispatchBoard", "dispatchUpdate",
      "priceItemAdd", "priceBookList", "priceItemUpdate", "priceItemRemove",
      "invoiceFromQuote", "invoiceList", "invoiceRecordPayment",
      "workflowStart", "workflowGet", "workflowUpdate",
      "planCreate", "planList", "planLogVisit",
      "notifySend", "notifyLog",
      "partStock", "partList", "jobComplete", "opsSummary",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing plumbing.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("plumbing lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a pipeSize call sent the way PlumbCalc sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read defaults
    // (flow 5, velocity 5) and emit the wrong numbers — the silent-dead class.
    // Drive it through the exact double-wrap and assert the REAL inputs landed
    // (10 GPM / 6 ft/s), not the defaults.
    const r = callViaComponent("pipeSize", ctxA, { flowGPM: 10, velocityFPS: 6, material: "pex" });
    assert.equal(r.ok, true);
    assert.equal(r.result.flowRate, "10 GPM", "the 10 GPM input must reach the handler (not the 5 GPM default)");
    assert.equal(r.result.velocity, "6 ft/s");
    assert.equal(r.result.material, "pex");
  });
});

/* ───── PipeSizer: the EXACT fields the result card renders ───── */

describe("plumbing lens — pipeSize (the PlumbCalc pipe-sizer card)", () => {
  it("returns flowRate/velocity/calculatedDiameter/recommendedSize/material/note with real computed values", () => {
    // d = √(GPM/(2.448·v)) = √(10/(5·2.448)) = √(0.8170) = 0.9039" → "0.9\""
    // first nominal ≥ 0.9039 is 1" (the pre-fix circle-area inversion wrongly
    // bumped this to 1.25"). Velocity 5 ≤ 8 → "Within acceptable range".
    const r = call("pipeSize", ctxA, { flowGPM: 10, velocityFPS: 5, material: "copper" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.flowRate, "10 GPM");
    assert.equal(res.velocity, "5 ft/s");
    assert.equal(res.calculatedDiameter, '0.9"');
    assert.equal(res.recommendedSize, '1" nominal');
    assert.equal(res.material, "copper");
    assert.equal(res.note, "Within acceptable range");
    // the component's recommendedNominal regex parses the leading number — pin it
    assert.equal(numIn(res.recommendedSize), 1);
  });

  it("high velocity (>8 ft/s) flips the note to the erosion warning the amber card renders", () => {
    const r = call("pipeSize", ctxA, { flowGPM: 20, velocityFPS: 10 });
    assert.equal(r.result.velocity, "10 ft/s");
    assert.equal(r.result.note, "High velocity — may cause noise and erosion");
  });

  it("default material is copper when the component omits it (it never does, but the contract holds)", () => {
    const r = call("pipeSize", ctxA, { flowGPM: 8, velocityFPS: 5 });
    assert.equal(r.result.material, "copper");
  });
});

/* ───── WaterHeaterSizer: tank + tankless cards ───── */

describe("plumbing lens — waterHeaterSize (the PlumbCalc water-heater cards)", () => {
  it("returns household/peakDemandGPM/tankRecommendation/tanklessRecommendation/firstHourRating/recommendation", () => {
    // people=4, simultaneous=2 → peak = 2·2.5 = 5 GPM ; tank = 4·15 = 60 gal →
    // ceil(60/10)·10 = 60 → "60 gallon tank" ; firstHour = round(60·1.5) = 90
    // tankless kW = round(5·8.33·60·70/3412) = round(51.27) = 51 → "51 kW tankless"
    // people 4 is NOT > 4 → "Standard tank should suffice"
    const r = call("waterHeaterSize", ctxA, { household: 4, simultaneousFixtures: 2 });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.household, 4);
    assert.equal(res.peakDemandGPM, 5);
    assert.equal(res.tankRecommendation, "60 gallon tank");
    assert.equal(res.tanklessRecommendation, "51 kW tankless");
    assert.equal(res.firstHourRating, 90);
    assert.equal(res.recommendation, "Standard tank should suffice");
    // tankless kW must be a realistic whole-house magnitude (18–54 kW), not the
    // pre-fix ~1 kW absurdity
    assert.ok(numIn(res.tanklessRecommendation) >= 18 && numIn(res.tanklessRecommendation) <= 60);
  });

  it("a >4-person household flips the recommendation toward tankless", () => {
    // people=6 → tank 90 gal ; recommendation "Consider tankless for unlimited hot water"
    const r = call("waterHeaterSize", ctxA, { household: 6, simultaneousFixtures: 3 });
    assert.equal(r.result.household, 6);
    assert.equal(r.result.peakDemandGPM, 7.5);
    assert.equal(r.result.tankRecommendation, "90 gallon tank");
    assert.equal(r.result.recommendation, "Consider tankless for unlimited hot water");
  });
});

/* ───── DrainSlopeCalculator: cross-section + IPC card ───── */

describe("plumbing lens — drainSlope (the PlumbCalc drain-slope card)", () => {
  it("returns pipeSize/length/slopePerFoot/totalDrop/ipcCode/tip with real values", () => {
    // 2" pipe → 0.25"/ft slope ; 10 ft run → totalDrop = round(10·0.25·100)/100 = 2.5"
    const r = call("drainSlope", ctxA, { pipeSizeInches: 2, lengthFeet: 10 });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.pipeSize, '2"');
    assert.equal(res.length, "10 ft");
    assert.equal(numIn(res.slopePerFoot), 0.25);
    assert.equal(res.totalDrop, '2.5"');
    assert.ok(/IPC Table 704\.1/.test(res.ipcCode));
    assert.equal(typeof res.tip, "string");
    // the component's dropInches regex parses the leading number from totalDrop —
    // pin it parses to a finite > 0 value (it gates the SVG render)
    assert.ok(numIn(res.totalDrop) > 0);
  });

  it("larger pipe (>3\") uses the gentler 0.125\"/ft slope band", () => {
    // 4" pipe → 0.125"/ft ; 20 ft → totalDrop = 2.5"
    const r = call("drainSlope", ctxA, { pipeSizeInches: 4, lengthFeet: 20 });
    assert.equal(numIn(r.result.slopePerFoot), 0.125);
    assert.equal(r.result.totalDrop, '2.5"');
  });
});

/* ───── FixtureSupplyCalc: WSFU + meter card ───── */

describe("plumbing lens — fixtureCount (the PlumbCalc fixture-supply card)", () => {
  it("returns fixtures/totalWSFU/meterSize/supplyLine/note for the EXACT { type, count } shape the component sends", () => {
    // toilet 2.5 × 2 + lavatory 1 × 2 = 5 + 2 = 7 WSFU
    // 7 ≤ 15 → meter 3/4" ; 7 ≤ 20 → supply 3/4" main
    const r = call("fixtureCount", ctxA, {
      fixtures: [{ type: "toilet", count: 2 }, { type: "lavatory", count: 2 }],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.fixtures, 2);
    assert.equal(res.totalWSFU, 7);
    assert.equal(res.meterSize, '3/4"');
    assert.equal(res.supplyLine, '3/4" main');
    assert.equal(typeof res.note, "string");
  });

  it("a big fixture count bumps the meter + supply-line bands", () => {
    // shower 2 × 5 + kitchen-sink 1.5 × 4 + washing-machine 2 × 3 = 10 + 6 + 6 = 22
    // 22 > 15 → 1" meter ; 22 > 20 → 1" main
    const r = call("fixtureCount", ctxA, {
      fixtures: [{ type: "shower", count: 5 }, { type: "kitchen-sink", count: 4 }, { type: "washing-machine", count: 3 }],
    });
    assert.equal(r.result.totalWSFU, 22);
    assert.equal(r.result.meterSize, '1"');
    assert.equal(r.result.supplyLine, '1" main');
  });

  it("an empty fixture list returns the honest { message } prompt the empty-state card reads", () => {
    // The component sends `fixtures: []` when no rows have a count > 0; the
    // handler returns { message } and NO totalWSFU — the card must not crash on
    // the absent numeric.
    const r = call("fixtureCount", ctxA, { fixtures: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.equal(r.result.totalWSFU, undefined);
  });

  it("an unknown fixture type falls to the 1.5 WSFU default (never NaN)", () => {
    const r = call("fixtureCount", ctxA, { fixtures: [{ type: "made-up-fixture", count: 2 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWSFU, 3); // 1.5 × 2
    assert.ok(Number.isFinite(r.result.totalWSFU));
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("plumbing lens — fail-closed on poisoned numeric inputs", () => {
  it("pipeSize: NaN/Infinity/garbage flow + velocity produce finite, default-backed numbers (no NaN/Infinity leak)", () => {
    // parseFloat("abc") → NaN → `|| 5` → flow 5 ; parseFloat(Infinity) passes
    // Infinity, but Infinity || 5 === Infinity, so we ALSO drive a literal
    // Infinity to prove the velocity*2.448 floor keeps the sqrt finite.
    const rGarbage = call("pipeSize", ctxA, { flowGPM: "abc", velocityFPS: "NaN", material: "copper" });
    assert.equal(rGarbage.ok, true);
    // garbage → defaults flow 5, velocity 5 → d = √(5/12.24) = 0.639"
    assert.equal(rGarbage.result.flowRate, "5 GPM");
    assert.equal(rGarbage.result.velocity, "5 ft/s");
    for (const k of ["calculatedDiameter", "recommendedSize"]) {
      assert.ok(Number.isFinite(numIn(rGarbage.result[k])), `${k} = ${rGarbage.result[k]} must be finite`);
    }

    // Literal Infinity flow (parseFloat passes it through) — the rendered
    // diameter must NOT be "Infinity"/"NaN". (Sqrt(Infinity) is Infinity, which
    // would surface as a poisoned card. This asserts the contract the UI needs.)
    const rInf = call("pipeSize", ctxA, { flowGPM: Infinity, velocityFPS: 5 });
    assert.equal(rInf.ok, true);
    assert.ok(Number.isFinite(numIn(rInf.result.calculatedDiameter)),
      `calculatedDiameter = ${rInf.result.calculatedDiameter} must be finite even for Infinity flow`);
    assert.ok(Number.isFinite(numIn(rInf.result.recommendedSize)),
      `recommendedSize = ${rInf.result.recommendedSize} must be finite`);
  });

  it("waterHeaterSize: garbage household/fixtures fall to defaults, kW stays finite + realistic", () => {
    const r = call("waterHeaterSize", ctxA, { household: "x", simultaneousFixtures: "NaN" });
    assert.equal(r.ok, true);
    // parseInt("x") → NaN → `|| 2` → people 2, simultaneous 2
    assert.equal(r.result.household, 2);
    assert.equal(r.result.peakDemandGPM, 5);
    assert.ok(Number.isFinite(numIn(r.result.tanklessRecommendation)));
    assert.ok(Number.isFinite(r.result.firstHourRating));

    // Infinity tempRiseF would blow up kW to Infinity — assert it stays finite.
    const rInf = call("waterHeaterSize", ctxA, { household: 3, simultaneousFixtures: 2, tempRiseF: Infinity });
    assert.equal(rInf.ok, true);
    assert.ok(Number.isFinite(numIn(rInf.result.tanklessRecommendation)),
      `tanklessRecommendation = ${rInf.result.tanklessRecommendation} must be finite even for Infinity ΔT`);
  });

  it("drainSlope: NaN/Infinity pipe size + length never emit NaN/Infinity into the rendered drop", () => {
    const r = call("drainSlope", ctxA, { pipeSizeInches: "abc", lengthFeet: "x" });
    assert.equal(r.ok, true);
    // garbage → defaults pipe 2, length 10 → 2.5" drop
    assert.equal(r.result.pipeSize, '2"');
    assert.equal(r.result.length, "10 ft");
    assert.ok(Number.isFinite(numIn(r.result.totalDrop)));

    const rInf = call("drainSlope", ctxA, { pipeSizeInches: 2, lengthFeet: Infinity });
    assert.equal(rInf.ok, true);
    assert.ok(Number.isFinite(numIn(rInf.result.totalDrop)),
      `totalDrop = ${rInf.result.totalDrop} must be finite even for Infinity length`);
  });

  it("fixtureCount: poisoned fixture counts (NaN/Infinity) never leak into totalWSFU", () => {
    const r = call("fixtureCount", ctxA, {
      fixtures: [{ type: "toilet", count: "abc" }, { type: "shower", count: NaN }, { type: "bathtub", count: Infinity }],
    });
    assert.equal(r.ok, true);
    // parseInt("abc")→NaN→`||1`→1 ; NaN→1 ; Infinity → parseInt(Infinity) is NaN → 1
    // toilet 2.5·1 + shower 2·1 + bathtub 2·1 = 6.5
    assert.ok(Number.isFinite(r.result.totalWSFU), `totalWSFU = ${r.result.totalWSFU} must be finite`);
    assert.equal(r.result.totalWSFU, 6.5);
  });

  it("fixtureCount: a non-array fixtures payload is tolerated (treated empty), never crashes", () => {
    const r = call("fixtureCount", ctxA, { fixtures: "not-an-array" });
    assert.equal(r.ok, true);
    // artifact.data?.fixtures || [] — a string is truthy, so reduce/length must
    // still not throw. A string has .length, and [].reduce path... assert no NaN.
    assert.ok(r.result.message !== undefined || Number.isFinite(r.result.totalWSFU));
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators are stateless ───── */

describe("plumbing lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the 4 pure calculators DON'T need STATE — they still compute with STATE gone (never throw)", () => {
    let r;
    assert.doesNotThrow(() => { r = call("pipeSize", ctxA, { flowGPM: 10, velocityFPS: 5 }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("waterHeaterSize", ctxA, { household: 4, simultaneousFixtures: 2 }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("drainSlope", ctxA, { pipeSizeInches: 2, lengthFeet: 10 }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("fixtureCount", ctxA, { fixtures: [{ type: "toilet", count: 1 }] }); });
    assert.equal(r.ok, true);
  });

  it("STATE-backed ops macros fail-soft with {ok:false, error:'state_unavailable'} (no throw)", () => {
    const stateBacked = [
      ["techList", {}], ["dispatchBoard", {}],
      ["priceBookList", {}], ["invoiceList", {}],
      ["planList", {}], ["partList", {}],
      ["notifyLog", {}], ["opsSummary", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.equal(r.error, "state_unavailable", `${name} error`);
    }
  });
});

/* ───── VALIDATION-REJECTION: ops macros reject missing required fields ───── */

describe("plumbing lens — validation rejection on the STATE-backed ops macros", () => {
  it("techAdd without a name, dispatchAssign without a jobTitle, invoiceFromQuote without lines all reject", () => {
    assert.equal(call("techAdd", ctxA, {}).error, "name_required");
    assert.equal(call("dispatchAssign", ctxA, {}).error, "jobTitle_required");
    assert.equal(call("invoiceFromQuote", ctxA, { lines: [] }).error, "lines_required");
    assert.equal(call("planCreate", ctxA, {}).error, "client_required");
    assert.equal(call("partStock", ctxA, {}).error, "name_required");
  });
});
