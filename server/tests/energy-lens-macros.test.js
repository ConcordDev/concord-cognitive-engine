// Behavioral macro tests for server/domains/energy.js — the energy lens
// (Sense / Span / EIA-shape home energy monitor). EVERY macro is registered
// via `registerLensAction(domain, action, handler)` and invoked as
// `handler(ctx, virtualArtifact, params)` (the 3-ARG path-3 convention with
// `virtualArtifact.data === params`). The /api/lens/run dispatch ALSO peels
// exactly one redundant `{ artifact: { data } }` wrapper
// (server/lib/lens-input-normalize.js) before building the virtualArtifact, so
// we peel the SAME way here — the harness is byte-identical to what the
// frontend hits through `lensRun(...)` / `CalcPanel`'s
// `runDomain(d, a, { input: { artifact: { data } } })`.
//
// These are NOT shape-only assertions. Each test feeds KNOWN inputs and pins
// EXACT computed values + round-trips (consumption sums, solar sizing, carbon
// EPA factors, grid utilization, device/reading CRUD, bill estimate,
// disaggregation weighting, TOU peak/off-peak split, self-consumption,
// month-over-month deltas), the EXACT field names each component RENDERS (so a
// dead-surface regression surfaces here), validation-rejection, graceful
// degradation on empty state, and a fail-CLOSED poisoned-numeric contract:
// Infinity / NaN / "1e999" / "Infinity" never leak NaN/Infinity (which
// serialize to JSON null) into the result and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnergyActions from "../domains/energy.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "energy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Mirror the live /api/lens/run dispatch for the path-3 surface: peel one
// redundant artifact wrapper, then call handler(ctx, virtualArtifact, peeled)
// with virtualArtifact.data === peeled. `body` is what the frontend sends as
// the `input` field.
function call(name, ctx, body = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`energy.${name} not registered`);
  const peeled = peelRedundantArtifactWrapper(body) || {};
  const virtualArtifact = { id: null, domain: "energy", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, virtualArtifact, peeled);
}

// CalcPanel-shape call: the component builds `{ input: { artifact: { data } } }`.
// runDomain forwards `{ artifact: { data } }` as the body, which the dispatch
// peels to the plain `data` object. Drive that EXACT shape so the test proves
// the SolarCarbonPanel wiring (not a hand-flattened one).
function callCalcPanel(name, ctx, data) {
  return call(name, ctx, { artifact: { data } });
}

