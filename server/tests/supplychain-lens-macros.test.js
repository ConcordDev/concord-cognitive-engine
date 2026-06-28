// Phase-2 component-exact-shape gate for the `supplychain` lens.
//
// This is NOT a re-run of supplychain-domain-parity.test.js (which calls the
// handlers with hand-shaped args). Here we drive each calculator through a
// faithful replica of the REAL /api/lens/run dispatch — peel the redundant
// `{ artifact: { data } }` wrapper exactly once, build the virtualArtifact, call
// the handler with the 3-arg (ctx, artifact, params) signature, then unwrap the
// `{ ok, result }` envelope — using the EXACT input object each frontend
// component sends and asserting the EXACT fields the component renders from
// `r.result`. The point is to catch the "dead-calculator" class where the page
// renders field names the handler never returns (welding/hvac had their entire
// calculator surface blank yet handler-shape tests passed).
//
// Two send-shapes coexist in the supplychain lens, both verified here:
//   • SupplyChainActionPanel  → runDomain(d, a, { input: { artifact: { data } } })
//       body.input = { artifact: { data: {...} } }  → peel → params/data = {...}
//       handlers read `artifact.data?.X`.
//   • SupplyChainPlanner      → lensRun(d, a, { ...flat })
//       body.input = { ...flat }  → peel no-op → params/data = { ...flat }
//       handlers read `params?.X`.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSupplychainActions from "../domains/supplychain.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

function unwrapEnvelope(r) {
  if (r && typeof r === "object" && "ok" in r && "result" in r) return r.result;
  return r;
}

// Faithful replica of the server's /api/lens/run dispatch for a single macro.
// `input` is the EXACT object the frontend passes as the request `input`.
function dispatch(action, ctx, input = {}) {
  const fn = ACTIONS.get(`supplychain.${action}`);
  if (!fn) throw new Error(`supplychain.${action} not registered`);
  const rest = peelRedundantArtifactWrapper(input && typeof input === "object" ? input : {});
  const virtualArtifact = { id: null, domain: "supplychain", type: "domain_action", data: rest, meta: {} };
  const raw = fn(ctx, virtualArtifact, rest);
  // Route does { ok: true, result: unwrapEnvelope(raw) }; the component reads r.result.
  return unwrapEnvelope(raw);
}

