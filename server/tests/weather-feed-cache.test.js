// One weather cache: every caller that wants Open-Meteo for the same place shares ONE upstream
// request per TTL (lib/weather-feed-sources.js on feed-cache). No network: fetchPublicUrl's module
// test transport is replaced, and the global fetch throws so a surviving bare fetch() fails loudly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache } from "../lib/feed-cache.js";
import {
  getForecast, openMeteoJson, geocodePlace, atmosphereJson, openMeteoKey,
  _resetWeatherFeedForTests, OPEN_METEO_ATTRIBUTION,
} from "../lib/weather-feed-sources.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const realFetch = globalThis.fetch;

const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const WX = { current: { temperature_2m: 11.5, weather_code: 3 }, daily: { time: ["2026-10-28"], temperature_2m_max: [14], temperature_2m_min: [7] } };

let calls;
let clock;
let route;

beforeEach(() => {
  calls = [];
  clock = 1_000_000_000;
  route = () => res(WX);
  _resetWeatherFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in weather paths"); };
});
afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  _resetWeatherFeedForTests();
});

const params = { current: "temperature_2m,weather_code", timezone: "auto" };

test("same coordinates from 3 callers (differing only past 2 dp) -> 1 upstream fetch", async () => {
  const a = await getForecast({ lat: 40.7128, lon: -74.006, params });
  const b = await openMeteoJson({ lat: 40.71, lon: -74.01, params: { timezone: "auto", current: "temperature_2m,weather_code" } });
  const c = await getForecast({ lat: "40.714", lon: "-74.0059", params });
  assert.equal(calls.length, 1);
  assert.equal(a.ok, true);
  assert.deepEqual(b, WX);
  assert.deepEqual(c.data, WX);
  assert.match(calls[0].url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=40\.71&longitude=-74\.01&current=temperature_2m,weather_code&timezone=auto$/);
});

test("a domain caller and a direct caller with the same params share one entry", async () => {
  const actions = new Map();
  (await import("../domains/landscaping.js")).default((d, n, fn) => actions.set(`${d}.${n}`, fn));
  const climate = actions.get("landscaping.climate-match");
  const p = { daily: "temperature_2m_min,temperature_2m_max", forecast_days: 16, timezone: "auto" };
  route = () => res({ daily: { temperature_2m_min: [-3, -1], temperature_2m_max: [8, 9] } });
  const r1 = await climate({}, {}, { lat: 41.5, lon: -73.9 });
  const r2 = await climate({}, {}, { lat: 41.5, lon: -73.9 });
  const direct = await getForecast({ lat: 41.5, lon: -73.9, params: p });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(direct.ok, true);
  assert.equal(calls.length, 1);
});

test("different parameter sets and endpoints are different keys", async () => {
  await getForecast({ lat: 10, lon: 20, params: { daily: "a" } });
  await getForecast({ lat: 10, lon: 20, params: { daily: "b" } });
  await getForecast({ kind: "marine", lat: 10, lon: 20, params: { daily: "a" } });
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /^https:\/\/marine-api\.open-meteo\.com\/v1\/marine\?/);
});

test("stale on error: past the TTL the old reading is served flagged stale, never fabricated", async () => {
  const fresh = await getForecast({ lat: 40.7, lon: -74, params });
  assert.equal(fresh.stale, false);
  clock += 20 * MIN; // past the 15 min TTL, inside the 6 h stale window
  route = () => res({}, 503);
  const r = await getForecast({ lat: 40.7, lon: -74, params });
  assert.equal(r.ok, true);
  assert.equal(r.stale, true);
  assert.deepEqual(r.data, WX);
  assert.equal(r.fetchedAt, 1_000_000_000);
});

test("past the stale window with the upstream down -> honest unavailable", async () => {
  await getForecast({ lat: 40.7, lon: -74, params });
  clock += 7 * HOUR;
  route = () => res({}, 500);
  const r = await getForecast({ lat: 40.7, lon: -74, params });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.equal(r.data, undefined);
  assert.equal(r.lastOkAt, 1_000_000_000);
  assert.match(r.reason, /upstream_error/);
});

test("cold key + upstream down -> unavailable, failure is not cached as data", async () => {
  route = () => res({}, 502);
  const r = await getForecast({ lat: 1, lon: 2, params });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  clock += 5 * MIN; // inside the per-key back-off? past it
  clock += 10 * MIN;
  route = () => res(WX);
  const again = await getForecast({ lat: 1, lon: 2, params });
  assert.equal(again.ok, true);
  assert.deepEqual(again.data, WX);
});

