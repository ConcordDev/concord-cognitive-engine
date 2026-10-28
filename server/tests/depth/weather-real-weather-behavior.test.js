// forecast.realWeather: the macro the two former browser-direct widgets (forecast + desert lenses) call.
// The browser never talks to Open-Meteo: it asks the server, which answers from the shared weather
// cache. No network: fetchPublicUrl's module test transport serves the upstream.
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";
import { __setPublicFetchTestTransport } from "../../lib/public-fetch.js";
import { _resetWeatherFeedForTests } from "../../lib/weather-feed-sources.js";

let runMacro, ctx;
before(async () => { ({ runMacro, ctx } = await macroRuntime("weather-real")); });
afterEach(() => { __setPublicFetchTestTransport(null); _resetWeatherFeedForTests(); });

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

test("forecast.realWeather week preset: shared cache, attribution, one upstream call for repeats", async () => {
  _resetWeatherFeedForTests();
  const urls = [];
  __setPublicFetchTestTransport(async (url) => { urls.push(String(url)); return ok({ current: { temperature_2m: 9 }, daily: { time: ["2026-10-28"] } }); });
  const a = await runMacro("forecast", "realWeather", { lat: 35.68, lon: 139.69, preset: "week" }, ctx);
  const b = await runMacro("forecast", "realWeather", { lat: 35.684, lon: 139.694, preset: "week" }, ctx);
  assert.equal(a.ok, true);
  assert.equal(a.data.current.temperature_2m, 9);
  assert.equal(a.stale, false);
  assert.equal(a.attribution, "Weather data by Open-Meteo.com (CC BY 4.0)");
  assert.equal(b.ok, true);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /forecast_days=7/);
});

test("forecast.realWeather: unknown preset and bad coordinates are honest errors with no upstream call", async () => {
  let n = 0;
  __setPublicFetchTestTransport(async () => { n++; return ok({}); });
  const bad = await runMacro("forecast", "realWeather", { lat: 1, lon: 2, preset: "evil&latitude=9" }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "bad_preset");
  const oob = await runMacro("forecast", "realWeather", { lat: 123, lon: 2, preset: "current" }, ctx);
  assert.equal(oob.ok, false);
  assert.equal(oob.status, "unavailable");
  assert.equal(oob.reason, "invalid_coordinates");
  assert.equal(n, 0);
});

test("forecast.realWeather: upstream down on a cold key -> unavailable, nothing fabricated", async () => {
  _resetWeatherFeedForTests();
  __setPublicFetchTestTransport(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) }));
  const r = await runMacro("forecast", "realWeather", { lat: -33.87, lon: 151.21, preset: "current" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.equal(r.data, undefined);
  assert.equal(r.attribution, "Weather data by Open-Meteo.com (CC BY 4.0)");
});