before(() => { registerSupplychainActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

/* ═══════════════ SupplyChainActionPanel — { artifact: { data } } shape ═══════════════ */

describe("ActionPanel.actLead → leadTimeAnalysis (component-exact)", () => {
  it("renders ordersAnalyzed / avgLeadTimeDays / minDays / maxDays / reliability", () => {
    // EXACT shape actLead() sends: callMacro('leadTimeAnalysis', { artifact: { data: { orders } } })
    const result = dispatch("leadTimeAnalysis", ctxA, {
      artifact: { data: { orders: [
        { id: "o1", orderDate: "2026-01-01", receivedDate: "2026-01-06" }, // 5d
        { id: "o2", orderDate: "2026-01-01", receivedDate: "2026-01-11" }, // 10d
      ] } },
    });
    // Every field the JSX reads off leadResult.* must be present + computed.
    assert.equal(result.ordersAnalyzed, 2);
    assert.equal(result.avgLeadTimeDays, 8);          // ceil((5+10)/2)? -> round(7.5)=8
    assert.equal(result.minDays, 5);
    assert.equal(result.maxDays, 10);
    assert.equal(result.reliability, "good");          // 8 <= 14
    // pipe.publish + ok() read avgLeadTimeDays + reliability — both real.
  });

  it("empty orders returns guidance message (degrade-graceful, no blank result)", () => {
    const result = dispatch("leadTimeAnalysis", ctxA, { artifact: { data: { orders: [] } } });
    assert.ok(result.message, "must carry a guidance message, not an undefined-laden object");
  });
});

describe("ActionPanel.actInv → inventoryOptimize EOQ/safety/reorder (component-exact)", () => {
  it("renders items[].item/currentStock/reorderPoint/eoq/daysOfStock/needsReorder + needsReorder/totalItems", () => {
    // EXACT shape actInv() sends.
    const result = dispatch("inventoryOptimize", ctxA, {
      artifact: { data: { items: [
        { name: "Widget", dailyDemand: 10, leadTimeDays: 7, currentStock: 5, orderCost: 50, holdingCost: 5 },
      ] } },
    });
    assert.equal(result.totalItems, 1);
    const it = result.items[0];
    // Real EOQ: sqrt(2 * D_annual * orderCost / holdingCost) where annual demand
    // = dailyDemand*365. = sqrt(2 * (10*365) * 50 / 5) = sqrt(73000) ≈ 270.
    const expectedEoq = Math.round(Math.sqrt((2 * 10 * 365 * 50) / 5));
    assert.equal(it.eoq, expectedEoq);
    assert.equal(it.eoq, 270);
    // Safety stock = ceil(demand * leadTime * 0.5) = ceil(10*7*0.5)=35.
    assert.equal(it.safetyStock, 35);
    // Reorder point = ceil(demand*leadTime + safetyStock) = 70+35 = 105.
    assert.equal(it.reorderPoint, 105);
    assert.equal(it.currentStock, 5);
    assert.equal(it.item, "Widget");
    assert.equal(it.daysOfStock, 1);                   // round(5/10) = 1
    assert.equal(it.needsReorder, true);               // 5 <= 105
    assert.equal(result.needsReorder, 1);              // summary count
  });

  it("empty items returns guidance message", () => {
    const result = dispatch("inventoryOptimize", ctxA, { artifact: { data: { items: [] } } });
    assert.ok(result.message);
  });
});

describe("ActionPanel.actSup → supplierScore (component-exact)", () => {
  it("renders suppliers[].supplier/totalScore/tier + topSupplier + atRisk", () => {
    const result = dispatch("supplierScore", ctxA, {
      artifact: { data: { suppliers: [
        { name: "Acme", qualityScore: 90, onTimePercent: 95, priceCompetitiveness: 80, responsiveness: 85 },
        { name: "Cheap", qualityScore: 40, onTimePercent: 50, priceCompetitiveness: 60, responsiveness: 45 },
      ] } },
    });
    assert.equal(result.topSupplier, "Acme");
    assert.equal(result.atRisk, 1);
    const top = result.suppliers[0];
    assert.equal(top.supplier, "Acme");
    // 90*.3 + 95*.3 + 80*.2 + 85*.2 = 27+28.5+16+17 = 88.5 -> round 89, tier preferred.
    assert.equal(top.totalScore, 89);
    assert.equal(top.tier, "preferred");
    // 2nd: 40*.3+50*.3+60*.2+45*.2 = 12+15+12+9=48 -> at-risk.
    assert.equal(result.suppliers[1].tier, "at-risk");
  });

  it("empty suppliers returns guidance message", () => {
    const result = dispatch("supplierScore", ctxA, { artifact: { data: { suppliers: [] } } });
    assert.ok(result.message);
  });
});

describe("ActionPanel.actFore → demandForecast (component-exact)", () => {
  it("renders historicalPeriods? avgDemand / trend / forecast[].period/predicted/confidence", () => {
    const result = dispatch("demandForecast", ctxA, {
      artifact: { data: { history: [
        { demand: 100 }, { demand: 110 }, { demand: 120 }, { demand: 130 },
      ] } },
    });
    assert.equal(result.trend, "increasing");
    assert.equal(result.avgDemand, 115);               // mean(100,110,120,130)=115
    assert.equal(result.forecast.length, 3);
    // Component reads forecast[0..2].predicted + .period + .confidence.
    for (const f of result.forecast) {
      assert.ok(typeof f.period === "string");
      assert.ok(Number.isFinite(f.predicted));
      assert.ok(typeof f.confidence === "string");
    }
    assert.equal(result.forecast[0].confidence, "high");
  });

  it("under 3 points returns guidance message", () => {
    const result = dispatch("demandForecast", ctxA, { artifact: { data: { history: [{ demand: 1 }, { demand: 2 }] } } });
    assert.ok(result.message);
  });
});

/* ═══════════════ SupplyChainPlanner — flat params shape ═══════════════ */

describe("Planner.EchelonPanel → multiEchelonOptimize safety stock (component-exact)", () => {
  it("renders echelons[].location/tier/currentStock/reorderPoint/safetyStock/targetStock/daysOfStock/imbalance + totals + rebalanceTransfers", () => {
    // EXACT flat shape EchelonPanel.optimize() sends.
    const result = dispatch("multiEchelonOptimize", ctxA, {
      echelons: [
        { location: "LA DC", tier: "regional", dailyDemand: 100, leadTimeDays: 7, currentStock: 2000, demandStdDev: 30 },
        { location: "Dallas DC", tier: "regional", dailyDemand: 100, leadTimeDays: 7, currentStock: 100, demandStdDev: 30 },
      ],
      serviceLevelZ: 1.65,
    });
    assert.equal(result.echelons.length, 2);
    const la = result.echelons[0];
    // safety = ceil(1.65 * 30 * sqrt(7)) = ceil(130.97...) = 131.
    const expSafety = Math.ceil(1.65 * 30 * Math.sqrt(7));
    assert.equal(la.safetyStock, expSafety);
    assert.equal(la.safetyStock, 131);
    // cycleStock = ceil(100*7)=700; reorderPoint = 700+131 = 831.
    assert.equal(la.reorderPoint, 831);
    assert.equal(la.targetStock, 831);                 // cycle(700)+safety(131)
    assert.equal(la.currentStock, 2000);
    assert.equal(la.tier, "regional");
    assert.equal(la.daysOfStock, 20);                  // round(2000/100)
    assert.ok(la.imbalance > 0);                       // 2000 - 831 surplus
    // The table also renders reorderPoint/imbalance; totals + transfers are stats.
    assert.ok(result.totalSafetyStock > 0);
    assert.ok(result.totalTargetStock > 0);
    assert.equal(result.serviceLevelZ, 1.65);
    // LA surplus → Dallas deficit ⇒ a real transfer is recommended.
    assert.ok(result.rebalanceTransfers.length >= 1);
    const t = result.rebalanceTransfers[0];
    assert.equal(t.from, "LA DC");
    assert.equal(t.to, "Dallas DC");
    assert.ok(t.units > 0);
  });

  it("empty echelons returns guidance message (panel shows result.message)", () => {
    const result = dispatch("multiEchelonOptimize", ctxA, { echelons: [] });
    assert.ok(result.message);
  });
});

describe("Planner.ScenarioPanel → scenarioSimulate (component-exact, regression-guarded)", () => {
  it("renders name/disruption/options[]/recommendation/resilient with real lead-time inflation", () => {
    // EXACT flat shape ScenarioPanel.simulate() sends (alt source provided).
    const result = dispatch("scenarioSimulate", ctxA, {
      name: "Port test", disruption: "port_closure",
      baseDailyDemand: 100, baseLeadTimeDays: 14, baseUnitCost: 10,
      currentStock: 500, altLeadTimeDays: 10, altUnitCost: 14,
    });
    assert.equal(result.name, "Port test");
    assert.equal(result.disruption, "port_closure");
    assert.equal(result.options.length, 2);            // primary + alternate
    assert.ok(result.recommendation);
    assert.equal(typeof result.resilient, "boolean");
    const primary = result.options.find((o) => o.source === "Primary source");
    // port_closure lead multiplier 2.2 → ceil(14*2.2)=ceil(30.8)=31.
    assert.equal(primary.effectiveLeadTimeDays, 31);
    // cost multiplier 1.15 → 10*1.15 = 11.5.
    assert.equal(primary.effectiveUnitCost, 11.5);
    // Each rendered option field is real.
    for (const o of result.options) {
      assert.ok(typeof o.source === "string");
      assert.ok(Number.isFinite(o.effectiveLeadTimeDays));
      assert.ok(Number.isFinite(o.effectiveUnitCost));
      assert.ok(Number.isFinite(o.daysToStockout));
      assert.ok(Number.isFinite(o.projectedStockoutUnits));
      assert.ok(Number.isFinite(o.replenishCost));
      assert.ok(typeof o.stocksOut === "boolean");
    }
  });

  it("REGRESSION: altLeadTimeDays=0 must NOT fabricate a phantom alternate source", () => {
    // The fixed bug: a Math.max(1, …) floor minted a magic 1-day alternate that
    // always won the ranking. With 0, only the primary source must exist.
    const result = dispatch("scenarioSimulate", ctxA, {
      name: "No alt", disruption: "supplier_failure",
      baseDailyDemand: 100, baseLeadTimeDays: 14, baseUnitCost: 10,
      currentStock: 500, altLeadTimeDays: 0, altUnitCost: 0,
    });
    assert.equal(result.options.length, 1);
    assert.equal(result.options[0].source, "Primary source");
    assert.equal(result.recommendation, "Primary source");
  });

  it("a resilient scenario (huge stock) reports resilient=true", () => {
    const result = dispatch("scenarioSimulate", ctxA, {
      disruption: "none", baseDailyDemand: 10, baseLeadTimeDays: 5, baseUnitCost: 5, currentStock: 100000,
    });
    assert.equal(result.resilient, true);
    assert.equal(result.options[0].stocksOut, false);
  });
});

/* ═══════════════ robustness: validation-reject / degrade / fail-CLOSED ═══════════════ */

describe("supplychain robustness contract", () => {
  it("validation-reject: workOrderAdvance refuses backward stage move (ok:false)", () => {
    const created = dispatch("workOrderCreate", ctxA, { item: "Bolt" });
    dispatch("workOrderAdvance", ctxA, { workOrderId: created.workOrder.id, stage: "ordered" });
    const fn = ACTIONS.get("supplychain.workOrderAdvance");
    const back = fn(ctxA, { id: null, data: {}, meta: {} }, { workOrderId: created.workOrder.id, stage: "requisition" });
    assert.equal(back.ok, false);
    assert.match(String(back.error), /backward/);
  });

  it("validation-reject: shipmentCheckpoint on unknown id returns ok:false", () => {
    const fn = ACTIONS.get("supplychain.shipmentCheckpoint");
    const r = fn(ctxA, { id: null, data: {}, meta: {} }, { shipmentId: "ghost" });
    assert.equal(r.ok, false);
  });

  it("degrade-graceful: scenarioSimulate with no params uses safe defaults (never throws)", () => {
    const result = dispatch("scenarioSimulate", ctxA, {});
    assert.ok(result.options.length >= 1);
    assert.ok(Number.isFinite(result.options[0].effectiveLeadTimeDays));
    assert.ok(Number.isFinite(result.options[0].effectiveUnitCost));
  });

  it("fail-CLOSED: poisoned non-finite numerics never leak NaN/Infinity into rendered output", () => {
    // EOQ path — poison every numeric input field with NaN/Infinity/garbage.
    const inv = dispatch("inventoryOptimize", ctxA, {
      artifact: { data: { items: [
        { name: "Bad", dailyDemand: "NaN", leadTimeDays: Infinity, currentStock: "oops", orderCost: NaN, holdingCost: -Infinity },
      ] } },
    });
    const it = inv.items[0];
    for (const k of ["currentStock", "reorderPoint", "safetyStock", "eoq", "daysOfStock"]) {
      assert.ok(Number.isFinite(it[k]), `inventoryOptimize.${k} must be finite, got ${it[k]}`);
    }
    // scenarioSimulate — poison the base numerics.
    const scn = dispatch("scenarioSimulate", ctxA, {
      disruption: "port_closure",
      baseDailyDemand: NaN, baseLeadTimeDays: Infinity, baseUnitCost: "bad",
      currentStock: -Infinity, altLeadTimeDays: NaN, altUnitCost: NaN,
    });
    for (const o of scn.options) {
      assert.ok(Number.isFinite(o.effectiveLeadTimeDays), `effectiveLeadTimeDays finite`);
      assert.ok(Number.isFinite(o.effectiveUnitCost), `effectiveUnitCost finite`);
      assert.ok(Number.isFinite(o.demandDuringLead), `demandDuringLead finite`);
      assert.ok(Number.isFinite(o.projectedStockoutUnits), `projectedStockoutUnits finite`);
      assert.ok(Number.isFinite(o.replenishCost), `replenishCost finite`);
      assert.ok(Number.isFinite(o.daysToStockout), `daysToStockout finite`);
    }
    // multiEchelon — poison the echelon numerics.
    const ech = dispatch("multiEchelonOptimize", ctxA, {
      echelons: [{ location: "X", tier: "regional", dailyDemand: NaN, leadTimeDays: Infinity, currentStock: "no", demandStdDev: NaN }],
      serviceLevelZ: NaN,
    });
    const e0 = ech.echelons[0];
    for (const k of ["dailyDemand", "leadTimeDays", "currentStock", "cycleStock", "safetyStock", "reorderPoint", "targetStock", "daysOfStock", "imbalance"]) {
      assert.ok(Number.isFinite(e0[k]), `multiEchelon.${k} must be finite, got ${e0[k]}`);
    }
  });

  it("per-user isolation: one actor's planning state never bleeds to another", () => {
    dispatch("shipmentCreate", ctxA, { reference: "A-ISO" });
    const other = { actor: { userId: "user_z" }, userId: "user_z" };
    const list = dispatch("shipmentList", other, {});
    assert.equal(list.shipments.length, 0);
  });
});
