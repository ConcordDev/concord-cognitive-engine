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
