// Contract tests for server/domains/ocean.js — pure-compute helpers
// plus real NOAA Tides & Currents API.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOceanActions from "../domains/ocean.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

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
beforeEach(() => {
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  // Per-user persistent state lives on globalThis._concordSTATE.
  globalThis._concordSTATE = { oceanLens: {} };
});

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

describe("ocean.marine-forecast (Open-Meteo Marine)", () => {
  it("rejects missing lat/lon", async () => {
    assert.equal((await call("marine-forecast", ctxA, {})).ok, false);
    assert.equal((await call("marine-forecast", ctxA, { lat: 37 })).ok, false);
  });

  it("hits Open-Meteo + shapes wave/swell series", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          hourly_units: { wave_height: "m" },
          hourly: {
            time: ["2026-05-21T00:00", "2026-05-21T01:00", "2026-05-21T02:00"],
            wave_height: [1.2, 1.5, 2.1],
            wave_period: [9, 10, 11],
            wave_direction: [270, 271, 272],
            swell_wave_height: [0.9, 1.1, 1.6],
            swell_wave_period: [12, 13, 14],
            swell_wave_direction: [280, 281, 282],
            wind_wave_height: [0.3, 0.4, 0.5],
            wind_wave_period: [5, 5, 6],
            sea_surface_temperature: [16, 16.2, 16.5],
          },
        }),
      };
    };
    const r = await call("marine-forecast", ctxA, { lat: 37.7, lon: -122.5, hours: 3 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /marine-api\.open-meteo\.com/);
    assert.equal(r.result.series.length, 3);
    assert.equal(r.result.series[2].waveHeight, 2.1);
    assert.equal(r.result.peakWaveHeight, 2.1);
    assert.equal(r.result.source, "open-meteo-marine");
  });
});

describe("ocean.ais-vessels (AISHub)", () => {
  it("rejects an incomplete bounding box", async () => {
    const r = await call("ais-vessels", ctxA, { latMin: 30, latMax: 35 });
    assert.equal(r.ok, false);
  });

  it("returns configRequired when AISHUB_USERNAME is unset", async () => {
    const prev = process.env.AISHUB_USERNAME;
    delete process.env.AISHUB_USERNAME;
    const r = await call("ais-vessels", ctxA, { latMin: 30, latMax: 35, lonMin: -130, lonMax: -120 });
    assert.equal(r.ok, false);
    assert.equal(r.configRequired, "AISHUB_USERNAME");
    if (prev !== undefined) process.env.AISHUB_USERNAME = prev;
  });

  it("parses live AIS rows when a username is set", async () => {
    process.env.AISHUB_USERNAME = "test-user";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([
        { ERROR: false },
        [
          { MMSI: 366123456, NAME: "PACIFIC STAR", LATITUDE: 33.5, LONGITUDE: -122.1, SOG: 12.3, COG: 270, TYPE: 70, DEST: "OAKLAND" },
        ],
      ]),
    });
    const r = await call("ais-vessels", ctxA, { latMin: 30, latMax: 35, lonMin: -130, lonMax: -120 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.vessels[0].type, "cargo");
    assert.equal(r.result.vessels[0].name, "PACIFIC STAR");
    delete process.env.AISHUB_USERNAME;
  });
});

describe("ocean.ndbc-buoy (NOAA NDBC)", () => {
  it("rejects an invalid buoy ID", async () => {
    assert.equal((await call("ndbc-buoy", ctxA, { buoyId: "!" })).ok, false);
  });

  it("parses the realtime2 fixed-width feed", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => [
        "#YY  MM DD hh mm WDIR WSPD GST  WVHT  DPD   APD MWD   PRES  ATMP  WTMP",
        "#yr  mo dy hr mn degT m/s  m/s  m     sec   sec degT  hPa   degC  degC",
        "2026 05 21 18 50 280  6.0  7.5  2.3   11.0  8.0 275   1015.0 15.0  14.5",
      ].join("\n"),
    });
    const r = await call("ndbc-buoy", ctxA, { buoyId: "46026" });
    assert.equal(r.ok, true);
    assert.equal(r.result.waveHeightM, 2.3);
    assert.equal(r.result.waterTempC, 14.5);
    assert.equal(r.result.source, "noaa-ndbc");
  });
});

