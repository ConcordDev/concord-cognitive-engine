// Behavioral macro tests for the masonry lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surfaces drive,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields).
//
// The driving channel:
//   • MasonStuff.tsx → apiHelpers.lens.runDomain('masonry', action,
//       { input: { artifact: { data } } })  → dispatch peels the redundant
//       artifact wrapper → handler reads art.data.* (== params here).
//       Drives the 4 pure calculators rendered by MasonStuff:
//       materialEstimate, mortarMix, wallStrength, jobCosting.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result cards render (cross-checked field-for-field against
// components/masonry/MasonStuff.tsx after the 2026-06-28 alignment fix):
//   - materialEstimate: unitsNeeded / mortarBags80lb / materialCost /
//     mortarCost / totalMaterialCost / laborEstimate / grandTotal /
//     recommendation  (MaterialEstimator was DEAD: the card read result.units /
//     result.mortarBags — NEVER returned; the handler returns unitsNeeded /
//     mortarBags80lb. And it read result.recommendation, which the handler
//     never produced. Fixed: component reads the real fields; handler now
//     computes a real recommendation string.)
//   - mortarMix: type / ratio / strength / use / waterRatio / cureTime /
//     temperature  (already aligned — pinned so it can't regress)
//   - wallStrength: heightFeet / thicknessInches / slendernessRatio /
//     maxAllowedRatio / passesSlenderness / reinforced / loadBearing /
//     recommendation  (already aligned — pinned)
//   - jobCosting: items[].{item,laborHours,laborRate,laborCost,materialCost,
//     totalCost} / subtotalLabor / subtotalMaterials / overhead / profit /
//     grandTotal  (already aligned — pinned)
//   - VALIDATION-REJECTION on poisoned / non-array payloads (never crashes)
//   - DEGRADE-GRACEFUL: the 4 pure calculators are stateless — they compute
//     even with STATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc"): no
//     NaN/Infinity leaks into any rendered number, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMasonryActions from "../domains/masonry.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "masonry", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read art.data)
// and the state-backed macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`masonry.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "masonry", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper MasonStuff.callMason builds before dispatch:
//   runDomain('masonry', action, { input: { artifact: { data } } })
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
  registerMasonryActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "mason_a", id: "mason_a" }, userId: "mason_a" };

/* ───────── registration: every macro the MasonStuff channel drives ───────── */

