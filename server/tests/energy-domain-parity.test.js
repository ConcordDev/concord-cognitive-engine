// Contract tests for server/domains/energy.js — pure-compute helpers
// plus real EIA (US Energy Information Administration) integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnergyActions from "../domains/energy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`energy.${name}`);
  if (!fn) throw new Error(`energy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerEnergyActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.EIA_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("energy.consumptionAnalysis (pure compute)", () => {
  it("computes total + avg + peak-to-avg ratio", () => {
    const r = call("consumptionAnalysis", ctxA, {
      data: { readings: [{ kWh: 10 }, { kWh: 15 }, { kWh: 50 }, { kWh: 20 }] },
    }, {});
    assert.equal(r.result.totalKWh, 95);
    assert.equal(r.result.peakKWh, 50);
    // peak/avg = 50/23.75 ≈ 2.1
    assert.ok(r.result.peakToAvgRatio > 2);
  });
});

describe("energy.carbonFootprint (EPA emission factors)", () => {
  it("computes carbon from electricity + gas + gasoline + flights", () => {
    const r = call("carbonFootprint", ctxA, {
      data: {
        electricityKWh: 1000, naturalGasTherms: 50,
        gasolineGallons: 30, flightMiles: 500,
      },
    }, {});
    assert.equal(r.ok, true);
    // 0.417 + 0.265 + 0.2661 + 0.1275 ≈ 1.076 metric tons
    assert.ok(r.result.totalMetricTons > 1 && r.result.totalMetricTons < 1.2);
  });
});

describe("energy.eia-electricity-rates (EIA API)", () => {
  it("rejects missing/bad state", async () => {
    assert.equal((await call("eia-electricity-rates", ctxA, {})).ok, false);
    assert.equal((await call("eia-electricity-rates", ctxA, { state: "C" })).ok, false);
  });

  it("rejects when EIA_API_KEY env not set", async () => {
    const r = await call("eia-electricity-rates", ctxA, { state: "CA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /EIA_API_KEY env required/);
  });

  it("hits EIA + parses real response", async () => {
    process.env.EIA_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          response: {
            data: [
              { period: "2026-04", stateDescription: "California", sectorName: "residential", price: 29.5 },
              { period: "2026-03", stateDescription: "California", sectorName: "residential", price: 29.1 },
              { period: "2026-02", stateDescription: "California", sectorName: "residential", price: 28.9 },
              { period: "2026-01", stateDescription: "California", sectorName: "residential", price: 28.7 },
              { period: "2025-12", stateDescription: "California", sectorName: "residential", price: 28.5 },
              { period: "2025-11", stateDescription: "California", sectorName: "residential", price: 28.3 },
              { period: "2025-10", stateDescription: "California", sectorName: "residential", price: 28.0 },
              { period: "2025-09", stateDescription: "California", sectorName: "residential", price: 27.8 },
              { period: "2025-08", stateDescription: "California", sectorName: "residential", price: 27.6 },
              { period: "2025-07", stateDescription: "California", sectorName: "residential", price: 27.4 },
              { period: "2025-06", stateDescription: "California", sectorName: "residential", price: 27.2 },
              { period: "2025-05", stateDescription: "California", sectorName: "residential", price: 27.0 },
            ],
          },
        }),
      };
    };
    const r = await call("eia-electricity-rates", ctxA, { state: "CA" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.eia\.gov\/v2\/electricity\/retail-sales/);
    assert.match(capturedUrl, /facets\[stateid\]\[\]=CA/);
    assert.match(capturedUrl, /facets\[sectorid\]\[\]=RES/);
    assert.equal(r.result.latest.priceCentsPerKwh, 29.5);
    // 12-month delta: (29.5 - 27.0) / 27.0 * 100 ≈ 9.3%
    assert.ok(r.result.yearOverYearChangePct > 9 && r.result.yearOverYearChangePct < 10);
    assert.equal(r.result.source, "eia-electricity-retail-sales");
  });

  it("surfaces 403 invalid-key cleanly", async () => {
    process.env.EIA_API_KEY = "bad";
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const r = await call("eia-electricity-rates", ctxA, { state: "CA" });
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid or quota/);
  });
});

describe("energy.eia-generation-mix (EIA API)", () => {
  it("rejects when EIA_API_KEY env not set", async () => {
    const r = await call("eia-generation-mix", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /EIA_API_KEY/);
  });

  it("groups latest period by fuel + computes renewable share", async () => {
    process.env.EIA_API_KEY = "test-key";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        response: {
          data: [
            { period: "2026-04", fueltypeDescription: "Natural Gas", generation: 150000 },
            { period: "2026-04", fueltypeDescription: "Nuclear", generation: 70000 },
            { period: "2026-04", fueltypeDescription: "Solar", generation: 40000 },
            { period: "2026-04", fueltypeDescription: "Wind", generation: 60000 },
            { period: "2026-04", fueltypeDescription: "Hydroelectric", generation: 20000 },
            { period: "2026-04", fueltypeDescription: "Coal", generation: 60000 },
            // Older period — should be filtered out
            { period: "2026-03", fueltypeDescription: "Natural Gas", generation: 140000 },
          ],
        },
      }),
    });
    const r = await call("eia-generation-mix", ctxA, { region: "US" });
    assert.equal(r.ok, true);
    assert.equal(r.result.latestPeriod, "2026-04");
    // Latest only: total = 400,000 MWh; mix sorted by mwh desc
    assert.equal(r.result.mix[0].fuel, "Natural Gas");
    assert.equal(r.result.totalMWh, 400000);
    // Renewable share: solar 10% + wind 15% + hydroelectric 5% = 30%
    assert.ok(r.result.renewableSharePct > 28 && r.result.renewableSharePct < 32);
    assert.equal(r.result.source, "eia-electric-power-operational");
  });
});

// ─── Parity backlog: substrate-backed features ──────────────────────────
// All of these need globalThis._concordSTATE seeded as an empty store.

const month = () => new Date().toISOString().slice(0, 10).slice(0, 7);
function seedState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
}

describe("energy.live-sample / live-stream — real-time consumption", () => {
  beforeEach(seedState);

  it("rejects negative wattage", () => {
    const r = call("live-sample", ctxA, { watts: -5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /watts/);
  });

  it("logs samples and streams them back with current/peak/avg", () => {
    call("live-sample", ctxA, { watts: 400 });
    call("live-sample", ctxA, { watts: 1200 });
    call("live-sample", ctxA, { watts: 800 });
    const r = call("live-stream", ctxA, { minutes: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.current, 800);
    assert.equal(r.result.peak, 1200);
    assert.equal(r.result.avgWatts, 800);
  });

  it("empty stream returns zeros not fake data", () => {
    const r = call("live-stream", ctxA, {});
    assert.equal(r.result.count, 0);
    assert.equal(r.result.current, 0);
    assert.equal(r.result.peak, 0);
  });

  it("INVARIANT: live stream scoped per-user", () => {
    call("live-sample", ctxA, { watts: 500 });
    const b = call("live-stream", { actor: { userId: "user_b" }, userId: "user_b" }, {});
    assert.equal(b.result.count, 0);
  });
});

describe("energy.disaggregate — per-device attribution", () => {
  beforeEach(seedState);

  it("empty when no devices", () => {
    const r = call("disaggregate", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.devices.length, 0);
  });

  it("attributes whole-home load by nameplate wattage weight", () => {
    const d1 = call("device-add", ctxA, { name: "AC", category: "hvac", wattage: 3000 }).result.device;
    const d2 = call("device-add", ctxA, { name: "Fridge", category: "appliance", wattage: 1000 }).result.device;
    // 100 kWh whole-home reading, split 75/25 by wattage weight.
    call("reading-log", ctxA, { kwh: 100 });
    const r = call("disaggregate", ctxA, { days: 30 });
    const ac = r.result.devices.find((x) => x.deviceId === d1.id);
    const fridge = r.result.devices.find((x) => x.deviceId === d2.id);
    assert.equal(ac.estimatedKwh, 75);
    assert.equal(fridge.estimatedKwh, 25);
    assert.equal(r.result.attributedKwh, 100);
  });

  it("combines metered + estimated when device has direct readings", () => {
    const d1 = call("device-add", ctxA, { name: "EV", category: "ev_charger", wattage: 7000 }).result.device;
    call("reading-log", ctxA, { deviceId: d1.id, kwh: 20 });
    call("reading-log", ctxA, { kwh: 10 });
    const r = call("disaggregate", ctxA, { days: 30 });
    const ev = r.result.devices.find((x) => x.deviceId === d1.id);
    assert.equal(ev.directKwh, 20);
    assert.equal(ev.estimatedKwh, 10); // sole device gets all whole-home
    assert.equal(ev.method, "metered+estimated");
  });
});

describe("energy.cost-projection — monthly bill projection", () => {
  beforeEach(seedState);

  it("returns hasData false when no readings", () => {
    const r = call("cost-projection", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
  });

  it("projects full-month consumption from logged days", () => {
    const m = month();
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    call("reading-log", ctxA, { kwh: 30, date: `${m}-01` });
    call("reading-log", ctxA, { kwh: 30, date: `${m}-02` });
    const r = call("cost-projection", ctxA, { month: m });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.dailyAvgKwh, 30);
    // projectedKwh = 30 * daysInMonth
    assert.equal(r.result.projectedKwh, 30 * r.result.daysInMonth);
    assert.equal(r.result.projectedBill, Math.round(30 * r.result.daysInMonth * 0.20 * 100) / 100);
  });
});

describe("energy.tou-set / tou-get / tou-breakdown — time-of-use", () => {
  beforeEach(seedState);

  it("rejects invalid plan", () => {
    assert.equal(call("tou-set", ctxA, { peakRate: 0, offPeakRate: 0.1 }).ok, false);
    assert.equal(call("tou-set", ctxA, { peakRate: 0.4, offPeakRate: 0.1, peakStartHour: 20, peakEndHour: 16 }).ok, false);
  });

  it("stores and retrieves a plan", () => {
    const s = call("tou-set", ctxA, { peakRate: 0.45, offPeakRate: 0.12, peakStartHour: 16, peakEndHour: 21 });
    assert.equal(s.ok, true);
    const g = call("tou-get", ctxA, {});
    assert.equal(g.result.configured, true);
    assert.equal(g.result.plan.peakRate, 0.45);
  });

  it("tou-breakdown splits peak vs off-peak by reading hour", () => {
    call("tou-set", ctxA, { peakRate: 0.50, offPeakRate: 0.10, peakStartHour: 16, peakEndHour: 21 });
    call("reading-log", ctxA, { kwh: 10, hour: 18 }); // peak
    call("reading-log", ctxA, { kwh: 20, hour: 3 });  // off-peak
    const r = call("tou-breakdown", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.peak.kwh, 10);
    assert.equal(r.result.offPeak.kwh, 20);
    assert.equal(r.result.peak.cost, 5);
    assert.equal(r.result.offPeak.cost, 2);
  });

  it("tou-breakdown requires a plan", () => {
    const r = call("tou-breakdown", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no time-of-use plan/);
  });
});

describe("energy.solar-self-consumption — self vs export", () => {
  beforeEach(seedState);

  it("returns hasData false with no solar", () => {
    const r = call("solar-self-consumption", ctxA, {});
    assert.equal(r.result.hasData, false);
  });

  it("splits solar into self-consumed and exported per day", () => {
    const m = month();
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    // Day 1: produced 30, consumed 10 -> self 10, export 20.
    call("solar-log", ctxA, { kwh: 30, date: `${m}-05` });
    call("reading-log", ctxA, { kwh: 10, date: `${m}-05` });
    const r = call("solar-self-consumption", ctxA, { days: 365, exportRate: 0.05 });
    assert.equal(r.ok, true);
    assert.equal(r.result.selfConsumedKwh, 10);
    assert.equal(r.result.exportedKwh, 20);
    assert.equal(r.result.selfConsumptionSavings, 2); // 10 * 0.20
    assert.equal(r.result.exportCredit, 1); // 20 * 0.05
  });
});

describe("energy.usage-alerts — anomaly detection", () => {
  beforeEach(seedState);

  it("no alerts on an empty / stable account", () => {
    const r = call("usage-alerts", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });

  it("flags a usage spike vs the trailing baseline", () => {
    const base = "2026-03-0";
    for (let d = 1; d <= 4; d++) call("reading-log", ctxA, { kwh: 10, date: `${base}${d}` });
    call("reading-log", ctxA, { kwh: 40, date: "2026-03-05" });
    const r = call("usage-alerts", ctxA, {});
    const spike = r.result.alerts.find((a) => a.kind === "usage_spike");
    assert.ok(spike);
    assert.equal(spike.severity, "high");
  });

  it("flags an always-on device with no recent reading", () => {
    call("device-add", ctxA, { name: "Server", category: "electronics", wattage: 200, alwaysOn: true });
    const r = call("usage-alerts", ctxA, {});
    assert.ok(r.result.alerts.find((a) => a.kind === "device_idle"));
  });

  it("flags a goal over budget", () => {
    call("goal-set", ctxA, { label: "Tight goal", targetKwh: 5, period: "month" });
    call("reading-log", ctxA, { kwh: 50 });
    const r = call("usage-alerts", ctxA, {});
    assert.ok(r.result.alerts.find((a) => a.kind === "goal_exceeded"));
  });
});

describe("energy.month-comparison — historical comparison", () => {
  beforeEach(seedState);

  it("compares two months and computes the delta", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.20 });
    call("reading-log", ctxA, { kwh: 100, date: "2026-04-10" });
    call("reading-log", ctxA, { kwh: 150, date: "2026-05-10" });
    const r = call("month-comparison", ctxA, { month: "2026-05" });
    assert.equal(r.ok, true);
    assert.equal(r.result.current.consumedKwh, 150);
    assert.equal(r.result.previous.consumedKwh, 100);
    assert.equal(r.result.change.consumed.abs, 50);
    assert.equal(r.result.change.consumed.pct, 50);
    assert.equal(r.result.change.consumed.direction, "up");
  });

  it("rejects a malformed month", () => {
    const r = call("month-comparison", ctxA, { month: "not-a-month" });
    assert.equal(r.ok, false);
  });
});

describe("energy — STATE unavailable path", () => {
  it("substrate macros return error when STATE missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("live-stream", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
