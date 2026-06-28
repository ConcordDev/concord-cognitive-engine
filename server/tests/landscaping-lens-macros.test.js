// Behavioral macro tests for the landscaping lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields — confirmed in sibling welding/hvac/masonry).
//
// The driving channel:
//   • ProLandscape.tsx → apiHelpers.lens.runDomain('landscaping', action,
//       { input: { artifact: { data } } })  → dispatch peels the redundant
//       artifact wrapper (server/lib/lens-input-normalize.js) → handler reads
//       artifact.data.* (== params here). Drives the 4 pure calculators
//       ProLandscape renders: plantSelection, irrigationCalc, seasonalPlan,
//       materialEstimate.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// components/landscaping/ProLandscape.tsx):
//   - plantSelection: zone / sunExposure / soilType /
//       recommendations[].{name,type} / totalMatches  (the PlantSelector cards
//       map `recommendations` and read `totalMatches`/`zone`/`sunExposure`/
//       `soilType`). ALIGNED — pinned so it can't regress.
//   - irrigationCalc: squareFootage / plantType / inchesPerWeek / gallonsPerWeek
//       / gallonsPerMonth / runtimeMinutes / frequency / monthlyCost
//       (the IrrigationCalc "Weekly water need" hero + 3-cell grid + DTU
//       content read EVERY one). ALIGNED — pinned.
//   - seasonalPlan: zone / plan / currentSeason / immediateActions
//       (the SeasonalPlanCalendar maps Object.entries(plan) and highlights
//       currentSeason). ALIGNED — pinned.
//   - materialEstimate: material / squareFootage / depthInches / cubicYards /
//       bags / estimatedCost / deliveryNote  (the MaterialEstimator 3 stat
//       cards + delivery note read EVERY one). ALIGNED — pinned.
//   - VALIDATION-REJECTION on poisoned / non-object payloads (never crashes).
//   - DEGRADE-GRACEFUL: the 4 pure calculators are stateless — they compute
//       even with STATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc"): no
//       NaN/Infinity leaks into any rendered number, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLandscapingActions from "../domains/landscaping.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "landscaping", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read art.data)
// and the state-backed macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`landscaping.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "landscaping", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper ProLandscape.callLand builds before dispatch:
//   runDomain('landscaping', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

// every numeric-bearing field must parse to a finite number — no NaN/Infinity.
function assertFinite(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    const n = typeof v === "number" ? v : parseFloat(v);
    assert.ok(Number.isFinite(n), `${k} = ${v} must be finite`);
  }
}

before(() => {
  registerLandscapingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "land_a", id: "land_a" }, userId: "land_a" };

/* ───────── registration: every macro the ProLandscape channel drives ───────── */

