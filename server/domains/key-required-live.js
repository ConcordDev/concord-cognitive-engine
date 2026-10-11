// server/domains/key-required-live.js
//
// Phase 11 (Item 9) — REAL_FREE wires that require a free signup key.
// Unlike `astronomy-live.js`'s NASA wires, none of these providers
// offer a shared "DEMO_KEY" fallback, so we render an honest
// "Set X in .env to enable this panel" message when the key is
// missing (NOT a fake response).
//
// Macros:
//
//   finance.live_fred_series           FRED economic time series (GDP,
//                                       CPI, unemployment, fed funds...)
//                                       env: FRED_API_KEY
//
//   environment.live_air_quality       Open-Meteo Air Quality (CAMS) by ZIP
//                                       or lat/lon. No key. AirNow is an
//                                       optional secondary when
//                                       EPA_AIRNOW_API_KEY / AIRNOW_API_KEY
//                                       is set and accepted.
//
//   travel.live_nps_parks              US National Parks Service parks
//                                       by state code
//                                       env: NPS_API_KEY
//
//   weather.live_forecast              api.weather.gov for US points
//                                       (no key). OpenWeatherMap is only
//                                       a fallback for non-US points when
//                                       OPENWEATHERMAP_API_KEY is set.
//
// FRED and NPS still return missing_api_key when their env var is unset.
// Air quality and the US forecast do not: they call keyless public APIs
// and return upstream_unreachable / timeout / unavailable_outside_us
// instead of inventing a reading.

import { loadAirQuality, loadUsWeather } from "../lib/keyless-atmosphere.js";

const FETCH_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function missingKey(envVar, signupUrl) {
  return {
    ok: false,
    reason: "missing_api_key",
    envVar,
    signupUrl,
    message: `Set ${envVar} in .env to enable this panel. Free signup: ${signupUrl}`,
  };
}

export default function registerKeyRequiredLiveMacros(register) {
  // ── FRED — US economic time series ──────────────────────────────────
  register("finance", "live_fred_series", async (_ctx, input = {}) => {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      return missingKey(
        "FRED_API_KEY",
        "https://fredaccount.stlouisfed.org/apikeys",
      );
    }
    const seriesId = String(input.series_id || "GDP");
    const limit = Math.min(120, Math.max(1, Number(input.limit) || 12));
    const sortOrder = input.sort_order === "asc" ? "asc" : "desc";
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&limit=${limit}&sort_order=${sortOrder}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      return {
        ok: true,
        source: "FRED (St. Louis Fed)",
        fetchedAt: Math.floor(Date.now() / 1000),
        seriesId,
        units: data.units || null,
        observations: (data.observations || []).map((o) => ({
          date: o.date,
          value: o.value === "." ? null : Number(o.value),
        })),
      };
    } catch (e) {
      return { ok: false, reason: "upstream_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live FRED economic series (requires FRED_API_KEY)" });

  // ── Open-Meteo air quality (keyless). AirNow is optional secondary.
  register("environment", "live_air_quality", async (_ctx, input = {}) => {
    return loadAirQuality(input || {});
  }, { note: "Open-Meteo CAMS air quality by ZIP or lat/lon (no key)" });

  // ── NPS — US National Parks ─────────────────────────────────────────
  register("travel", "live_nps_parks", async (_ctx, input = {}) => {
    const apiKey = process.env.NPS_API_KEY;
    if (!apiKey) {
      return missingKey(
        "NPS_API_KEY",
        "https://www.nps.gov/subjects/developer/get-started.htm",
      );
    }
    const stateCode = String(input.stateCode || input.state || "CA").toUpperCase();
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 10));
    const url = `https://developer.nps.gov/api/v1/parks?stateCode=${encodeURIComponent(stateCode)}&limit=${limit}&api_key=${encodeURIComponent(apiKey)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const parks = Array.isArray(data?.data) ? data.data : [];
      return {
        ok: true,
        source: "NPS Parks",
        fetchedAt: Math.floor(Date.now() / 1000),
        stateCode,
        total: Number(data?.total) || parks.length,
        parks: parks.map((p) => ({
          parkCode: p.parkCode,
          name: p.fullName || p.name,
          description: p.description,
          designation: p.designation,
          states: p.states,
          url: p.url,
          imageUrl: Array.isArray(p.images) && p.images[0]?.url ? p.images[0].url : null,
          latitude: Number(p.latitude) || null,
          longitude: Number(p.longitude) || null,
        })),
      };
    } catch (e) {
      return { ok: false, reason: "upstream_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live NPS parks by state (requires NPS_API_KEY)" });

  // ── api.weather.gov for US points. OWM only outside the US, and only with a key.
  register("weather", "live_forecast", async (_ctx, input = {}) => {
    return loadUsWeather(input || {});
  }, { note: "NWS forecast/hourly/observation/alerts for US points (no key)" });
}
