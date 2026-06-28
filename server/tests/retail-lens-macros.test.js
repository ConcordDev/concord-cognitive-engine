// Behavioral macro tests for the retail lens — the PHASE-2 LENS-DRIVEN GAP
// layer. These pin the EXACT field contract the live frontend surface drives,
// so a green test can never coexist with a dead-in-production calculator (the
// failure mode where a handler-ideal-shape test passes while the rendered
// component reads undefined fields → every result card renders blank).
//
// The real channel:
//   • components/retail/RetailActionPanel.tsx → callMacro(action,
//       { artifact: { data } }) → apiHelpers.lens.runDomain('retail', action,
//       { input: { artifact: { data } } }) → dispatch peels the redundant
//       artifact wrapper → handler reads art.data.* (== the `input` here).
//       Drives the 4 pure calculators: reorderCheck, pipelineValue,
//       customerLTV, slaStatus.
//   • The STATE-backed POS/CRM macros (product-*, cart-*, customers-*, …) are
//       round-trip-pinned by retail-domain-parity.test.js — NOT duplicated here.
//
// This file asserts, with the EXACT input each calculator sends and the EXACT
// fields its result card renders (cross-checked field-for-field against
// components/retail/RetailActionPanel.tsx after the 2026-06-28 alignment fix):
//   - reorderCheck: totalProducts / criticalCount / reorderCount /
//     sufficientCount / critical[{sku,onHand,status}] / needsReorder[]
//     (already aligned; pinned to lock the contract + harden poison handling)
//   - pipelineValue: totalDeals / totalUnweighted / totalWeighted /
//     expectedRevenue / conversionRate / byStage[stage].{count,weighted}
//     (was DEAD: card read totalDeals/totalWeighted/expectedRevenue/
//     conversionRate/byStage[*].weighted — handler returned dealCount/
//     totalWeightedValue/byStage[*].weightedValue, no expectedRevenue/
//     conversionRate → every Pipeline field rendered undefined)
//   - customerLTV: avgOrderValue / purchaseFrequency / customerLifespanYears /
//     ltv / cac / ltvToCacRatio / profitable
//     (was DEAD: card sent flat { avgOrderValue, purchaseFrequencyPerYear,
//     customerLifespanYears, cac } + read ltv/ltvToCacRatio — handler read
//     artifact.data.customers[] (array of order histories), returned
//     { error:'No matching customers found.' } and never any ltv field)
//   - slaStatus: totalIncidents / withinSLA / breaches / complianceRate /
//     avgResponseMinutes / tier
//     (was DEAD: card sent { incidents:[…] } + read totalIncidents/withinSLA/
//     breaches/complianceRate/avgResponseMinutes/tier — handler read
//     artifact.data.tickets and returned totalTickets/metCount/breachedCount/
//     slaComplianceRate → every SLA field rendered undefined)
//   - VALIDATION-REJECTION on a poisoned/non-array payload
//   - DEGRADE-GRACEFUL: the 4 pure calculators are stateless — they compute
//     even with STATE gone (never throw)
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "1e999" / "abc"):
//     no NaN/Infinity leaks into any rendered money/ratio field, no crash.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerRetailActions from "../domains/retail.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "retail", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data =
// rest AND the 3rd `params` arg = rest. So both the calculators (read art.data)
// and the ops macros (read params) see the same `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`retail.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "retail", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper RetailActionPanel.callMacro builds before dispatch:
//   runDomain('retail', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. This proves the
// double-wrap the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerRetailActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "retail_a", id: "retail_a" }, userId: "retail_a" };

/* ───────── registration: every calculator the panel drives ───────── */

