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
//   environment.live_air_quality       EPA AirNow real-time AQI by ZIP
//                                       env: EPA_AIRNOW_API_KEY
//
//   travel.live_nps_parks              US National Parks Service parks
//                                       by state code
//                                       env: NPS_API_KEY
//
//   weather.live_forecast              OpenWeatherMap 5-day forecast
//                                       (already wired via Open-Meteo
//                                       for the no-key path)
//                                       env: OPENWEATHERMAP_API_KEY
//
// All four return:
//   { ok, source, fetchedAt, ...data }
//      on success;
//   { ok: false, reason: 'missing_api_key', envVar: 'X_API_KEY',
//     signupUrl: 'https://...' }
//      when the env var is missing;
//   { ok: false, reason: 'upstream_unreachable', error: '...' }
//      on network / non-2xx response.

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

  // ── EPA AirNow — real-time air quality ──────────────────────────────
  register("environment", "live_air_quality", async (_ctx, input = {}) => {
    const apiKey = process.env.EPA_AIRNOW_API_KEY;
    if (!apiKey) {
      return missingKey(
        "EPA_AIRNOW_API_KEY",
        "https://docs.airnowapi.org/account/request/",
      );
    }
    const zip = String(input.zipCode || input.zip || "94110");
    const distance = Math.min(200, Math.max(5, Number(input.distance) || 25));
    const url = `https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json&zipCode=${encodeURIComponent(zip)}&distance=${distance}&API_KEY=${encodeURIComponent(apiKey)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const observations = Array.isArray(data) ? data : [];
      return {
        ok: true,
        source: "EPA AirNow",
        fetchedAt: Math.floor(Date.now() / 1000),
        zipCode: zip,
        observations: observations.map((o) => ({
          reportingArea: o.ReportingArea,
          stateCode: o.StateCode,
          parameter: o.ParameterName,
          aqi: o.AQI,
          category: o.Category?.Name,
          dateObserved: o.DateObserved,
          hourObserved: o.HourObserved,
          latitude: o.Latitude,
          longitude: o.Longitude,
        })),
      };
    } catch (e) {
      return { ok: false, reason: "upstream_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live EPA AirNow AQI by zip (requires EPA_AIRNOW_API_KEY)" });

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

  // ── OpenWeatherMap — 5-day forecast ─────────────────────────────────
  register("weather", "live_forecast", async (_ctx, input = {}) => {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey) {
      return missingKey(
        "OPENWEATHERMAP_API_KEY",
        "https://home.openweathermap.org/users/sign_up",
      );
    }
    const city = String(input.city || input.q || "San Francisco");
    const units = ["metric", "imperial", "standard"].includes(input.units)
      ? input.units
      : "metric";
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=${units}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const list = Array.isArray(data?.list) ? data.list : [];
      return {
        ok: true,
        source: "OpenWeatherMap",
        fetchedAt: Math.floor(Date.now() / 1000),
        city: data?.city?.name || city,
        country: data?.city?.country || null,
        units,
        forecasts: list.slice(0, 40).map((row) => ({
          dt: row.dt,
          dtTxt: row.dt_txt,
          temp: row.main?.temp,
          feelsLike: row.main?.feels_like,
          humidity: row.main?.humidity,
          pressure: row.main?.pressure,
          weather: row.weather?.[0]?.main,
          description: row.weather?.[0]?.description,
          icon: row.weather?.[0]?.icon,
          windSpeed: row.wind?.speed,
          windDeg: row.wind?.deg,
          clouds: row.clouds?.all,
          pop: row.pop,
        })),
      };
    } catch (e) {
      return { ok: false, reason: "upstream_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live OpenWeatherMap 5-day forecast (requires OPENWEATHERMAP_API_KEY)" });
}
