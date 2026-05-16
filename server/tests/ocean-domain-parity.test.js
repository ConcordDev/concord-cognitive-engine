// Contract tests for server/domains/ocean.js — pure-compute helpers
// plus real NOAA Tides & Currents API.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOceanActions from "../domains/ocean.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`ocean.${name}`);
  if (!fn) throw new Error(`ocean.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerOceanActions(register); });
beforeEach(() => { globalThis.fetch = async () => { throw new Error("network disabled in tests"); }; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("ocean.waveAnalysis (pure compute)", () => {
  it("classifies 2m waves as moderate state", () => {
    const r = call("waveAnalysis", ctxA, { data: { waveHeightMeters: 2, wavePeriodSeconds: 8 } }, {});
    assert.equal(r.result.seaState, "moderate");
  });
});

describe("ocean.noaa-tide-prediction", () => {
  it("rejects missing stationId", async () => {
    assert.equal((await call("noaa-tide-prediction", ctxA, {})).ok, false);
  });

  it("rejects invalid date format", async () => {
    const r = await call("noaa-tide-prediction", ctxA, { stationId: "9414290", beginDate: "tomorrow" });
    assert.equal(r.ok, false);
    assert.match(r.error, /YYYYMMDD/);
  });

  it("hits NOAA API + parses high/low predictions", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          predictions: [
            { t: "2026-05-16 04:18", v: "-0.213", type: "L" },
            { t: "2026-05-16 11:06", v: "1.685", type: "H" },
            { t: "2026-05-16 16:42", v: "0.092", type: "L" },
            { t: "2026-05-16 23:18", v: "1.972", type: "H" },
          ],
        }),
      };
    };
    const r = await call("noaa-tide-prediction", ctxA, { stationId: "9414290", beginDate: "20260516", endDate: "20260517" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.tidesandcurrents\.noaa\.gov.*product=predictions/);
    assert.match(capturedUrl, /station=9414290/);
    assert.match(capturedUrl, /interval=hilo/);
    assert.match(capturedUrl, /units=metric/);
    assert.equal(r.result.predictions.length, 4);
    assert.equal(r.result.predictions[0].type, "low");
    assert.equal(r.result.predictions[1].type, "high");
    assert.equal(r.result.predictions[1].height, 1.685);
    assert.equal(r.result.source, "noaa-tides-and-currents");
  });

  it("surfaces NOAA API errors in response body", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ error: { message: "No station found" } }),
    });
    const r = await call("noaa-tide-prediction", ctxA, { stationId: "9999999" });
    assert.equal(r.ok, false);
    assert.match(r.error, /No station found/);
  });
});

describe("ocean.noaa-water-level", () => {
  it("hits NOAA API + parses observed readings", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          data: [
            { t: "2026-05-16 00:00", v: "1.234", s: "0.012", f: "0,0,0,0" },
            { t: "2026-05-16 00:06", v: "1.250", s: "0.011", f: "0,0,0,0" },
            { t: "2026-05-16 00:12", v: "1.265", s: "0.013", f: "0,0,0,0" },
          ],
        }),
      };
    };
    const r = await call("noaa-water-level", ctxA, { stationId: "9414290" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /product=water_level/);
    assert.equal(r.result.readings.length, 3);
    assert.equal(r.result.latest.waterLevel, 1.265);
  });
});

describe("ocean.noaa-stations", () => {
  it("lists stations + filters by state", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          stations: [
            { id: "9414290", name: "San Francisco", state: "CA", lat: 37.806, lng: -122.465, timezone: "PST", timezonecorr: -8 },
            { id: "9414750", name: "Alameda", state: "CA", lat: 37.772, lng: -122.300, timezone: "PST", timezonecorr: -8 },
            { id: "9410660", name: "Los Angeles", state: "CA", lat: 33.720, lng: -118.272, timezone: "PST", timezonecorr: -8 },
            { id: "8410140", name: "Eastport", state: "ME", lat: 44.904, lng: -66.985, timezone: "EST", timezonecorr: -5 },
          ],
        }),
      };
    };
    const all = await call("noaa-stations", ctxA, {});
    assert.equal(all.result.count, 4);
    assert.match(capturedUrl, /type=tidepredictions/);

    const ca = await call("noaa-stations", ctxA, { state: "CA" });
    assert.equal(ca.result.count, 3);
    assert.ok(ca.result.stations.every((s) => s.state === "CA"));
  });
});
