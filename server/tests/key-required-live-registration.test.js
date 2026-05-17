// Contract test for server/domains/key-required-live.js.
//
// Pins: (1) the 4 macros are registered against the right domains,
// (2) missing-env-var path returns honest envelopes (NOT fake data),
// (3) envelope shape includes the signup URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import registerKeyRequiredLiveMacros from '../domains/key-required-live.js';

function makeRegistry() {
  const seen = new Map();
  function register(domain, name, fn, meta) {
    const key = `${domain}.${name}`;
    seen.set(key, { fn, meta });
  }
  return { register, seen };
}

const { register, seen } = makeRegistry();
registerKeyRequiredLiveMacros(register);

test('registers all 4 key-required macros against the right domains', () => {
  for (const k of [
    'finance.live_fred_series',
    'environment.live_air_quality',
    'travel.live_nps_parks',
    'weather.live_forecast',
  ]) {
    assert.ok(seen.has(k), `${k} should be registered`);
    assert.equal(typeof seen.get(k).fn, 'function');
  }
});

test('finance.live_fred_series returns missing_api_key when FRED_API_KEY unset', async () => {
  delete process.env.FRED_API_KEY;
  const r = await seen.get('finance.live_fred_series').fn({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_api_key');
  assert.equal(r.envVar, 'FRED_API_KEY');
  assert.match(r.signupUrl, /stlouisfed\.org/);
});

test('environment.live_air_quality returns missing_api_key envelope', async () => {
  delete process.env.EPA_AIRNOW_API_KEY;
  const r = await seen.get('environment.live_air_quality').fn({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.envVar, 'EPA_AIRNOW_API_KEY');
  assert.match(r.signupUrl, /airnow/);
});

test('travel.live_nps_parks returns missing_api_key envelope', async () => {
  delete process.env.NPS_API_KEY;
  const r = await seen.get('travel.live_nps_parks').fn({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.envVar, 'NPS_API_KEY');
  assert.match(r.signupUrl, /nps\.gov/);
});

test('weather.live_forecast returns missing_api_key envelope', async () => {
  delete process.env.OPENWEATHERMAP_API_KEY;
  const r = await seen.get('weather.live_forecast').fn({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.envVar, 'OPENWEATHERMAP_API_KEY');
  assert.match(r.signupUrl, /openweathermap/);
});

test('missing-key envelope is never fake — no observations/forecasts/parks/series', async () => {
  delete process.env.FRED_API_KEY;
  delete process.env.EPA_AIRNOW_API_KEY;
  delete process.env.NPS_API_KEY;
  delete process.env.OPENWEATHERMAP_API_KEY;
  const results = await Promise.all([
    seen.get('finance.live_fred_series').fn({}, {}),
    seen.get('environment.live_air_quality').fn({}, {}),
    seen.get('travel.live_nps_parks').fn({}, {}),
    seen.get('weather.live_forecast').fn({}, {}),
  ]);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.observations, undefined);
    assert.equal(r.forecasts, undefined);
    assert.equal(r.parks, undefined);
    assert.equal(r.series, undefined);
  }
});