// Assert no value anywhere in the result is a non-finite number, and that the
// serialized JSON contains no Infinity/NaN tokens and no unexpected null where
// a number is expected. (JSON.stringify turns Infinity/NaN into null.)
function assertFinite(obj, label) {
  const walk = (v, path) => {
    if (typeof v === "number") {
      assert.ok(Number.isFinite(v), `${label}: non-finite number at ${path}: ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(obj, label);
}

before(() => {
  registerEnergyActions(registerLensAction);
});

beforeEach(() => {
  // No boot, no network. Any handler reaching the network in a pure-compute /
  // STATE test is a leak.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
});

// ──────────────────────────────────────────────────────────────────────────
// Pure-compute calculators (SolarCarbonPanel + grid/consumption surfaces)
// ──────────────────────────────────────────────────────────────────────────
describe("energy — pure-compute calculators (exact values)", () => {
  it("consumptionAnalysis: exact total/avg/peak/cost/ratio", () => {
    const r = call("consumptionAnalysis", ctxA, { readings: [{ kWh: 10 }, { kWh: 20 }, { kWh: 30 }], costPerKWh: 0.2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalKWh, 60);
    assert.equal(r.result.avgKWh, 20);
    assert.equal(r.result.peakKWh, 30);
    assert.equal(r.result.readingCount, 3);
    assert.equal(r.result.estimatedCost, 12); // 60 * 0.2
    assert.equal(r.result.costPerKWh, 0.2);
    assert.equal(r.result.peakToAvgRatio, 1.5); // 30/20
    assert.equal(r.result.savingsOpportunity, "Consumption is relatively stable");
  });

  it("consumptionAnalysis: peak>2*avg flags savings opportunity", () => {
    const r = call("consumptionAnalysis", ctxA, { readings: [{ kWh: 1 }, { kWh: 1 }, { kWh: 10 }] });
    assert.equal(r.result.savingsOpportunity, "Significant peak reduction possible");
    assert.equal(r.result.costPerKWh, 0.12); // default fallback
  });

  it("consumptionAnalysis: empty readings → guidance, never NaN", () => {
    const r = call("consumptionAnalysis", ctxA, { readings: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add energy readings/i);
    assert.equal(r.result.totalKWh, undefined);
  });

  it("solarEstimate: exact sizing math for 1000 sqft / 5 sun / 900 usage", () => {
    // CalcPanel sends { artifact: { data: { roofAreaSqFt, peakSunHours, monthlyUsageKWh } } }.
    const r = callCalcPanel("solarEstimate", ctxA, { roofAreaSqFt: 1000, peakSunHours: 5, monthlyUsageKWh: 900 });
    assert.equal(r.ok, true);
    // maxPanels = floor(1000 * 0.7 / 18) = floor(38.88) = 38
    assert.equal(r.result.maxPanels, 38);
    // systemKW = 38 * 400 / 1000 = 15.2
    assert.equal(r.result.systemSizeKW, 15.2);
    // monthlyProduction = 15.2 * 5 * 30 * 0.8 = 1824
    assert.equal(r.result.monthlyProductionKWh, 1824);
    // coverage = round(1824/900*100) = 203
    assert.equal(r.result.coveragePercent, 203);
    // cost = round(15.2 * 2800) = 42560
    assert.equal(r.result.estimatedCost, 42560);
    assert.equal(r.result.afterTaxCredit, Math.round(42560 * 0.7));
    assert.match(r.result.recommendation, /100% of usage/);
  });

  it("carbonFootprint: exact EPA factors + topSource + tips", () => {
    const r = callCalcPanel("carbonFootprint", ctxA, {
      electricityKWh: 1000, naturalGasTherms: 50, gasolineGallons: 40, flightMiles: 2000,
    });
    assert.equal(r.ok, true);
    // 1000 * 0.000417 = 0.417
    assert.equal(r.result.breakdown.electricity, 0.417);
    // 50 * 0.0053 = 0.265
    assert.equal(r.result.breakdown.naturalGas, 0.265);
    // 40 * 0.00887 = 0.3548 → 0.355
    assert.equal(r.result.breakdown.transportation, 0.355);
    // 2000 * 0.000255 = 0.51
    assert.equal(r.result.breakdown.flights, 0.51);
    const total = 0.417 + 0.265 + 0.3548 + 0.51;
    assert.equal(r.result.totalMetricTons, Math.round(total * 1000) / 1000);
    assert.equal(r.result.annualEstimate, Math.round(total * 12 * 100) / 100);
    assert.equal(r.result.topSource, "flights"); // highest single
    assert.ok(Array.isArray(r.result.reductionTips) && r.result.reductionTips.length > 0);
  });

  it("gridStatus: exact utilization/status/reserves + stable string echo", () => {
    const r = call("gridStatus", ctxA, { currentDemandMW: 800, totalCapacityMW: 1000, renewablePercent: 35, gridFrequencyHz: 60.01 });
    assert.equal(r.ok, true);
    assert.equal(r.result.utilization, 80);
    assert.equal(r.result.status, "high-load"); // >75
    assert.equal(r.result.currentDemand, "800 MW");
    assert.equal(r.result.totalCapacity, "1000 MW");
    assert.equal(r.result.renewableShare, "35%");
    assert.equal(r.result.frequencyStable, true); // |60.01-60| < 0.05
    assert.equal(r.result.reserves, "200 MW available");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Fail-CLOSED poisoned-numeric contract
// ──────────────────────────────────────────────────────────────────────────
describe("energy — fail-closed poison (no Infinity/NaN leak, no throw)", () => {
  const POISON = ["1e999", "Infinity", "-Infinity", "NaN", Infinity, NaN, "not-a-number"];

  it("consumptionAnalysis: poisoned readings collapse to finite", () => {
    for (const p of POISON) {
      const r = call("consumptionAnalysis", ctxA, { readings: [{ kWh: p }, { kWh: 5 }], costPerKWh: p });
      assert.equal(r.ok, true);
      assertFinite(r.result, `consumptionAnalysis(${String(p)})`);
      // The one valid reading (5) survives; poison contributes 0.
      assert.equal(r.result.totalKWh, 5);
      assert.ok(r.result.costPerKWh > 0); // falls back to default, finite
    }
  });

  it("solarEstimate: poisoned inputs clamp to finite, never Infinity panels", () => {
    for (const p of POISON) {
      const r = callCalcPanel("solarEstimate", ctxA, { roofAreaSqFt: p, peakSunHours: p, monthlyUsageKWh: p });
      assert.equal(r.ok, true);
      assertFinite(r.result, `solarEstimate(${String(p)})`);
      assert.ok(Number.isInteger(r.result.maxPanels));
    }
  });

  it("carbonFootprint: poisoned inputs → finite zeros, never null", () => {
    for (const p of POISON) {
      const r = callCalcPanel("carbonFootprint", ctxA, { electricityKWh: p, naturalGasTherms: p, gasolineGallons: p, flightMiles: p });
      assert.equal(r.ok, true);
      assertFinite(r.result, `carbonFootprint(${String(p)})`);
      assert.equal(r.result.totalMetricTons, 0);
    }
  });

  it("gridStatus: poisoned inputs → finite, output strings never 'Infinity MW'", () => {
    for (const p of POISON) {
      const r = call("gridStatus", ctxA, { currentDemandMW: p, totalCapacityMW: p, renewablePercent: p, gridFrequencyHz: p });
      assert.equal(r.ok, true);
      assert.doesNotMatch(JSON.stringify(r.result), /Infinity|NaN/);
      assert.ok(Number.isFinite(r.result.utilization));
    }
  });

  it("reading-log / live-sample / goal-set / rate-set reject or clamp poison", () => {
    // STATE macros use the finite-guarded enNum; poison kWh collapses to 0 and
    // the >0 validation rejects cleanly (never throws, never NaN).
    const rl = call("reading-log", ctxA, { kwh: "1e999" });
    // enNum("1e999") → 0 → kwh<=0 → rejected
    assert.equal(rl.ok, false);
    const rs = call("rate-set", ctxA, { ratePerKwh: "Infinity" });
    assert.equal(rs.ok, false);
    const gs = call("goal-set", ctxA, { targetKwh: NaN });
    assert.equal(gs.ok, false);
    const ls = call("live-sample", ctxA, { watts: "NaN" });
    // enNum("NaN") → 0; watts>=0 true → logged at 0 watts (finite)
    assert.equal(ls.ok, true);
    assert.equal(ls.result.sample.watts, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// STATE-backed monitor: devices / readings round-trips (DevicesPanel + UsagePanel)
// ──────────────────────────────────────────────────────────────────────────
describe("energy — devices + readings CRUD round-trip", () => {
  it("device-add → device-list renders name/category/wattage/totalKwh", () => {
    const add = call("device-add", ctxA, { name: "Heat Pump", category: "hvac", wattage: 3500 });
    assert.equal(add.ok, true);
    const id = add.result.device.id;
    assert.equal(add.result.device.name, "Heat Pump");
    assert.equal(add.result.device.category, "hvac");
    assert.equal(add.result.device.wattage, 3500);

    // Log a device-tagged reading.
    const log = call("reading-log", ctxA, { deviceId: id, kwh: 12.5 });
    assert.equal(log.ok, true);
    assert.equal(log.result.reading.deviceId, id);
    assert.equal(log.result.reading.kwh, 12.5);

    const list = call("device-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const d = list.result.devices[0];
    // EXACT fields DevicesPanel renders:
    assert.deepEqual(Object.keys(d).sort().includes("totalKwh"), true);
    assert.equal(d.totalKwh, 12.5);
    assert.equal(d.readingCount, 1);
  });

  it("device-add rejects empty name; device-delete removes + purges readings", () => {
    const bad = call("device-add", ctxA, { name: "   " });
    assert.equal(bad.ok, false);

    const add = call("device-add", ctxA, { name: "Dryer", wattage: 3000 });
    const id = add.result.device.id;
    call("reading-log", ctxA, { deviceId: id, kwh: 4 });
    const del = call("device-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    // readings purged
    const hist = call("reading-history", ctxA, { days: 30 });
    assert.equal(hist.result.series.length, 0);
    assert.equal(call("device-delete", ctxA, { id }).ok, false); // gone
  });

  it("reading-history: per-day aggregation + total kwh/cost (UsagePanel)", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.25 });
    const today = new Date().toISOString().slice(0, 10);
    call("reading-log", ctxA, { kwh: 10, date: today });
    call("reading-log", ctxA, { kwh: 5, date: today });
    const h = call("reading-history", ctxA, { days: 30 });
    assert.equal(h.ok, true);
    assert.equal(h.result.totalKwh, 15);
    // cost summed per reading at 0.25/kWh: 10*.25=2.5, 5*.25=1.25 → 3.75
    assert.equal(h.result.totalCost, 3.75);
    const day = h.result.series.find((s) => s.date === today);
    assert.equal(day.kwh, 15);
  });

  it("usage-breakdown + top-consumers attribute by device category", () => {
    const add = call("device-add", ctxA, { name: "AC", category: "hvac", wattage: 2000 });
    const id = add.result.device.id;
    call("reading-log", ctxA, { deviceId: id, kwh: 20 });
    call("reading-log", ctxA, { kwh: 5 }); // whole-home / untracked
    const b = call("usage-breakdown", ctxA, { days: 30 });
    assert.equal(b.ok, true);
    assert.equal(b.result.totalKwh, 25);
    assert.equal(b.result.untrackedKwh, 5);
    const hvac = b.result.breakdown.find((x) => x.category === "hvac");
    assert.equal(hvac.kwh, 20);
    assert.equal(hvac.pct, 80); // 20/25

    const tc = call("top-consumers", ctxA, { days: 30 });
    assert.equal(tc.result.devices[0].deviceId, id);
    assert.equal(tc.result.devices[0].kwh, 20);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Billing surface: rate / bill-estimate / cost-projection / goals
// ──────────────────────────────────────────────────────────────────────────
describe("energy — billing + goals (BillingPanel)", () => {
  it("rate-get default → rate-set → bill-estimate uses set rate", () => {
    const g0 = call("rate-get", ctxA, {});
    assert.equal(g0.result.isDefault, true);
    assert.equal(g0.result.rate.ratePerKwh, 0.17); // DEFAULT_RATE

    call("rate-set", ctxA, { ratePerKwh: 0.30, utility: "PG&E" });
    const g1 = call("rate-get", ctxA, {});
    assert.equal(g1.result.isDefault, false);
    assert.equal(g1.result.rate.ratePerKwh, 0.30);

    const month = new Date().toISOString().slice(0, 7);
    call("reading-log", ctxA, { kwh: 100, date: `${month}-15` });
    call("solar-log", ctxA, { kwh: 30, date: `${month}-15` });
    const bill = call("bill-estimate", ctxA, {});
    assert.equal(bill.ok, true);
    assert.equal(bill.result.consumedKwh, 100);
    assert.equal(bill.result.solarKwh, 30);
    assert.equal(bill.result.netKwh, 70);
    assert.equal(bill.result.estimatedBill, Math.round(70 * 0.30 * 100) / 100);
    assert.equal(bill.result.solarSavings, Math.round(30 * 0.30 * 100) / 100);
  });

  it("cost-projection: empty month → hasData:false; with data → projected math", () => {
    const empty = call("cost-projection", ctxA, {});
    assert.equal(empty.result.hasData, false);

    const month = new Date().toISOString().slice(0, 7);
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    call("reading-log", ctxA, { kwh: 10, date: `${month}-01` });
    call("reading-log", ctxA, { kwh: 10, date: `${month}-02` });
    const p = call("cost-projection", ctxA, {});
    assert.equal(p.result.hasData, true);
    assert.equal(p.result.distinctDays, 2);
    assert.equal(p.result.loggedKwh, 20);
    assert.equal(p.result.dailyAvgKwh, 10);
    assertFinite(p.result, "cost-projection");
    assert.ok(["low", "medium", "high"].includes(p.result.confidence));
  });

  it("goal-set → goal-list computes pct/overBudget; goal-delete removes", () => {
    const month = new Date().toISOString().slice(0, 7);
    call("reading-log", ctxA, { kwh: 120, date: `${month}-10` });
    const gs = call("goal-set", ctxA, { label: "Cut bill", targetKwh: 100, period: "month" });
    assert.equal(gs.ok, true);
    const id = gs.result.goal.id;
    const gl = call("goal-list", ctxA, {});
    const goal = gl.result.goals.find((x) => x.id === id);
    assert.equal(goal.targetKwh, 100);
    assert.equal(goal.usedKwh, 120);
    assert.equal(goal.pct, 120);
    assert.equal(goal.overBudget, true);
    const gd = call("goal-delete", ctxA, { id });
    assert.equal(gd.ok, true);
    assert.equal(call("goal-list", ctxA, {}).result.count, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Solar / disaggregation / TOU / live / insights
// ──────────────────────────────────────────────────────────────────────────
describe("energy — solar self-consumption + disaggregation + TOU + insights", () => {
  it("solar-summary + solar-self-consumption: produced/self/export split", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    const day = new Date().toISOString().slice(0, 10);
    call("solar-log", ctxA, { kwh: 30, date: day });
    call("reading-log", ctxA, { kwh: 20, date: day });

    const sum = call("solar-summary", ctxA, { days: 30 });
    assert.equal(sum.result.producedKwh, 30);
    assert.equal(sum.result.consumedKwh, 20);

    const sc = call("solar-self-consumption", ctxA, { days: 30 });
    assert.equal(sc.result.hasData, true);
    assert.equal(sc.result.selfConsumedKwh, 20); // min(30,20)
    assert.equal(sc.result.exportedKwh, 10); // 30-20
    assertFinite(sc.result, "solar-self-consumption");
  });

  it("solar-self-consumption honors a real export tariff override", () => {
    const day = new Date().toISOString().slice(0, 10);
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    call("solar-log", ctxA, { kwh: 30, date: day });
    call("reading-log", ctxA, { kwh: 20, date: day });
    const sc = call("solar-self-consumption", ctxA, { days: 30, exportRate: 0.05 });
    assert.equal(sc.result.exportRate, 0.05);
    assert.equal(sc.result.exportCredit, Math.round(10 * 0.05 * 100) / 100); // 0.5
  });

  it("disaggregate: nameplate-weighted split of whole-home load", () => {
    const a1 = call("device-add", ctxA, { name: "AC", category: "hvac", wattage: 3000 });
    const a2 = call("device-add", ctxA, { name: "Lights", category: "lighting", wattage: 1000 });
    call("reading-log", ctxA, { kwh: 40 }); // whole-home, split 3:1
    const d = call("disaggregate", ctxA, { days: 30 });
    assert.equal(d.result.totalKwh, 40);
    const ac = d.result.devices.find((x) => x.deviceId === a1.result.device.id);
    const lights = d.result.devices.find((x) => x.deviceId === a2.result.device.id);
    // 3000/4000 * 40 = 30 ; 1000/4000 * 40 = 10
    assert.equal(ac.estimatedKwh, 30);
    assert.equal(lights.estimatedKwh, 10);
    assertFinite(d.result, "disaggregate");
  });

  it("disaggregate: no devices → empty, finite, hasData-equivalent zeros", () => {
    const d = call("disaggregate", ctxA, { days: 30 });
    assert.equal(d.ok, true);
    assert.deepEqual(d.result.devices, []);
    assert.equal(d.result.totalKwh, 0);
  });

  it("tou-set rejects invalid windows; tou-breakdown splits hour-tagged readings", () => {
    const bad = call("tou-set", ctxA, { peakRate: 0.4, offPeakRate: 0 });
    assert.equal(bad.ok, false);
    const badWindow = call("tou-set", ctxA, { peakRate: 0.4, offPeakRate: 0.1, peakStartHour: 20, peakEndHour: 16 });
    assert.equal(badWindow.ok, false);

    const ok = call("tou-set", ctxA, { peakRate: 0.4, offPeakRate: 0.1, peakStartHour: 16, peakEndHour: 21 });
    assert.equal(ok.ok, true);
    const day = new Date().toISOString().slice(0, 10);
    call("reading-log", ctxA, { kwh: 10, date: day, hour: 18 }); // peak
    call("reading-log", ctxA, { kwh: 5, date: day, hour: 3 });   // off-peak
    const b = call("tou-breakdown", ctxA, { days: 30 });
    assert.equal(b.result.peak.kwh, 10);
    assert.equal(b.result.offPeak.kwh, 5);
    assert.equal(b.result.peak.cost, Math.round(10 * 0.4 * 100) / 100);
    assert.equal(b.result.offPeak.cost, Math.round(5 * 0.1 * 100) / 100);
    assertFinite(b.result, "tou-breakdown");
  });

  it("tou-breakdown without a plan rejects cleanly", () => {
    const b = call("tou-breakdown", ctxA, { days: 30 });
    assert.equal(b.ok, false);
  });

  it("live-sample → live-stream rolling window current/peak/avg", () => {
    call("live-sample", ctxA, { watts: 500 });
    call("live-sample", ctxA, { watts: 1500 });
    call("live-sample", ctxA, { watts: 1000 });
    const s = call("live-stream", ctxA, { minutes: 120 });
    assert.equal(s.result.count, 3);
    assert.equal(s.result.current, 1000); // last
    assert.equal(s.result.peak, 1500);
    assert.equal(s.result.avgWatts, 1000); // (500+1500+1000)/3
    assertFinite(s.result, "live-stream");
  });

  it("usage-alerts: empty state → no alerts; goal over budget → high alert", () => {
    const none = call("usage-alerts", ctxA, {});
    assert.equal(none.ok, true);
    assert.equal(none.result.count, 0);

    const month = new Date().toISOString().slice(0, 7);
    call("reading-log", ctxA, { kwh: 200, date: `${month}-10` });
    call("goal-set", ctxA, { label: "Budget", targetKwh: 100, period: "month" });
    const a = call("usage-alerts", ctxA, {});
    assert.ok(a.result.alerts.some((x) => x.kind === "goal_exceeded" && x.severity === "high"));
    assert.ok(a.result.highCount >= 1);
  });

  it("month-comparison: rejects malformed month, computes deltas with data", () => {
    const bad = call("month-comparison", ctxA, { month: "not-a-month" });
    assert.equal(bad.ok, false);

    const month = new Date().toISOString().slice(0, 7);
    call("reading-log", ctxA, { kwh: 50, date: `${month}-05` });
    const c = call("month-comparison", ctxA, {});
    assert.equal(c.ok, true);
    assert.equal(c.result.current.consumedKwh, 50);
    assert.equal(c.result.hasData, true);
    assert.ok(["up", "down", "flat"].includes(c.result.change.consumed.direction));
    assertFinite(c.result, "month-comparison");
  });

  it("energy-dashboard: aggregates this month + device/goal counts", () => {
    const month = new Date().toISOString().slice(0, 7);
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    call("device-add", ctxA, { name: "Fridge", category: "appliance", wattage: 150 });
    call("reading-log", ctxA, { kwh: 60, date: `${month}-10` });
    call("solar-log", ctxA, { kwh: 20, date: `${month}-10` });
    const d = call("energy-dashboard", ctxA, {});
    assert.equal(d.ok, true);
    assert.equal(d.result.devices, 1);
    assert.equal(d.result.monthKwh, 60);
    assert.equal(d.result.solarKwh, 20);
    assert.equal(d.result.monthCost, Math.round(Math.max(0, 60 - 20) * 0.20 * 100) / 100);
    assert.equal(d.result.solarOffsetPct, Math.round((20 / 60) * 100));
    assertFinite(d.result, "energy-dashboard");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Per-user isolation (the lens is multi-tenant; one user can't read another)
// ──────────────────────────────────────────────────────────────────────────
describe("energy — per-user STATE isolation", () => {
  it("user_b cannot see user_a's devices/readings", () => {
    call("device-add", ctxA, { name: "A-only device", wattage: 500 });
    call("reading-log", ctxA, { kwh: 99 });
    const bList = call("device-list", ctxB, {});
    assert.equal(bList.result.count, 0);
    const bHist = call("reading-history", ctxB, { days: 30 });
    assert.equal(bHist.result.totalKwh, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// External-IO macros degrade gracefully (no key / network down) — fail-closed
// ──────────────────────────────────────────────────────────────────────────
describe("energy — EIA + carbon feed degrade gracefully (no throw)", () => {
  it("eia-electricity-rates: validates state + degrades without key", async () => {
    const noState = await call("eia-electricity-rates", ctxA, {});
    assert.equal(noState.ok, false);
    assert.match(noState.error, /state required/i);

    const badState = await call("eia-electricity-rates", ctxA, { state: "ZZZ" });
    assert.equal(badState.ok, false);

    const saved = process.env.EIA_API_KEY;
    delete process.env.EIA_API_KEY;
    const noKey = await call("eia-electricity-rates", ctxA, { state: "CA" });
    assert.equal(noKey.ok, false);
    assert.match(noKey.error, /EIA_API_KEY/);
    if (saved) process.env.EIA_API_KEY = saved;
  });

  it("eia-generation-mix: degrades without key (no throw)", async () => {
    const saved = process.env.EIA_API_KEY;
    delete process.env.EIA_API_KEY;
    const r = await call("eia-generation-mix", ctxA, { region: "US" });
    assert.equal(r.ok, false);
    assert.match(r.error, /EIA_API_KEY/);
    if (saved) process.env.EIA_API_KEY = saved;
  });
});
