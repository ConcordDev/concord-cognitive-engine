// Build-slice gate for the supplychain full lens build (GB-1088 Wave 1).
//
// Pins the review-of-record fixes F6–F9 + the F3/F4 server halves:
//   F6 demandForecast is its documented method (simple exponential
//      smoothing with an α input), not avg + linear trend.
//   F7 supplierScore scores the standard 2-metric lines (weights
//      renormalize over the metrics present); topSupplier is a name or
//      an explicit null, never undefined.
//   F8 exceptionScan's fallback reorder point is the inventory
//      optimizer's disclosed rule (d·L × 1.5), and the model is printed.
//   F3 exceptionScan persists its inventory/supplier alerts on request;
//      exceptionLatest reads them back for the control tower.
//   F4 PO numbers are unique across scopes; workOrderCreate keeps the
//      category the client sends.
//   F9 scenario replenishCost prices the projected stockout units;
//      scenarios persist in-process across list calls; networkGet
//      returns the saved network raw for the editors.
//
// Drives the handlers through the same dispatch replica as
// supplychain-lens-macros.test.js (peel once, 3-arg call, unwrap).

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

function dispatch(action, ctx, input = {}) {
  const fn = ACTIONS.get(`supplychain.${action}`);
  if (!fn) throw new Error(`supplychain.${action} not registered`);
  const rest = peelRedundantArtifactWrapper(input && typeof input === "object" ? input : {});
  const virtualArtifact = { id: null, domain: "supplychain", type: "domain_action", data: rest, meta: {} };
  const raw = fn(ctx, virtualArtifact, rest);
  return unwrapEnvelope(raw);
}