describe("ocean.surf-score (Open-Meteo composite)", () => {
  it("rejects when neither spotId nor lat/lon supplied", async () => {
    assert.equal((await call("surf-score", ctxA, {})).ok, false);
  });

  it("computes a 0-100 score from live marine + wind data", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("marine-api")) {
        return {
          ok: true,
          json: async () => ({
            hourly: {
              wave_height: Array(24).fill(2.0),
              wave_period: Array(24).fill(12),
              swell_wave_height: Array(24).fill(2.2),
              swell_wave_period: Array(24).fill(13),
              wind_wave_height: Array(24).fill(0.3),
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ hourly: { wind_speed_10m: Array(24).fill(8) } }) };
    };
    const r = await call("surf-score", ctxA, { lat: 37.7, lon: -122.5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.score >= 0 && r.result.score <= 100);
    assert.ok(["epic", "good", "fair", "poor"].includes(r.result.rating));
  });
});

describe("ocean.sea-surface-temp (Open-Meteo Marine SST)", () => {
  it("rejects missing lat/lon", async () => {
    assert.equal((await call("sea-surface-temp", ctxA, {})).ok, false);
  });

  it("returns current SST + 24h series for a point", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        hourly: {
          time: Array.from({ length: 24 }, (_, i) => `2026-05-21T${String(i).padStart(2, "0")}:00`),
          sea_surface_temperature: Array.from({ length: 24 }, (_, i) => 20 + i * 0.1),
        },
      }),
    });
    const r = await call("sea-surface-temp", ctxA, { lat: 24.5, lon: -81.8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 24);
    assert.ok(Number.isFinite(r.result.min));
    assert.equal(r.result.source, "open-meteo-marine");
  });
});

describe("ocean.tide-alert lifecycle", () => {
  it("adds, checks and deletes a tide alert", async () => {
    const add = await call("tide-alert-add", ctxA, { stationId: "9414290", stationName: "San Francisco", tideType: "high", leadMinutes: 30 });
    assert.equal(add.ok, true);
    const alertId = add.result.alert.id;

    // tide-alerts-check fetches NOAA predictions for each alert.
    const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ predictions: [{ t: future, v: "1.9", type: "H" }] }),
    });
    const checked = await call("tide-alerts-check", ctxA, {});
    assert.equal(checked.ok, true);
    assert.equal(checked.result.count, 1);
    assert.equal(checked.result.alerts[0].alertId, alertId);

    const del = await call("tide-alert-delete", ctxA, { id: alertId });
    assert.equal(del.ok, true);
  });

  it("rejects an alert with no stationId", () => {
    assert.equal(call("tide-alert-add", ctxA, { tideType: "both" }).ok, false);
  });
});

describe("ocean.session-export", () => {
  it("exports logged sessions as CSV", () => {
    const spot = call("spot-add", ctxA, { name: "Mavericks", kind: "surf", lat: 37.49, lon: -122.5 }).result.spot;
    call("session-log", ctxA, { spotId: spot.id, waveHeightM: 3, rating: 5, conditions: "clean" });
    const r = call("session-export", ctxA, { format: "csv" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "csv");
    assert.match(r.result.content, /Mavericks/);
    assert.match(r.result.filename, /\.csv$/);
  });

  it("exports geolocated sessions as GPX waypoints", () => {
    const spot = call("spot-add", ctxA, { name: "Pipeline", kind: "surf", lat: 21.66, lon: -158.05 }).result.spot;
    call("session-log", ctxA, { spotId: spot.id, waveHeightM: 4, rating: 5 });
    const r = call("session-export", ctxA, { format: "gpx" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "gpx");
    assert.match(r.result.content, /<wpt lat="21.66" lon="-158.05">/);
  });
});