test("openMeteoJson throws `open-meteo <reason>` when unavailable (callers keep their catch paths)", async () => {
  route = () => res({}, 500);
  await assert.rejects(() => openMeteoJson({ lat: 5, lon: 5, params }), /open-meteo upstream_error/);
});

test("invalid coordinates never reach the upstream", async () => {
  for (const bad of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: "x", lon: 1 }, { lat: null, lon: 1 }, {}]) {
    const r = await getForecast({ ...bad, params });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_coordinates");
  }
  assert.equal(calls.length, 0);
  assert.equal(openMeteoKey({ lat: 1, lon: 1, kind: "nope" }), null);
});

test("OPEN_METEO_BASE swaps the forecast host (e.g. a commercial customer-api host)", async () => {
  process.env.OPEN_METEO_BASE = "https://customer-api.example.test/";
  try {
    await getForecast({ lat: 3, lon: 4, params });
    assert.match(calls[0].url, /^https:\/\/customer-api\.example\.test\/v1\/forecast\?latitude=3&longitude=4&/);
  } finally {
    delete process.env.OPEN_METEO_BASE;
  }
});

test("geocoding: normalized names share one entry; results come back raw", async () => {
  route = () => res({ results: [{ name: "Poughkeepsie", latitude: 41.7, longitude: -73.92 }] });
  const a = await geocodePlace("Poughkeepsie ");
  const b = await geocodePlace("  poughkeepsie");
  assert.equal(calls.length, 1);
  assert.equal(a.data.results[0].latitude, 41.7);
  assert.equal(b.ok, true);
  assert.match(calls[0].url, /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=poughkeepsie&count=5&language=en&format=json$/);
  assert.equal((await geocodePlace("   ")).reason, "empty_name");
});

test("NWS lookups share the cache; the AirNow key stays out of the cache key", async () => {
  route = () => res({ properties: { ok: 1 } });
  const url = "https://api.weather.gov/points/40.7,-74";
  await atmosphereJson(url, { "User-Agent": "t" });
  await atmosphereJson(url, { "User-Agent": "t" });
  assert.equal(calls.length, 1);

  process.env.AIRNOW_API_KEY = "sekrit-key";
  try {
    route = () => res([{ AQI: 41 }]);
    const an = "https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json&zipCode=12601&distance=25";
    await atmosphereJson(`${an}&API_KEY=sekrit-key`);
    await atmosphereJson(`${an}&API_KEY=sekrit-key`);
    const airnowCalls = calls.filter((c) => /airnowapi/.test(c.url));
    assert.equal(airnowCalls.length, 1);
    assert.match(airnowCalls[0].url, /API_KEY=sekrit-key$/);
    const { stats } = await import("../lib/feed-cache.js");
    assert.ok(!JSON.stringify(stats()).includes("sekrit-key"));
  } finally {
    delete process.env.AIRNOW_API_KEY;
  }
});

test("OpenWeatherMap appid never enters the cache key, stats or the upstream log line", async () => {
  process.env.OPENWEATHERMAP_API_KEY = "owm-secret";
  const logged = [];
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: (l) => logged.push(l) });
  try {
    route = () => res({ list: [] });
    const url = "https://api.openweathermap.org/data/2.5/forecast?lat=51.5&lon=-0.12&appid=owm-secret&units=metric";
    await atmosphereJson(url);
    await atmosphereJson(url);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /appid=owm-secret/);
    const { stats } = await import("../lib/feed-cache.js");
    assert.ok(!JSON.stringify(stats()).includes("owm-secret"));
    assert.ok(!logged.join("\n").includes("owm-secret"));
  } finally {
    delete process.env.OPENWEATHERMAP_API_KEY;
  }
});

test("a 404 from NWS is a cached real answer re-thrown with its status (non-US points)", async () => {
  route = () => res({ detail: "nope" }, 404);
  const url = "https://api.weather.gov/points/51.5,-0.12";
  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => atmosphereJson(url), (e) => e.status === 404);
  }
  assert.equal(calls.length, 1);
});

test("attribution string is exported for surfaces that show Open-Meteo data", () => {
  assert.equal(OPEN_METEO_ATTRIBUTION, "Weather data by Open-Meteo.com (CC BY 4.0)");
});