before(() => { registerSupplychainActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

/* ─────────────────────────── F6 — SES forecast ─────────────────────── */

describe("F6 demandForecast → simple exponential smoothing", () => {
  it("computes the SES level, reports method/alpha/MAPE, forecasts flat", () => {
    const result = dispatch("demandForecast", ctxA, {
      artifact: { data: { history: [{ demand: 100 }, { demand: 110 }, { demand: 120 }, { demand: 130 }] } },
    });
    assert.equal(result.method, "simple-exponential-smoothing");
    assert.equal(result.alpha, 0.3);
    assert.equal(result.avgDemand, 115);
    assert.equal(result.trend, "increasing");
    // SES with α=0.3: level 100 → 103 → 108.1 → 114.67 → forecast 115 flat.
    assert.deepEqual(result.forecast.map(f => f.predicted), [115, 115, 115]);
    // One-step MAPE: (10/110 + 17/120 + 21.9/130) / 3 ≈ 13.4%.
    assert.equal(result.mapePct, 13.4);
    assert.equal(result.accuracy, "good");
    assert.equal(result.forecast[0].confidence, "high");
  });

  it("never forecasts above the level the smoothing reached (no trend overshoot past the historical max on a collapsed series)", () => {
    const result = dispatch("demandForecast", ctxA, {
      artifact: { data: { history: [{ demand: 200 }, { demand: 50 }, { demand: 50 }, { demand: 50 }] } },
    });
    for (const f of result.forecast) assert.ok(f.predicted <= 200, `predicted ${f.predicted} exceeds historical max`);
    // SES level: 200 → 155 → 123.5 → 101.45 → 101. (The retired avg+trend
    // formula forecast −62 on this series — negative demand.)
    assert.equal(result.forecast[0].predicted, 101);
  });

  it("honours a caller-supplied alpha and echoes it", () => {
    const result = dispatch("demandForecast", ctxA, {
      artifact: { data: { history: [{ demand: 100 }, { demand: 100 }, { demand: 200 }], alpha: 0.9 } },
    });
    assert.equal(result.alpha, 0.9);
    // level: 100 → 100 → 0.9*200 + 0.1*100 = 190.
    assert.equal(result.forecast[0].predicted, 190);
  });

  it("clamps alpha into (0, 1) and keeps the under-3-points guidance", () => {
    const wild = dispatch("demandForecast", ctxA, {
      artifact: { data: { history: [{ demand: 5 }, { demand: 6 }, { demand: 7 }], alpha: 42 } },
    });
    assert.equal(wild.alpha, 0.95);
    const short = dispatch("demandForecast", ctxA, { artifact: { data: { history: [{ demand: 1 }] } } });
    assert.ok(short.message);
  });
});

/* ──────────────────────── F7 — supplier scorecard ──────────────────── */

describe("F7 supplierScore → renormalized scoring over present metrics", () => {
  it("scores the standard 2-metric lines and names a top supplier", () => {
    const result = dispatch("supplierScore", ctxA, {
      artifact: { data: { suppliers: [
        { name: "Acme Corp", qualityScore: 45, onTimePercent: 55 },
        { name: "Globex", qualityScore: 80, onTimePercent: 92 },
      ] } },
    });
    // Acme: (45*.3 + 55*.3) / .6 = 50 → conditional. Globex: (80*.3 + 92*.3) / .6 = 86 → preferred.
    const acme = result.suppliers.find(s => s.supplier === "Acme Corp");
    const globex = result.suppliers.find(s => s.supplier === "Globex");
    assert.equal(acme.totalScore, 50);
    assert.equal(acme.tier, "conditional");
    assert.deepEqual(acme.scoredOn, ["qualityScore", "onTimePercent"]);
    assert.deepEqual(acme.missingInputs, ["priceCompetitiveness", "responsiveness"]);
    assert.equal(globex.totalScore, 86);
    assert.equal(result.topSupplier, "Globex");
    assert.ok(result.method.includes("renormalize"));
  });

  it("full-metric maths is unchanged (weights sum to 1, no renormalization drift)", () => {
    const result = dispatch("supplierScore", ctxA, {
      artifact: { data: { suppliers: [
        { name: "Acme", qualityScore: 90, onTimePercent: 95, priceCompetitiveness: 80, responsiveness: 85 },
      ] } },
    });
    assert.equal(result.suppliers[0].totalScore, 89);
    assert.equal(result.suppliers[0].tier, "preferred");
    assert.deepEqual(result.suppliers[0].missingInputs, []);
  });

  it("a supplier with no metrics stays NOT_COMPUTED, and topSupplier is explicit null when nobody scores", () => {
    const result = dispatch("supplierScore", ctxA, {
      artifact: { data: { suppliers: [{ name: "Ghost" }] } },
    });
    assert.equal(result.suppliers[0].status, "NOT_COMPUTED");
    assert.equal(result.suppliers[0].totalScore, null);
    assert.equal(result.topSupplier, null);
  });
});

/* ─────────────────── F8 + F3 — exception scan / tower ──────────────── */

describe("F8 exceptionScan → fallback ROP is the optimizer's disclosed rule", () => {
  it("derives ROP = d·L × 1.5 when a row supplies none, and says so", () => {
    const result = dispatch("exceptionScan", ctxA, {
      inventory: [{ name: "Widget B", currentStock: 40, dailyDemand: 6, leadTimeDays: 5 }],
      suppliers: [],
    });
    // Optimizer ROP for the same shape: 6*5 + ceil(6*5*0.5) = 45. 40 <= 45 → low stock.
    assert.equal(result.warning, 1);
    assert.equal(result.alerts[0].kind, "low_stock");
    assert.ok(result.alerts[0].detail.includes("ROP 45"));
    assert.ok(result.alerts[0].detail.includes("derived"));
    assert.ok(result.ropModel.includes("1.5"));
  });

  it("uses a supplied reorder point as given, without the derived note", () => {
    const result = dispatch("exceptionScan", ctxA, {
      inventory: [{ name: "Widget B", currentStock: 40, dailyDemand: 6, leadTimeDays: 5, reorderPoint: 30 }],
      suppliers: [],
    });
    assert.equal(result.alerts.length, 0);
    const over = dispatch("exceptionScan", ctxA, {
      inventory: [{ name: "Widget B", currentStock: 40, dailyDemand: 6, leadTimeDays: 5, reorderPoint: 60 }],
      suppliers: [],
    });
    assert.equal(over.alerts[0].kind, "low_stock");
    assert.ok(!over.alerts[0].detail.includes("derived"));
  });
});

describe("F3 exceptionScan persist → exceptionLatest feeds the tower", () => {
  it("persists only the inventory/supplier alerts; STATE alerts stay live, never snapshotted", () => {
    // A STATE-derived alert exists (shipment flagged exception).
    const sh = dispatch("shipmentCreate", ctxA, { reference: "SHP-X", origin: "Shanghai", destination: "Los Angeles" });
    dispatch("shipmentCheckpoint", ctxA, { shipmentId: sh.shipment.id, status: "exception", location: "port" });
    const scan = dispatch("exceptionScan", ctxA, {
      inventory: [{ name: "Widget A", currentStock: 0, dailyDemand: 12, leadTimeDays: 7 }],
      suppliers: [{ name: "Acme Corp", qualityScore: 45, onTimePercent: 55 }],
      persist: true,
    });
    assert.equal(scan.critical, 2); // stockout + shipment exception, live total
    const latest = dispatch("exceptionLatest", ctxA, {});
    assert.ok(latest.scan, "a persisted scan must be readable");
    assert.equal(latest.scan.critical, 1);
    assert.equal(latest.scan.warning, 1);
    assert.deepEqual(latest.scan.alerts.map(a => a.kind).sort(), ["at_risk_supplier", "stockout"]);
    assert.equal(latest.scan.inventoryRows, 1);
    assert.equal(latest.scan.supplierRows, 1);
    assert.ok(typeof latest.scan.scannedAt === "number");
  });

  it("a scan without persist does not overwrite the stored scan; a fresh scope reads null", () => {
    dispatch("exceptionScan", ctxA, {
      inventory: [{ name: "Widget A", currentStock: 0, dailyDemand: 12, leadTimeDays: 7 }],
      suppliers: [], persist: true,
    });
    dispatch("exceptionScan", ctxA, { inventory: [], suppliers: [] }); // tower's own live read
    const latest = dispatch("exceptionLatest", ctxA, {});
    assert.equal(latest.scan.critical, 1);
    const fresh = dispatch("exceptionLatest", ctxB, {});
    assert.equal(fresh.scan, null);
  });
});

/* ──────────────────────── F4 — PO sequence / category ──────────────── */

describe("F4 work orders → scope-independent PO numbers, category kept", () => {
  it("never reissues PO-1000 across scopes", () => {
    const a1 = dispatch("workOrderCreate", ctxA, { item: "Bolts" });
    const b1 = dispatch("workOrderCreate", ctxB, { item: "Gears" });
    const a2 = dispatch("workOrderCreate", ctxA, { item: "Belts" });
    assert.equal(a1.workOrder.poNumber, "PO-1000");
    assert.equal(b1.workOrder.poNumber, "PO-1001");
    assert.equal(a2.workOrder.poNumber, "PO-1002");
  });

  it("seeds from the highest number already issued (existing stores keep their numbers)", () => {
    dispatch("workOrderCreate", ctxA, { item: "Legacy", poNumber: "PO-1042" });
    const next = dispatch("workOrderCreate", ctxB, { item: "Fresh" });
    assert.equal(next.workOrder.poNumber, "PO-1043");
  });

  it("stores the category the client sends, and spend analytics groups by it", () => {
    dispatch("workOrderCreate", ctxA, { item: "Resin", quantity: 2, unitCost: 10, category: "raw materials" });
    const list = dispatch("workOrderList", ctxA, {});
    assert.equal(list.workOrders[0].category, "raw materials");
    const spend = dispatch("spendAnalytics", ctxA, { orders: [] });
    assert.ok(spend.byCategory.some(c => c.name === "raw materials" && c.amount === 20));
  });
});

/* ──────────────────── F9 + F5 — scenarios / network ────────────────── */

describe("F9 scenarioSimulate → replenish prices the stockout units", () => {
  it("reproduces the review's corrected figure: 1,700 units × $11.50 = $19,550, not $35,650", () => {
    const result = dispatch("scenarioSimulate", ctxA, {
      name: "Port closure check", disruption: "port_closure",
      baseDailyDemand: 100, baseLeadTimeDays: 14, baseUnitCost: 10,
    });
    const primary = result.options[0];
    // effLead = ceil(14 × 2.2) = 31 → demand during lead 3,100; onHand 1,400 → stockout 1,700.
    assert.equal(primary.demandDuringLead, 3100);
    assert.equal(primary.projectedStockoutUnits, 1700);
    assert.equal(primary.replenishCost, 19550);
  });

  it("a scenario that stocks out nowhere costs nothing to replenish", () => {
    const result = dispatch("scenarioSimulate", ctxA, {
      disruption: "none", baseDailyDemand: 10, baseLeadTimeDays: 5, baseUnitCost: 10, currentStock: 5000,
    });
    assert.equal(result.options[0].projectedStockoutUnits, 0);
    assert.equal(result.options[0].replenishCost, 0);
    assert.equal(result.resilient, true);
  });
});

describe("F5 scenarios persist in-process across reads (the lens-layer contract)", () => {
  it("simulate → list → list holds the scenario; delete removes exactly it", () => {
    dispatch("scenarioSimulate", ctxA, { name: "Persist me", disruption: "demand_spike", baseDailyDemand: 50, baseLeadTimeDays: 7, baseUnitCost: 4 });
    const first = dispatch("scenarioList", ctxA, {});
    assert.equal(first.scenarios.length, 1);
    assert.equal(first.scenarios[0].name, "Persist me");
    const second = dispatch("scenarioList", ctxA, {});
    assert.equal(second.scenarios.length, 1);
    const other = dispatch("scenarioList", ctxB, {});
    assert.equal(other.scenarios.length, 0);
    const removed = dispatch("scenarioDelete", ctxA, { scenarioId: first.scenarios[0].id });
    assert.equal(removed.removed, 1);
    assert.equal(dispatch("scenarioList", ctxA, {}).scenarios.length, 0);
  });
});

describe("F9 networkGet → the saved network, raw, for the editors", () => {
  it("round-trips exactly what networkSet saved", () => {
    dispatch("networkSet", ctxA, {
      nodes: [
        { id: "s1", label: "Shenzhen Mill", kind: "supplier", location: "Shenzhen", capacity: 5000 },
        { id: "w1", label: "LA DC", kind: "warehouse", location: "Los Angeles", capacity: 8000 },
      ],
      edges: [{ from: "s1", to: "w1", leadTimeDays: 21, volume: 4000 }],
    });
    const got = dispatch("networkGet", ctxA, {});
    assert.equal(got.saved, true);
    assert.equal(got.nodes.length, 2);
    assert.equal(got.nodes[0].id, "s1");
    assert.deepEqual(got.edges, [{ from: "s1", to: "w1", leadTimeDays: 21, volume: 4000 }]);
    const fresh = dispatch("networkGet", ctxB, {});
    assert.equal(fresh.saved, false);
    assert.deepEqual(fresh.nodes, []);
  });
});