describe("masonry lens — registration of the driven calculators", () => {
  it("registers the 4 pure calculators MasonStuff renders", () => {
    for (const m of ["materialEstimate", "mortarMix", "wallStrength", "jobCosting"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing masonry.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("masonry lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a materialEstimate call sent the way MasonStuff sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read
    // squareFootage=undefined → sqft 0 → zeros everywhere (the silent-dead
    // class). Drive it through the exact double-wrap and assert the REAL input
    // (200 sf) landed, not the empty default.
    const r = callViaComponent("materialEstimate", ctxA, { squareFootage: 200, material: "brick" });
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 200, "the 200 sf input must reach the handler (not the 0 default)");
    assert.equal(r.result.unitsNeeded, 1470);
  });
});

/* ───── MaterialEstimator: the EXACT fields the result cards render ───── */

describe("masonry lens — materialEstimate (the MasonStuff material-estimator cards)", () => {
  it("returns unitsNeeded/mortarBags80lb/materialCost/mortarCost/totalMaterialCost/laborEstimate/grandTotal/recommendation with real computed values", () => {
    // 200 sf brick: units = ceil(200×7×1.05) = 1470 ; mortarBags = ceil(200×0.02) = 4
    // materialCost = round(1470×0.75) = 1103 ; mortarCost = round(4×12) = 48
    // totalMaterial = 1151 ; labor = round(200×15) = 3000 ; grandTotal = 4151
    const r = call("materialEstimate", ctxA, { squareFootage: 200, material: "brick" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.material, "brick");
    assert.equal(res.squareFootage, 200);
    assert.equal(res.unitsNeeded, 1470);
    assert.equal(res.mortarBags80lb, 4);
    assert.equal(res.materialCost, 1103);
    assert.equal(res.mortarCost, 48);
    assert.equal(res.totalMaterialCost, 1151);
    assert.equal(res.laborEstimate, 3000);
    assert.equal(res.grandTotal, 4151);
    assert.equal(typeof res.recommendation, "string");
    assert.ok(res.recommendation.length > 0);
    // the OLD card fields the component used to (deadly) read must NOT exist
    assert.equal(res.units, undefined, "result.units was the dead field — must stay absent");
    assert.equal(res.mortarBags, undefined, "result.mortarBags was the dead field — must stay absent");
  });

  it("block + stone change the per-sqft rates the cards show", () => {
    // block: units = ceil(100×1.125×1.05) = ceil(118.125) = 119 ; mortarBags = ceil(100×0.03) = 3
    // materialCost = round(119×2.5) = 298 ; mortarCost = 36
    const blk = call("materialEstimate", ctxA, { squareFootage: 100, material: "block" }).result;
    assert.equal(blk.unitsNeeded, 119);
    assert.equal(blk.materialCost, 298);
    // stone: units = ceil(100×5×1.05) = 525 ; materialCost = round(525×8) = 4200
    const stn = call("materialEstimate", ctxA, { squareFootage: 100, material: "stone" }).result;
    assert.equal(stn.unitsNeeded, 525);
    assert.equal(stn.materialCost, 4200);
  });

  it("an unknown material falls back to the brick rate (never NaN)", () => {
    const r = call("materialEstimate", ctxA, { squareFootage: 100, material: "unobtanium" });
    assert.equal(r.ok, true);
    // brick rate: ceil(100×7×1.05) = 735
    assert.equal(r.result.unitsNeeded, 735);
    assertFinite(r.result, ["unitsNeeded", "mortarBags80lb", "materialCost", "grandTotal", "laborEstimate"]);
  });
});

/* ───── MortarMixReference: the EXACT recipe fields the card renders ───── */

describe("masonry lens — mortarMix (the MasonStuff mortar-mix card)", () => {
  it("returns type/ratio/strength/use/waterRatio/cureTime/temperature for a known application", () => {
    const r = call("mortarMix", ctxA, { application: "structural" });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.application, "structural");
    assert.equal(res.type, "Type S");
    assert.equal(typeof res.ratio, "string");
    assert.equal(res.strength, "1800 psi");
    assert.equal(typeof res.use, "string");
    assert.equal(typeof res.waterRatio, "string");
    assert.equal(typeof res.cureTime, "string");
    assert.equal(typeof res.temperature, "string");
  });

  it("an unknown application falls back to the general (Type N) recipe", () => {
    const r = call("mortarMix", ctxA, { application: "not-a-real-mode" });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "Type N");
  });

  it("repoint historic returns the low-strength Type O recipe", () => {
    assert.equal(call("mortarMix", ctxA, { application: "repoint" }).result.type, "Type O");
  });
});

/* ───── WallStrengthCheck: slenderness ratio + pass/fail + recommendation ───── */

describe("masonry lens — wallStrength (the MasonStuff wall-strength gauge)", () => {
  it("returns slendernessRatio/maxAllowedRatio/passesSlenderness/recommendation with real values", () => {
    // 8 ft × 8 in reinforced: (8×12)/8 = 12 ≤ 25 → pass
    const r = call("wallStrength", ctxA, { heightFeet: 8, thicknessInches: 8, reinforced: true, loadBearing: true });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.heightFeet, 8);
    assert.equal(res.thicknessInches, 8);
    assert.equal(res.slendernessRatio, 12);
    assert.equal(res.maxAllowedRatio, 25);
    assert.equal(res.passesSlenderness, true);
    assert.equal(res.reinforced, true);
    assert.equal(res.loadBearing, true);
    assert.equal(res.recommendation, "Wall dimensions are adequate");
  });

  it("an over-slender unreinforced wall fails with the increase-thickness recommendation", () => {
    // 30 ft × 6 in unreinforced: (30×12)/6 = 60 > 20 → fail
    const r = call("wallStrength", ctxA, { heightFeet: 30, thicknessInches: 6, reinforced: false });
    assert.equal(r.result.slendernessRatio, 60);
    assert.equal(r.result.maxAllowedRatio, 20);
    assert.equal(r.result.passesSlenderness, false);
    assert.match(r.result.recommendation, /too slender/i);
  });

  it("a near-limit wall surfaces the additional-reinforcement caution", () => {
    // reinforced max 25; want ratio in (20, 25]: 14 ft × 8 in → (14×12)/8 = 21
    const r = call("wallStrength", ctxA, { heightFeet: 14, thicknessInches: 8, reinforced: true });
    assert.equal(r.result.slendernessRatio, 21);
    assert.match(r.result.recommendation, /Near limit/i);
  });
});

/* ───── JobCosting: rolled-up labor + materials + overhead + profit ───── */

describe("masonry lens — jobCosting (the MasonStuff job-costing breakdown)", () => {
  it("returns items[].{item,laborHours,laborRate,laborCost,materialCost,totalCost} + subtotals + overhead + profit + grandTotal", () => {
    // 10h × $55 = 550 labor + 200 materials = 750 ; overhead = round(750×0.15) = 113
    // profit = round((750+113)×0.10) = 86 ; grand = 949
    const r = call("jobCosting", ctxA, { items: [{ name: "Pour", hours: 10, rate: 55, materialCost: 200 }] });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Array.isArray(res.items) && res.items.length === 1);
    const it = res.items[0];
    assert.equal(it.item, "Pour");
    assert.equal(it.laborHours, 10);
    assert.equal(it.laborRate, 55);
    assert.equal(it.laborCost, 550);
    assert.equal(it.materialCost, 200);
    assert.equal(it.totalCost, 750);
    assert.equal(res.subtotalLabor, 550);
    assert.equal(res.subtotalMaterials, 200);
    assert.equal(res.overhead, 113);
    assert.equal(res.profit, 86);
    assert.equal(res.grandTotal, 949);
  });

  it("an empty item list returns the add-items prompt, not a crash", () => {
    const r = call("jobCosting", ctxA, { items: [] });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });
});