describe("retail lens — registration of the driven calculators", () => {
  it("registers reorderCheck / pipelineValue / customerLTV / slaStatus", () => {
    for (const m of ["reorderCheck", "pipelineValue", "customerLTV", "slaStatus"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing retail.${m}`);
    }
  });
});

/* ───── component double-wrap is unwrapped end-to-end ───── */

describe("retail lens — component { artifact: { data } } wrapper is peeled at dispatch", () => {
  it("a customerLTV call sent the way RetailActionPanel sends it reaches the flat reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read
    // artifact.data.artifact.data → undefined avgOrderValue → the legacy
    // customers[] branch → { error:'No matching customers found.' }, and the
    // card's ltv field renders undefined (the silent-dead class). Drive it
    // through the exact double-wrap and assert the REAL ltv landed.
    const r = callViaComponent("customerLTV", ctxA, {
      avgOrderValue: 100, purchaseFrequencyPerYear: 4, customerLifespanYears: 3, cac: 200,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.ltv, 1200, "the flat unit-econ input must reach the LTV reader");
    assert.equal(r.result.error, undefined, "must NOT fall into the legacy customers[] empty branch");
  });
});

/* ───── reorderCheck: the EXACT fields the reorder card renders ───── */

describe("retail lens — reorderCheck (the RetailActionPanel reorder card)", () => {
  it("returns totalProducts/criticalCount/reorderCount/sufficientCount/critical[]/needsReorder[]", () => {
    // A: onHand 2 ≤ ROP 10 AND daysOfStock 2 < lead 7 → critical-low
    // B: onHand 0 → out-of-stock (critical)
    // C: onHand 8 ≤ ROP 10, dailyUsage 0 → daysOfStock N/A (≥ lead) → below-reorder-point
    // D: onHand 100 > ROP 5 → sufficient
    const r = call("reorderCheck", ctxA, {
      products: [
        { sku: "A", name: "Alpha", onHand: 2, reorderPoint: 10, dailyUsage: 1, leadTimeDays: 7, reorderQty: 20 },
        { sku: "B", name: "Bravo", onHand: 0, reorderPoint: 5 },
        { sku: "C", name: "Charlie", onHand: 8, reorderPoint: 10 },
        { sku: "D", name: "Delta", onHand: 100, reorderPoint: 5, dailyUsage: 1 },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.totalProducts, 4);
    assert.equal(res.criticalCount, 2);     // A + B
    assert.equal(res.reorderCount, 1);       // C
    assert.equal(res.sufficientCount, 1);    // D
    // critical[] is the array the card maps over (sku · onHand on hand · status)
    assert.ok(Array.isArray(res.critical) && res.critical.length === 2);
    const a = res.critical.find((p) => p.sku === "A");
    assert.equal(a.onHand, 2);
    assert.equal(a.reorderPoint, 10);
    assert.equal(a.daysOfStock, 2);
    assert.equal(a.status, "critical-low");
    const b = res.critical.find((p) => p.sku === "B");
    assert.equal(b.status, "out-of-stock");
    assert.equal(b.daysOfStock, "N/A"); // dailyUsage 0 → infinite supply → N/A
    // needsReorder[] also rendered
    assert.ok(Array.isArray(res.needsReorder) && res.needsReorder.length === 1);
    assert.equal(res.needsReorder[0].sku, "C");
    assert.equal(res.needsReorder[0].status, "below-reorder-point");
  });

  it("empty product list → all-zero counts, never crashes", () => {
    const r = call("reorderCheck", ctxA, { products: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalProducts, 0);
    assert.equal(r.result.criticalCount, 0);
    assert.equal(r.result.reorderCount, 0);
    assert.equal(r.result.sufficientCount, 0);
  });
});

/* ───── pipelineValue: totalDeals + weighted + byStage[*].weighted ───── */

describe("retail lens — pipelineValue (the RetailActionPanel pipeline card)", () => {
  it("returns totalDeals/totalUnweighted/totalWeighted/expectedRevenue/conversionRate/byStage[*].{count,weighted}", () => {
    // d1: 1000 × 50% = 500 ; d2: 2000 × 25% = 500 → weighted 1000, unweighted 3000
    // conversionRate = 1000/3000 = 33.33%
    const r = call("pipelineValue", ctxA, {
      deals: [
        { name: "d1", value: 1000, probability: 50, stage: "qualified" },
        { name: "d2", value: 2000, probability: 25, stage: "proposal" },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.totalDeals, 2);
    assert.equal(res.totalUnweighted, 3000);
    assert.equal(res.totalWeighted, 1000);
    assert.equal(res.expectedRevenue, 1000);
    assert.equal(res.conversionRate, 33.33);
    // byStage entries carry .count AND .weighted (the exact fields the card maps)
    assert.equal(res.byStage.qualified.count, 1);
    assert.equal(res.byStage.qualified.weighted, 500);
    assert.equal(res.byStage.proposal.count, 1);
    assert.equal(res.byStage.proposal.weighted, 500);
  });

  it("excludes closed-won/closed-lost (and won/lost) from the active pipeline by default", () => {
    const r = call("pipelineValue", ctxA, {
      deals: [
        { name: "open", value: 1000, probability: 40, stage: "negotiation" },
        { name: "won", value: 5000, probability: 100, stage: "closed-won" },
        { name: "lost", value: 9000, probability: 0, stage: "lost" },
      ],
    });
    assert.equal(r.result.totalDeals, 1);
    assert.equal(r.result.totalUnweighted, 1000);
    assert.equal(r.result.totalWeighted, 400);
  });

  it("empty pipeline → zeroed totals + 0 conversionRate (no divide-by-zero)", () => {
    const r = call("pipelineValue", ctxA, { deals: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDeals, 0);
    assert.equal(r.result.totalWeighted, 0);
    assert.equal(r.result.conversionRate, 0);
  });
});

/* ───── customerLTV: flat unit-economics → ltv / ltvToCacRatio ───── */

describe("retail lens — customerLTV (the RetailActionPanel LTV card)", () => {
  it("returns avgOrderValue/purchaseFrequency/customerLifespanYears/ltv/cac/ltvToCacRatio/profitable", () => {
    // ltv = 120 × 6 × 2.5 = 1800 ; ratio = 1800 / 300 = 6.0 → profitable (≥3)
    const r = call("customerLTV", ctxA, {
      avgOrderValue: 120, purchaseFrequencyPerYear: 6, customerLifespanYears: 2.5, cac: 300,
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.avgOrderValue, 120);
    assert.equal(res.purchaseFrequency, 6);
    assert.equal(res.customerLifespanYears, 2.5);
    assert.equal(res.ltv, 1800);
    assert.equal(res.cac, 300);
    assert.equal(res.ltvToCacRatio, 6);
    assert.equal(res.profitable, true);
    // the OLD report fields the legacy branch returned must NOT be the surface here
    assert.equal(res.totalProjectedLTV, undefined);
    assert.equal(res.customersAnalyzed, undefined);
  });

  it("ratio below 3 → profitable=false (the card colours red/amber)", () => {
    // ltv = 50 × 2 × 1 = 100 ; ratio = 100 / 80 = 1.25 → not profitable
    const r = call("customerLTV", ctxA, {
      avgOrderValue: 50, purchaseFrequencyPerYear: 2, customerLifespanYears: 1, cac: 80,
    });
    assert.equal(r.result.ltv, 100);
    assert.equal(r.result.ltvToCacRatio, 1.25);
    assert.equal(r.result.profitable, false);
  });

  it("cac of 0 collapses the ratio to ltv (never Infinity)", () => {
    const r = call("customerLTV", ctxA, {
      avgOrderValue: 100, purchaseFrequencyPerYear: 4, customerLifespanYears: 3, cac: 0,
    });
    assert.equal(r.result.ltv, 1200);
    assert.ok(Number.isFinite(r.result.ltvToCacRatio), "ratio must be finite, not Infinity");
    assert.equal(r.result.ltvToCacRatio, 1200);
  });
});

/* ───── slaStatus: incidents → withinSLA / breaches / tier ───── */

describe("retail lens — slaStatus (the RetailActionPanel SLA card)", () => {
  it("returns totalIncidents/withinSLA/breaches/complianceRate/avgResponseMinutes/tier", () => {
    // i1: 30 ≤ 60 within ; i2: 120 > 60 breach ; i3: 50 ≤ default(1440) within
    // → 2 within / 3 → 66.67% → tier 'bronze' ; avg response = (30+120+50)/3 = 66.67
    const r = call("slaStatus", ctxA, {
      incidents: [
        { responseMinutes: 30, slaMinutes: 60, priority: "high" },
        { responseMinutes: 120, slaMinutes: 60 },
        { responseMinutes: 50 },
      ],
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.totalIncidents, 3);
    assert.equal(res.withinSLA, 2);
    assert.equal(res.breaches, 1);
    assert.equal(res.complianceRate, 66.67);
    assert.equal(res.avgResponseMinutes, 66.67);
    assert.equal(res.tier, "bronze");
    // legacy ticket-report fields must NOT be the surface here
    assert.equal(res.totalTickets, undefined);
    assert.equal(res.slaComplianceRate, undefined);
  });

  it("all-within → 100% compliance + platinum tier", () => {
    const r = call("slaStatus", ctxA, {
      incidents: [
        { responseMinutes: 10, slaMinutes: 60 },
        { responseMinutes: 20, slaMinutes: 60 },
      ],
    });
    assert.equal(r.result.complianceRate, 100);
    assert.equal(r.result.withinSLA, 2);
    assert.equal(r.result.breaches, 0);
    assert.equal(r.result.tier, "platinum");
  });

  it("an incident with no response time counts as an open breach", () => {
    const r = call("slaStatus", ctxA, {
      incidents: [
        { responseMinutes: 10, slaMinutes: 60 }, // within
        { priority: "high" },                     // no response → breach
      ],
    });
    assert.equal(r.result.totalIncidents, 2);
    assert.equal(r.result.withinSLA, 1);
    assert.equal(r.result.breaches, 1);
    assert.equal(r.result.complianceRate, 50);
  });

  it("supports responseHours / slaHours aliases", () => {
    // 0.5h = 30min ≤ slaHours 1 = 60min → within
    const r = call("slaStatus", ctxA, { incidents: [{ responseHours: 0.5, slaHours: 1 }] });
    assert.equal(r.result.withinSLA, 1);
    assert.equal(r.result.avgResponseMinutes, 30);
  });
});

/* ───── VALIDATION: poisoned / non-array payloads are tolerated ───── */

describe("retail lens — validation-rejection on poisoned payloads", () => {
  it("reorderCheck: a non-array products payload yields zero counts, never crashes", () => {
    const r = call("reorderCheck", ctxA, { products: "not-an-array" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalProducts, 0);
  });

  it("reorderCheck: junk entries (null/string/number) are dropped, not exploded", () => {
    const r = call("reorderCheck", ctxA, {
      products: [null, "junk", 42, { sku: "OK", onHand: 0, reorderPoint: 5 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.criticalCount, 1); // only the OK out-of-stock entry counts
  });

  it("pipelineValue: a non-array deals payload yields an empty pipeline, never crashes", () => {
    const r = call("pipelineValue", ctxA, { deals: { boom: true } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDeals, 0);
    assert.equal(r.result.totalWeighted, 0);
  });

  it("slaStatus: a non-array incidents payload falls through to the legacy ticket branch (no incidents)", () => {
    const r = call("slaStatus", ctxA, { incidents: "boom" });
    assert.equal(r.ok, true);
    // not the incidents branch → legacy tickets branch with [] → 100% / 0 tickets
    assert.equal(r.result.totalTickets, 0);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/Infinity ───── */

describe("retail lens — fail-closed on poisoned numeric inputs", () => {
  it("reorderCheck: Infinity/NaN onHand can't leak into the rendered numbers", () => {
    const r = call("reorderCheck", ctxA, {
      products: [
        { sku: "X", onHand: Infinity, reorderPoint: NaN, dailyUsage: "abc", leadTimeDays: "x" },
        { sku: "Y", onHand: "1e999", reorderPoint: 10 },
      ],
    });
    assert.equal(r.ok, true);
    for (const entry of [...r.result.critical, ...r.result.needsReorder, ...(r.result.sufficient || [])]) {
      assert.ok(Number.isFinite(entry.onHand), `onHand ${entry.onHand} must be finite`);
      assert.ok(Number.isFinite(entry.reorderPoint), `reorderPoint ${entry.reorderPoint} must be finite`);
      if (entry.daysOfStock !== "N/A") assert.ok(Number.isFinite(entry.daysOfStock));
    }
  });

  it("pipelineValue: 1e999/NaN/Infinity value+probability collapse to finite (no money NaN/Infinity)", () => {
    const r = call("pipelineValue", ctxA, {
      deals: [
        { value: "1e999", probability: "Infinity", stage: "x" },
        { value: NaN, probability: 50, stage: "y" },
        { value: 1000, probability: 1e9, stage: "z" }, // runaway probability clamps to 100
      ],
    });
    assert.equal(r.ok, true);
    for (const k of ["totalUnweighted", "totalWeighted", "expectedRevenue", "conversionRate"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k}=${r.result[k]} must be finite`);
    }
    // poisoned deals collapse to 0 value/weighted; the clamped one is 1000 × 100% = 1000
    assert.equal(r.result.totalUnweighted, 1000);
    assert.equal(r.result.totalWeighted, 1000);
  });

  it("customerLTV: garbage inputs produce a finite, zeroed result (no NaN/Infinity)", () => {
    const r = call("customerLTV", ctxA, {
      avgOrderValue: Infinity, purchaseFrequencyPerYear: "abc", customerLifespanYears: NaN, cac: -5,
    });
    assert.equal(r.ok, true);
    for (const k of ["avgOrderValue", "purchaseFrequency", "customerLifespanYears", "ltv", "cac", "ltvToCacRatio"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k}=${r.result[k]} must be finite`);
    }
    assert.equal(r.result.ltv, 0);
    assert.equal(r.result.profitable, false);
  });

  it("slaStatus: garbage response/sla times never produce NaN compliance or avg", () => {
    const r = call("slaStatus", ctxA, {
      incidents: [
        { responseMinutes: "abc", slaMinutes: NaN },
        { responseMinutes: Infinity, slaMinutes: "x" },
        { responseMinutes: 30, slaMinutes: 60 },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.complianceRate), "complianceRate must be finite");
    assert.ok(Number.isFinite(r.result.avgResponseMinutes), "avgResponseMinutes must be finite");
    // "abc" response → breach ; Infinity is finite-rejected by finNum → breach ; 30≤60 within
    assert.equal(r.result.withinSLA, 1);
    assert.equal(r.result.breaches, 2);
  });
});

/* ───── DEGRADE-GRACEFUL: pure calculators are stateless ───── */

describe("retail lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("the 4 pure calculators DON'T need STATE — they still compute with STATE gone (never throw)", () => {
    let r;
    assert.doesNotThrow(() => { r = call("reorderCheck", ctxA, { products: [{ sku: "A", onHand: 0, reorderPoint: 5 }] }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.criticalCount, 1);
    assert.doesNotThrow(() => { r = call("pipelineValue", ctxA, { deals: [{ value: 100, probability: 50, stage: "x" }] }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWeighted, 50);
    assert.doesNotThrow(() => { r = call("customerLTV", ctxA, { avgOrderValue: 100, purchaseFrequencyPerYear: 4, customerLifespanYears: 3, cac: 200 }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.ltv, 1200);
    assert.doesNotThrow(() => { r = call("slaStatus", ctxA, { incidents: [{ responseMinutes: 10, slaMinutes: 60 }] }); });
    assert.equal(r.ok, true);
    assert.equal(r.result.withinSLA, 1);
  });

  it("STATE-backed ops macros fail-soft with {ok:false} (no throw) when STATE is gone", () => {
    const stateBacked = [
      ["product-list", {}], ["orders-list", {}], ["customers-list", {}],
      ["discounts-list", {}], ["analytics-summary", {}],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
    }
  });
});