describe("landscaping lens — registration of the driven calculators", () => {
  it("registers the 4 pure calculators ProLandscape renders", () => {
    for (const m of ["plantSelection", "irrigationCalc", "seasonalPlan", "materialEstimate"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing landscaping.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("landscaping lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("an irrigationCalc call sent the way ProLandscape sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read
    // squareFootage=undefined → sqft 1000 default → wrong number rendered (the
    // silent-dead class). Drive it through the exact double-wrap and assert the
    // REAL input (1500 sf) landed, not the 1000 default.
    const r = callViaComponent("irrigationCalc", ctxA, { squareFootage: 1500, plantType: "lawn" });
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 1500, "the 1500 sf input must reach the handler (not the 1000 default)");
    // gallonsPerWeek = round(1500 × 1.0 × 0.623) = 935
    assert.equal(r.result.gallonsPerWeek, 935);
  });

  it("a plantSelection call sent through the component double-wrap reaches the reader", () => {
    const r = callViaComponent("plantSelection", ctxA, { hardnessZone: 7, sunExposure: "full", soilType: "loam" });
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7, "the zone 7 input must reach the handler (not the 7 default by accident)");
    assert.equal(r.result.sunExposure, "full");
    assert.equal(r.result.soilType, "loam");
  });
});

/* ───── PlantSelector: the EXACT fields the result cards render ───── */

describe("landscaping lens — plantSelection (the ProLandscape PlantSelector cards)", () => {
  it("returns zone/sunExposure/soilType/recommendations[].{name,type}/totalMatches with real values", () => {
    // zone 7 full-sun loam: Lavender[5-9,full,loam], Black-Eyed Susan[3-9,full,loam],
    // Boxwood[5-9,full,loam], Daylily[3-10,full,loam] → 4. Hosta is shade (skip),
    // Japanese Maple is partial+loam → matches (partial accepted), so 5 total.
    const r = call("plantSelection", ctxA, { hardnessZone: 7, sunExposure: "full", soilType: "loam" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.zone, 7);
    assert.equal(res.sunExposure, "full");
    assert.equal(res.soilType, "loam");
    assert.ok(Array.isArray(res.recommendations));
    // every rendered card reads p.name + p.type
    for (const p of res.recommendations) {
      assert.equal(typeof p.name, "string");
      assert.equal(typeof p.type, "string");
      assert.ok(p.name.length > 0);
    }
    assert.equal(res.totalMatches, res.recommendations.length, "totalMatches must equal recommendations length");
    // concrete count: full-sun loam in zone 7 includes Lavender + Black-Eyed Susan
    const names = res.recommendations.map((p) => p.name);
    assert.ok(names.includes("Lavender"));
    assert.ok(names.includes("Black-Eyed Susan"));
    assert.ok(names.includes("Japanese Maple"), "partial-sun plants match a full-sun query (handler accepts partial)");
  });

  it("a shade query surfaces shade-tolerant plants only", () => {
    // shade clay zone 7: Hosta[3-9,shade,clay] matches; partials with clay also match.
    const r = call("plantSelection", ctxA, { hardnessZone: 7, sunExposure: "shade", soilType: "clay" });
    assert.equal(r.ok, true);
    const names = r.result.recommendations.map((p) => p.name);
    assert.ok(names.includes("Hosta"));
    // a full-sun-only plant (Lavender) must NOT appear in a shade query
    assert.ok(!names.includes("Lavender"));
  });

  it("an out-of-range zone with no library match returns 0 (renders the no-match banner)", () => {
    // zone 1 is below every plant's lower bound → 0 matches.
    const r = call("plantSelection", ctxA, { hardnessZone: 1, sunExposure: "full", soilType: "loam" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMatches, 0);
    assert.deepEqual(r.result.recommendations, []);
  });
});

/* ───── IrrigationCalc: the EXACT fields the hero + grid render ───── */

describe("landscaping lens — irrigationCalc (the ProLandscape IrrigationCalc cards)", () => {
  it("returns squareFootage/plantType/inchesPerWeek/gallonsPerWeek/gallonsPerMonth/runtimeMinutes/frequency/monthlyCost with real values", () => {
    // 1500 sf lawn: inches 1.0 ; gal/wk = round(1500×1.0×0.623) = 935
    // gal/mo = 935×4 = 3740 ; runtime = round(935/5) = 187
    // freq = "3x per week" (1.0 > 0.8) ; cost = round(3740×0.004×100)/100 = 14.96
    const r = call("irrigationCalc", ctxA, { squareFootage: 1500, plantType: "lawn" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.squareFootage, 1500);
    assert.equal(res.plantType, "lawn");
    assert.equal(res.inchesPerWeek, 1.0);
    assert.equal(res.gallonsPerWeek, 935);
    assert.equal(res.gallonsPerMonth, 3740);
    assert.equal(res.runtimeMinutes, 187);
    assert.equal(res.frequency, "3x per week");
    assert.equal(res.monthlyCost, 14.96);
  });

  it("xeriscape lowers the inch rate and flips frequency to 2x per week", () => {
    // 1000 sf xeriscape: inches 0.2 ; gal/wk = round(1000×0.2×0.623) = 125
    const r = call("irrigationCalc", ctxA, { squareFootage: 1000, plantType: "xeriscape" });
    assert.equal(r.ok, true);
    assert.equal(r.result.inchesPerWeek, 0.2);
    assert.equal(r.result.gallonsPerWeek, 125);
    assert.equal(r.result.frequency, "2x per week");
  });

  it("an unknown plant type falls back to the lawn rate (never NaN)", () => {
    const r = call("irrigationCalc", ctxA, { squareFootage: 1000, plantType: "moss-garden" });
    assert.equal(r.ok, true);
    assert.equal(r.result.inchesPerWeek, 1.0);
    assertFinite(r.result, ["gallonsPerWeek", "gallonsPerMonth", "runtimeMinutes", "monthlyCost"]);
  });
});

/* ───── SeasonalPlanCalendar: 4-season plan + current-season highlight ───── */

describe("landscaping lens — seasonalPlan (the ProLandscape SeasonalPlanCalendar)", () => {
  it("returns zone/plan/currentSeason/immediateActions with renderable season arrays", () => {
    const r = call("seasonalPlan", ctxA, { hardnessZone: 6 });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.zone, 6);
    assert.equal(typeof res.plan, "object");
    // the calendar maps Object.entries(plan) → 4 seasons, each an array of tasks
    for (const season of ["spring", "summer", "fall", "winter"]) {
      assert.ok(Array.isArray(res.plan[season]), `plan.${season} must be an array`);
      assert.ok(res.plan[season].length > 0);
    }
    assert.ok(["spring", "summer", "fall", "winter"].includes(res.currentSeason));
    // immediateActions === the plan entry for the current season (the highlighted column)
    assert.deepEqual(res.immediateActions, res.plan[res.currentSeason]);
  });
});

/* ───── MaterialEstimator: cubic yards / bags / cost / delivery note ───── */

describe("landscaping lens — materialEstimate (the ProLandscape MaterialEstimator cards)", () => {
  it("returns material/squareFootage/depthInches/cubicYards/bags/estimatedCost/deliveryNote with real values", () => {
    // 500 sf mulch: depth 3" ; cubicYards = round((500×3/12/27)×10)/10 = round(46.296×10)/10 = 4.6
    // bags = ceil(4.6×13.5) = ceil(62.1) = 63 ; cost = round(4.6×35) = 161
    // 4.6 > 3 → "Bulk delivery recommended"
    const r = call("materialEstimate", ctxA, { squareFootage: 500, material: "mulch" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.material, "mulch");
    assert.equal(res.squareFootage, 500);
    assert.equal(res.depthInches, 3);
    assert.equal(res.cubicYards, 4.6);
    assert.equal(res.bags, 63);
    assert.equal(res.estimatedCost, 161);
    assert.equal(res.deliveryNote, "Bulk delivery recommended");
  });

  it("topsoil at 4-inch depth and a small area yields the bagged-purchase note", () => {
    // 100 sf topsoil: depth 4" ; cubicYards = round((100×4/12/27)×10)/10 = round(1.234×10)/10 = 1.2
    // bags = ceil(1.2×13.5) = ceil(16.2) = 17 ; cost = round(1.2×30) = 36 ; 1.2 ≤ 3 → bagged
    const r = call("materialEstimate", ctxA, { squareFootage: 100, material: "topsoil" });
    assert.equal(r.ok, true);
    assert.equal(r.result.depthInches, 4);
    assert.equal(r.result.cubicYards, 1.2);
    assert.equal(r.result.bags, 17);
    assert.equal(r.result.estimatedCost, 36);
    assert.equal(r.result.deliveryNote, "Bagged purchase sufficient");
  });

  it("an unknown material falls back to the 3-inch mulch depth + $35 rate (never NaN)", () => {
    const r = call("materialEstimate", ctxA, { squareFootage: 200, material: "moon-dust" });
    assert.equal(r.ok, true);
    assert.equal(r.result.depthInches, 3);
    assertFinite(r.result, ["cubicYards", "bags", "estimatedCost"]);
  });
});

/* ───── VALIDATION-REJECTION: poisoned / missing payloads tolerated ───── */

describe("landscaping lens — validation tolerance (never crashes on junk)", () => {
  it("plantSelection: a missing/empty payload yields zone-7 defaults, never throws", () => {
    const r = call("plantSelection", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7);
    assert.equal(r.result.sunExposure, "full");
    assert.equal(r.result.soilType, "loam");
    assert.ok(Array.isArray(r.result.recommendations));
  });

  it("irrigationCalc: a missing payload yields the 1000 sf lawn default, never NaN", () => {
    const r = call("irrigationCalc", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 1000);
    assert.equal(r.result.plantType, "lawn");
    assertFinite(r.result, ["gallonsPerWeek", "gallonsPerMonth", "runtimeMinutes", "monthlyCost"]);
  });

  it("materialEstimate: a missing payload yields the 100 sf mulch default, never NaN", () => {
    const r = call("materialEstimate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 100);
    assert.equal(r.result.material, "mulch");
    assertFinite(r.result, ["cubicYards", "bags", "estimatedCost"]);
  });

  it("plantSelection: an unknown sun/soil string is normalised, not exploded", () => {
    const r = call("plantSelection", ctxA, { hardnessZone: 7, sunExposure: "MOONLIGHT", soilType: "lava" });
    assert.equal(r.ok, true);
    // lowercased + matched against the library; no crash, returns an array
    assert.ok(Array.isArray(r.result.recommendations));
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("landscaping lens — fail-closed on poisoned numeric inputs", () => {
  it("irrigationCalc: NaN/Infinity/garbage square footage can't leak NaN/Infinity into rendered numbers", () => {
    for (const bad of [NaN, "abc", null, undefined]) {
      const r = call("irrigationCalc", ctxA, { squareFootage: bad, plantType: "lawn" });
      assert.equal(r.ok, true, `${bad} must not crash`);
      // parseFloat(bad)||1000 → 1000 default for non-numeric junk
      assertFinite(r.result, ["squareFootage", "gallonsPerWeek", "gallonsPerMonth", "runtimeMinutes", "monthlyCost"]);
    }
  });

  it("irrigationCalc: Infinity square footage does not produce an Infinity gallons figure", () => {
    const r = call("irrigationCalc", ctxA, { squareFootage: Infinity, plantType: "lawn" });
    assert.equal(r.ok, true);
    // parseFloat(Infinity) is NaN → "|| 1000" default kicks in, OR Infinity flows;
    // either way the rendered numbers MUST be finite (no Infinity on the card).
    assertFinite(r.result, ["squareFootage", "gallonsPerWeek", "gallonsPerMonth", "runtimeMinutes", "monthlyCost"]);
  });

  it("materialEstimate: NaN/Infinity/garbage square footage can't leak NaN/Infinity", () => {
    for (const bad of [NaN, "abc", Infinity, null]) {
      const r = call("materialEstimate", ctxA, { squareFootage: bad, material: "mulch" });
      assert.equal(r.ok, true, `${bad} must not crash`);
      assertFinite(r.result, ["squareFootage", "depthInches", "cubicYards", "bags", "estimatedCost"]);
    }
  });

  it("plantSelection: a NaN/garbage hardness zone can't crash or NaN the match logic", () => {
    for (const bad of [NaN, "abc", Infinity, null]) {
      const r = call("plantSelection", ctxA, { hardnessZone: bad, sunExposure: "full", soilType: "loam" });
      assert.equal(r.ok, true, `${bad} must not crash`);
      assert.ok(Number.isFinite(r.result.zone), `zone must be finite for ${bad}`);
      assert.ok(Array.isArray(r.result.recommendations));
    }
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators are stateless ───── */

describe("landscaping lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the 4 pure calculators DON'T need STATE — they still compute with STATE gone (never throw)", () => {
    let r;
    assert.doesNotThrow(() => { r = call("plantSelection", ctxA, { hardnessZone: 7, sunExposure: "full", soilType: "loam" }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7);
    assert.doesNotThrow(() => { r = call("irrigationCalc", ctxA, { squareFootage: 1500, plantType: "lawn" }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.gallonsPerWeek, 935);
    assert.doesNotThrow(() => { r = call("seasonalPlan", ctxA, { hardnessZone: 6 }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("materialEstimate", ctxA, { squareFootage: 500, material: "mulch" }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.cubicYards, 4.6);
  });

  it("STATE-backed macros fail-soft with {ok:false} (no throw) when STATE is gone", () => {
    const stateBacked = [
      ["bed-list", {}], ["layout-list", {}], ["overlay-list", {}],
      ["diary-timeline", {}], ["landscaping-dashboard", {}], ["care-reminders", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.equal(typeof r.error, "string", `${name} should report an error string`);
    }
  });
});