/* ───── VALIDATION-REJECTION: poisoned / non-array payloads tolerated ───── */

describe("masonry lens — validation tolerance (never crashes on junk)", () => {
  it("jobCosting: a non-array items payload is tolerated (treated as empty)", () => {
    const r = call("jobCosting", ctxA, { items: "not-an-array" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("jobCosting: non-object entries are dropped, not exploded", () => {
    const r = call("jobCosting", ctxA, { items: [null, "junk", 42, { name: "Real", hours: 2, rate: 50, materialCost: 0 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 1);
    assert.equal(r.result.items[0].item, "Real");
  });

  it("materialEstimate: a missing/empty payload yields the zero-area prompt, never NaN", () => {
    const r = call("materialEstimate", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.squareFootage, 0);
    assert.equal(r.result.unitsNeeded, 0);
    assert.match(r.result.recommendation, /positive wall area/i);
    assertFinite(r.result, ["unitsNeeded", "mortarBags80lb", "materialCost", "grandTotal"]);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("masonry lens — fail-closed on poisoned numeric inputs", () => {
  it("materialEstimate: NaN/Infinity/garbage square footage floors to 0 (no NaN/Infinity leak)", () => {
    for (const bad of [Infinity, -Infinity, NaN, "abc", -50]) {
      const r = call("materialEstimate", ctxA, { squareFootage: bad, material: "brick" });
      assert.equal(r.ok, true, `${bad} must not crash`);
      assert.equal(r.result.squareFootage, 0, `${bad} must floor to 0`);
      assertFinite(r.result, ["unitsNeeded", "mortarBags80lb", "materialCost", "mortarCost", "totalMaterialCost", "laborEstimate", "grandTotal"]);
    }
  });

  it("wallStrength: Infinity/zero/garbage dimensions can't divide-by-zero into Infinity", () => {
    // Infinity height → default 8 ; 0 thickness → default 8 → ratio 12, finite.
    const r = call("wallStrength", ctxA, { heightFeet: Infinity, thicknessInches: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.heightFeet, 8);
    assert.equal(r.result.thicknessInches, 8);
    assert.ok(Number.isFinite(r.result.slendernessRatio), "slenderness must be finite");
    assert.equal(r.result.slendernessRatio, 12);

    const rN = call("wallStrength", ctxA, { heightFeet: "x", thicknessInches: NaN });
    assert.equal(rN.ok, true);
    assert.ok(Number.isFinite(rN.result.slendernessRatio));
  });

  it("jobCosting: NaN/Infinity/garbage line values floor (rate keeps the 55 default), never NaN", () => {
    const r = call("jobCosting", ctxA, { items: [{ name: "X", hours: Infinity, rate: NaN, materialCost: "abc" }] });
    assert.equal(r.ok, true);
    const it = r.result.items[0];
    assert.equal(it.laborHours, 0, "Infinity hours floors to 0");
    assert.equal(it.laborRate, 55, "NaN rate falls back to the 55 default");
    assert.equal(it.materialCost, 0, "garbage material cost floors to 0");
    assertFinite(it, ["laborHours", "laborRate", "laborCost", "materialCost", "totalCost"]);
    assertFinite(r.result, ["subtotalLabor", "subtotalMaterials", "overhead", "profit", "grandTotal"]);
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators are stateless ───── */

describe("masonry lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the 4 pure calculators DON'T need STATE — they still compute with STATE gone (never throw)", () => {
    let r;
    assert.doesNotThrow(() => { r = call("materialEstimate", ctxA, { squareFootage: 200, material: "brick" }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.unitsNeeded, 1470);
    assert.doesNotThrow(() => { r = call("mortarMix", ctxA, { application: "general" }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("wallStrength", ctxA, { heightFeet: 8, thicknessInches: 8 }); });
    assert.equal(r.ok, true);
    assert.doesNotThrow(() => { r = call("jobCosting", ctxA, { items: [{ name: "P", hours: 1, rate: 55, materialCost: 0 }] }); });
    assert.equal(r.ok, true);
  });

  it("STATE-backed macros fail-soft with {ok:false} (no throw) when STATE is gone", () => {
    const stateBacked = [
      ["takeoff-list", {}], ["proposal-list", {}], ["schedule-list", {}],
      ["photo-list", {}], ["change-order-list", {}], ["pricebook-list", {}],
      ["invoice-list", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.equal(typeof r.error, "string", `${name} should report an error string`);
    }
  });
});
