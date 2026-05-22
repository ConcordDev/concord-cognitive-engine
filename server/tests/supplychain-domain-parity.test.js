// Contract tests for server/domains/supplychain.js — the four pure-compute
// analytics macros plus the STATE-backed planning substrate (shipment
// tracking, supply network/BOM, multi-echelon inventory, what-if scenarios,
// seasonal forecasting, exception management, PO workflow, spend analytics).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSupplychainActions from "../domains/supplychain.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, paramsOrArtifact = {}, maybeParams) {
  const fn = ACTIONS.get(`supplychain.${name}`);
  if (!fn) throw new Error(`supplychain.${name} not registered`);
  const artifact = arguments.length === 4 ? paramsOrArtifact : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : paramsOrArtifact;
  return fn(ctx, artifact, params);
}

before(() => { registerSupplychainActions(register); });

// Each test gets a fresh in-memory STATE so per-user Maps don't bleed.
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/* ─────────────────── pure-compute analytics macros ─────────────────── */

describe("supplychain pure-compute analytics", () => {
  it("leadTimeAnalysis computes avg/min/max + reliability tier", () => {
    const r = call("leadTimeAnalysis", ctxA, {
      data: { orders: [
        { id: "o1", orderDate: "2026-01-01", receivedDate: "2026-01-06" },
        { id: "o2", orderDate: "2026-01-01", receivedDate: "2026-01-11" },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.ordersAnalyzed, 2);
    assert.equal(r.result.avgLeadTimeDays, 8);
    assert.equal(r.result.reliability, "good");
  });

  it("inventoryOptimize returns EOQ + reorder point + needsReorder", () => {
    const r = call("inventoryOptimize", ctxA, {
      data: { items: [{ name: "Widget", dailyDemand: 10, leadTimeDays: 7, currentStock: 5 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.items[0].needsReorder, true);
    assert.ok(r.result.items[0].eoq > 0);
  });

  it("supplierScore ranks and tiers suppliers", () => {
    const r = call("supplierScore", ctxA, {
      data: { suppliers: [
        { name: "Acme", qualityScore: 90, onTimePercent: 95, priceCompetitiveness: 80, responsiveness: 85 },
        { name: "Cheap", qualityScore: 40, onTimePercent: 50, priceCompetitiveness: 60, responsiveness: 45 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.topSupplier, "Acme");
    assert.equal(r.result.atRisk, 1);
  });

  it("demandForecast projects 3 periods with confidence", () => {
    const r = call("demandForecast", ctxA, {
      data: { history: [{ demand: 100 }, { demand: 110 }, { demand: 120 }, { demand: 130 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.forecast.length, 3);
    assert.equal(r.result.trend, "increasing");
  });
});

/* ───────────────────── 1. shipment tracking ────────────────────────── */

describe("supplychain shipment tracking", () => {
  it("creates, lists, checkpoints and deletes a shipment", () => {
    const created = call("shipmentCreate", ctxA, {}, {
      reference: "SHP-1", carrier: "MaerskTest", origin: "Shanghai",
      destination: "Los Angeles", plannedEtaDays: 14, value: 50000,
    });
    assert.equal(created.ok, true);
    const id = created.result.shipment.id;

    let list = call("shipmentList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.shipments.length, 1);
    assert.equal(list.result.inTransit, 1);
    // Hub coords resolve so the route map has points.
    assert.equal(list.result.shipments[0].route.length, 2);

    const cp = call("shipmentCheckpoint", ctxA, {}, { shipmentId: id, status: "delivered", location: "Los Angeles" });
    assert.equal(cp.ok, true);
    assert.equal(cp.result.shipment.status, "delivered");

    list = call("shipmentList", ctxA, {}, {});
    assert.equal(list.result.delivered, 1);

    const del = call("shipmentDelete", ctxA, {}, { shipmentId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.removed, 1);
  });

  it("rejects checkpoint for unknown shipment", () => {
    const r = call("shipmentCheckpoint", ctxA, {}, { shipmentId: "nope" });
    assert.equal(r.ok, false);
  });

  it("isolates shipments per user", () => {
    call("shipmentCreate", ctxA, {}, { reference: "A1" });
    const listB = call("shipmentList", ctxB, {}, {});
    assert.equal(listB.result.shipments.length, 0);
  });
});

/* ──────────────────── 2. supply network / BOM ──────────────────────── */

describe("supplychain supply network", () => {
  it("stores nodes/edges and returns a tree + markers + critical path", () => {
    const set = call("networkSet", ctxA, {}, {
      nodes: [
        { id: "s1", label: "Mill", kind: "supplier", location: "Shenzhen", capacity: 5000 },
        { id: "w1", label: "DC", kind: "warehouse", location: "Los Angeles", capacity: 8000 },
        { id: "c1", label: "Retail", kind: "customer", location: "San Francisco" },
      ],
      edges: [
        { from: "s1", to: "w1", leadTimeDays: 21 },
        { from: "w1", to: "c1", leadTimeDays: 3 },
      ],
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.nodeCount, 3);
    assert.equal(set.result.edgeCount, 2);

    const g = call("networkGraph", ctxA, {}, {});
    assert.equal(g.ok, true);
    assert.equal(g.result.tree.length, 1);
    assert.equal(g.result.criticalLeadTime, 24);
    assert.equal(g.result.counts.supplier, 1);
    assert.ok(g.result.markers.length >= 2);
  });

  it("drops edges that reference unknown nodes", () => {
    const set = call("networkSet", ctxA, {}, {
      nodes: [{ id: "n1", label: "A", kind: "supplier" }],
      edges: [{ from: "n1", to: "ghost" }],
    });
    assert.equal(set.result.edgeCount, 0);
  });
});

/* ────────────────── 3. multi-echelon inventory ─────────────────────── */

describe("supplychain multi-echelon optimization", () => {
  it("computes safety stock + rebalancing transfers", () => {
    const r = call("multiEchelonOptimize", ctxA, {}, {
      echelons: [
        { location: "LA", tier: "regional", dailyDemand: 100, leadTimeDays: 7, currentStock: 2000, demandStdDev: 30 },
        { location: "Dallas", tier: "regional", dailyDemand: 100, leadTimeDays: 7, currentStock: 100, demandStdDev: 30 },
      ],
      serviceLevelZ: 1.65,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.echelons.length, 2);
    assert.ok(r.result.totalSafetyStock > 0);
    // LA over-stocked, Dallas deficit => at least one transfer recommended.
    assert.ok(r.result.rebalanceTransfers.length >= 1);
  });

  it("returns guidance message when no echelons supplied", () => {
    const r = call("multiEchelonOptimize", ctxA, {}, { echelons: [] });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

/* ───────────────────── 4. what-if scenarios ────────────────────────── */

describe("supplychain what-if scenarios", () => {
  it("simulates a disruption and persists/lists/deletes the scenario", () => {
    const sim = call("scenarioSimulate", ctxA, {}, {
      name: "Port test", disruption: "port_closure",
      baseDailyDemand: 100, baseLeadTimeDays: 14, baseUnitCost: 10,
      currentStock: 500, altLeadTimeDays: 10, altUnitCost: 14,
    });
    assert.equal(sim.ok, true);
    assert.equal(sim.result.options.length, 2);
    assert.ok(sim.result.recommendation);
    // Port closure inflates lead time => primary effective lead > base.
    assert.ok(sim.result.options[0].effectiveLeadTimeDays > 14);

    const list = call("scenarioList", ctxA, {}, {});
    assert.equal(list.result.scenarios.length, 1);

    const del = call("scenarioDelete", ctxA, {}, { scenarioId: sim.result.id });
    assert.equal(del.result.removed, 1);
  });

  it("a resilient scenario does not stock out", () => {
    const r = call("scenarioSimulate", ctxA, {}, {
      disruption: "none", baseDailyDemand: 10, baseLeadTimeDays: 5,
      baseUnitCost: 5, currentStock: 100000,
    });
    assert.equal(r.result.resilient, true);
  });
});

/* ──────────────────── 5. seasonal forecasting ──────────────────────── */

describe("supplychain seasonal forecast", () => {
  it("runs Holt-Winters and returns fitted + forecast + MAPE", () => {
    const history = [100, 120, 90, 110, 105, 125, 95, 115];
    const r = call("seasonalForecast", ctxA, {}, { history, seasonLength: 4, horizon: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "holt-winters-additive");
    assert.equal(r.result.forecast.length, 4);
    assert.equal(r.result.fitted.length, history.length);
    assert.ok(typeof r.result.mapePct === "number");
  });

  it("requires at least 4 data points", () => {
    const r = call("seasonalForecast", ctxA, {}, { history: [1, 2, 3] });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

/* ────────────────── 6. exception management ────────────────────────── */

describe("supplychain exception scan", () => {
  it("flags stockouts, low stock, at-risk suppliers, late shipments", () => {
    // A shipment whose ETA is already in the past => late.
    const sh = call("shipmentCreate", ctxA, {}, { reference: "LATE-1", plannedEtaDays: 1 });
    const arr = globalThis._concordSTATE.supplychainLens.shipments.get("user_a");
    arr[0].etaAt = Date.now() - 10 * 86400000; // force overdue
    assert.ok(sh.ok);

    const r = call("exceptionScan", ctxA, {}, {
      inventory: [
        { name: "Out", currentStock: 0, dailyDemand: 5, leadTimeDays: 7 },
        { name: "Low", currentStock: 10, dailyDemand: 5, leadTimeDays: 7, reorderPoint: 50 },
      ],
      suppliers: [{ name: "Risky", qualityScore: 30, onTimePercent: 40 }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.critical >= 1);
    assert.ok(r.result.alerts.some((a) => a.kind === "stockout"));
    assert.ok(r.result.alerts.some((a) => a.kind === "low_stock"));
    assert.ok(r.result.alerts.some((a) => a.kind === "at_risk_supplier"));
    assert.ok(r.result.alerts.some((a) => a.kind === "late_shipment"));
  });

  it("reports zero alerts on a clean inventory", () => {
    const r = call("exceptionScan", ctxA, {}, {
      inventory: [{ name: "Healthy", currentStock: 1000, dailyDemand: 5, leadTimeDays: 7, reorderPoint: 50 }],
      suppliers: [{ name: "Good", qualityScore: 90, onTimePercent: 95 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.alerts.length, 0);
  });
});

/* ──────────────────── 7. PO workflow automation ────────────────────── */

describe("supplychain work-order workflow", () => {
  it("creates, advances through stages, lists and deletes a work order", () => {
    const created = call("workOrderCreate", ctxA, {}, {
      item: "Steel rod", supplier: "Acme", quantity: 100, unitCost: 5, leadTimeDays: 10,
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.workOrder.stage, "requisition");
    assert.equal(created.result.workOrder.totalCost, 500);
    const id = created.result.workOrder.id;

    const adv = call("workOrderAdvance", ctxA, {}, { workOrderId: id });
    assert.equal(adv.result.workOrder.stage, "approved");

    const jump = call("workOrderAdvance", ctxA, {}, { workOrderId: id, stage: "received", receivedQty: 100 });
    assert.equal(jump.result.workOrder.stage, "received");
    assert.equal(jump.result.workOrder.receivedQty, 100);

    const list = call("workOrderList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.byStage.received, 1);

    const del = call("workOrderDelete", ctxA, {}, { workOrderId: id });
    assert.equal(del.result.removed, 1);
  });

  it("refuses to move a work order backward", () => {
    const created = call("workOrderCreate", ctxA, {}, { item: "Bolt" });
    call("workOrderAdvance", ctxA, {}, { workOrderId: created.result.workOrder.id, stage: "ordered" });
    const back = call("workOrderAdvance", ctxA, {}, { workOrderId: created.result.workOrder.id, stage: "requisition" });
    assert.equal(back.ok, false);
  });
});

/* ──────────────────── 8. spend analytics ───────────────────────────── */

describe("supplychain spend analytics", () => {
  it("aggregates spend by supplier + category with Pareto concentration", () => {
    // Seed a work order so STATE spend is folded in too.
    call("workOrderCreate", ctxA, {}, { item: "X", supplier: "Acme", quantity: 10, unitCost: 10, category: "raw" });
    const r = call("spendAnalytics", ctxA, {}, {
      orders: [
        { supplier: "Acme", category: "raw materials", quantity: 500, unitCost: 4 },
        { supplier: "Globex", category: "packaging", quantity: 1000, unitCost: 1 },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalSpend > 0);
    assert.ok(r.result.bySupplier.length >= 2);
    assert.ok(r.result.byCategory.length >= 2);
    assert.ok(r.result.paretoSupplierCount >= 1);
    assert.ok(r.result.topSupplier);
  });

  it("returns an empty breakdown message when no spend data", () => {
    const r = call("spendAnalytics", ctxA, {}, { orders: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSpend, 0);
  });
});
