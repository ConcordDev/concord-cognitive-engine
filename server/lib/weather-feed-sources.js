// server/lib/weather-feed-sources.js
//
// Weather / atmosphere upstreams routed through lib/feed-cache.js: Open-Meteo
// (forecast, marine, air-quality, archive, geocoding), api.weather.gov, AirNow
// and OpenWeatherMap. This is the ONLY server module that names the Open-Meteo
// hosts, so every domain, tick and route that wants weather shares one cache
// entry per (rounded location, parameter set): the same coordinates asked for by
// three different callers cost one upstream request per TTL.
//
// Honesty: failures are never cached as data. When nothing truthful can be
// served the caller gets { ok:false, status:"unavailable", reason, lastOkAt };
// stale data is served with stale:true + fetchedAt. Nothing here invents a
// reading.
//
// Open-Meteo's free API is for non-commercial use and requires attribution
// (CC BY 4.0): surfaces that show this data carry OPEN_METEO_ATTRIBUTION.
//
// Env: OPEN_METEO_BASE overrides the forecast host (e.g. a commercial
// customer-api host); the marine / air-quality / archive endpoints keep their
// own default hosts. NWS / AirNow / OpenWeatherMap keep the 10 min TTL the old
// keyless-atmosphere cache used.
//
// Sources register on import (register-once via hasSource) and again on demand
// via ensureWeatherFeedSources(), because feed-cache's test reset clears them.

import { registerSource, hasSource, get, getOrThrow, clearSource, _resetFeedCacheForTests } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";
const DEFAULT_FORECAST_BASE = "https://api.open-meteo.com";
const GEOCODE_BASE = "https://geocoding-api.open-meteo.com";
const ATMOSPHERE_TTL_MS = 10 * MIN;

// kind -> [default base, path]
const KINDS = {
  forecast: [DEFAULT_FORECAST_BASE, "/v1/forecast"],
  marine: ["https://marine-api.open-meteo.com", "/v1/marine"],
  air: ["https://air-quality-api.open-meteo.com", "/v1/air-quality"],
  archive: ["https://archive-api.open-meteo.com", "/v1/archive"],
};

function forecastBase() {
  return String(process.env.OPEN_METEO_BASE || DEFAULT_FORECAST_BASE).replace(/\/+$/, "");
}

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Test-only transport (keyless-atmosphere's setAtmosphereFetchForTests forwards here); null =>
// the SSRF-guarded fetchPublicUrl. Every upstream call below goes through rawJson().
let _transport = null;
let _timeoutMs = 8000;
export function setWeatherTransportForTests(fn) { _transport = typeof fn === "function" ? fn : null; }
export function setWeatherTimeoutForTests(ms) { _timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 8000; }

async function rawJson(url, headers, signal, label) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), _timeoutMs);
  try {
    const init = { headers: headers || {}, signal: ctrl.signal };
    const r = _transport ? await _transport(url, init) : await fetchPublicUrl(url, init);
    if (!r || r.ok !== true) {
      const status = Number(r?.status) || 0;
      throw new UpstreamError(`${label} HTTP ${status || "error"}`, status);
    }
    return await r.json();
  } catch (e) {
    if (e?.code === "timeout") throw e;
    if (ctrl.signal.aborted && !signal?.aborted) {
      const err = new Error(`timed out after ${_timeoutMs}ms`);
      err.code = "timeout";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

// ── key encoding ────────────────────────────────────────────────────────────
// Forecast key: "kind|lat,lon|k=v&k=v" with lat/lon rounded to 2 dp (~1 km, finer than
// Open-Meteo's own grid) and the remaining params sorted. "|", "&" and "=" never survive in a value.

const clean = (v) => String(v).replace(/[|&=]/g, " ").trim();

function round2(n) { return String(Math.round(n * 100) / 100); }

/** Canonical key for an Open-Meteo request. Returns null on invalid coordinates. */
export function openMeteoKey({ kind = "forecast", lat, lon, params = {} } = {}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!KINDS[kind] || lat == null || lon == null || lat === "" || lon === "" || !Number.isFinite(la) || !Number.isFinite(lo)
    || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  const q = Object.keys(params).filter((k) => params[k] != null && params[k] !== "").sort()
    .map((k) => `${clean(k)}=${clean(params[k])}`).join("&");
  return `${kind}|${round2(la)},${round2(lo)}|${q}`;
}

function urlForKey(key) {
  const [kind, ll, q] = key.split("|");
  const [lat, lon] = ll.split(",");
  const [defBase, p] = KINDS[kind];
  const base = kind === "forecast" ? forecastBase() : defBase;
  const parts = [`latitude=${lat}`, `longitude=${lon}`];
  for (const kv of (q ? q.split("&") : [])) {
    const i = kv.indexOf("=");
    parts.push(`${encodeURIComponent(kv.slice(0, i))}=${encodeURIComponent(kv.slice(i + 1)).replace(/%2C/gi, ",")}`);
  }
  return `${base}${p}?${parts.join("&")}`;
}

// ── fetchers (key, { signal }) -> JSON-serializable data ────────────────────

const jsonHeaders = () => ({ Accept: "application/json" });

function fetchOpenMeteo(key, { signal }) {
  return rawJson(urlForKey(key), jsonHeaders(), signal, "open-meteo");
}

// key: "name" or "name|CC" (ISO country filter, used by ZIP resolution)
function fetchGeocode(key, { signal }) {
  const [name, cc] = key.split("|");
  const url = `${GEOCODE_BASE}/v1/search?name=${encodeURIComponent(name)}&count=5${cc ? `&countryCode=${encodeURIComponent(cc)}` : ""}&language=en&format=json`;
  return rawJson(url, jsonHeaders(), signal, "open-meteo-geocoding");
}

// API keys are stripped from the cache key (they would otherwise land in stats(), the
// "[feed-cache] upstream ..." log line and the persist file) and re-attached in the fetcher from env.
const SECRET_PARAM_RE = /([?&])(?:API_KEY|appid)=[^&]*/gi;
const airnowApiKey = () => process.env.EPA_AIRNOW_API_KEY || process.env.AIRNOW_API_KEY || "";
const owmApiKey = () => (typeof process.env.OPENWEATHERMAP_API_KEY === "string" ? process.env.OPENWEATHERMAP_API_KEY.trim() : "");
const withParam = (u, name, value) => `${u}${u.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;

// key: JSON {"url": "...", "h": {...headers}}.
// A 404 is a real, stable answer ("this point is outside NWS coverage", "unknown ZIP"), so it is
// cached as a marker and re-thrown with its status by atmosphereJson; every other failure is not cached.
async function fetchAtmosphere(key, { signal }) {
  const { url: rawUrl, h } = JSON.parse(key);
  let url = rawUrl;
  if (/airnowapi\.org/.test(rawUrl)) {
    const k = airnowApiKey();
    if (!k) throw new UpstreamError("no_api_key", 0);
    url = withParam(rawUrl, "API_KEY", k);
  } else if (/api\.openweathermap\.org/.test(rawUrl)) {
    const k = owmApiKey();
    if (!k) throw new UpstreamError("no_api_key", 0);
    url = withParam(rawUrl, "appid", k);
  }
  try {
    return await rawJson(url, h, signal, "atmosphere");
  } catch (e) {
    if (e?.status === 404) return { __httpStatus: 404 };
    throw e;
  }
}

// ── registration ────────────────────────────────────────────────────────────

const GEO_PERSIST_OK = (k) => /^[\p{L}\p{M}\s.,'-]{2,60}(\|[A-Z]{2})?$/u.test(k);

// Per-key (not source-wide) back-off for sources whose keys are independent
// places/URLs: one bad query must not blank weather for everyone.
const PER_KEY = { breaker: false, keyBackoff: true, gateKeyBackoff: true };

const SOURCES = [
  ["open-meteo-forecast", { ttlMs: 15 * MIN, staleMaxMs: 6 * HOUR, budget: { perMin: 300, perDay: 9000, minSpacingMs: 0 }, timeoutMs: 10_000, license: "public", persist: true, maxKeys: 5000, ...PER_KEY, fetcher: fetchOpenMeteo }],
  ["open-meteo-geocode", { ttlMs: 30 * DAY, staleMaxMs: 180 * DAY, budget: { perMin: 60, perDay: 2000, minSpacingMs: 0 }, timeoutMs: 10_000, license: "public", persist: true, persistFilter: GEO_PERSIST_OK, maxKeys: 5000, ...PER_KEY, fetcher: fetchGeocode }],
  ["nws", { ttlMs: ATMOSPHERE_TTL_MS, staleMaxMs: HOUR, budget: { perMin: 60, perDay: 5000, minSpacingMs: 0 }, timeoutMs: 15_000, license: "public", maxKeys: 400, ...PER_KEY, fetcher: fetchAtmosphere }],
  ["airnow", { ttlMs: ATMOSPHERE_TTL_MS, staleMaxMs: HOUR, budget: { perMin: 30, perDay: 400, minSpacingMs: 0 }, timeoutMs: 15_000, license: "keyed-display-ok", maxKeys: 400, ...PER_KEY, fetcher: fetchAtmosphere }],
  ["openweathermap", { ttlMs: ATMOSPHERE_TTL_MS, staleMaxMs: HOUR, budget: { perMin: 30, perDay: 900, minSpacingMs: 0 }, timeoutMs: 15_000, license: "keyed-display-ok", maxKeys: 200, ...PER_KEY, fetcher: fetchAtmosphere }],
  // ZIP -> lat/lon (zippopotam.us): stable, so a long TTL.
  ["atmosphere-lookup", { ttlMs: 30 * DAY, staleMaxMs: 180 * DAY, budget: { perMin: 60, perDay: 3000, minSpacingMs: 0 }, timeoutMs: 15_000, license: "public", maxKeys: 2000, ...PER_KEY, fetcher: fetchAtmosphere }],
];

/** Register-once; safe to call repeatedly (feed-cache's test reset clears the registry). */
export function ensureWeatherFeedSources() {
  for (const [id, cfg] of SOURCES) {
    if (!hasSource(id)) registerSource(id, cfg);
  }
}
ensureWeatherFeedSources();

// ── accessors ───────────────────────────────────────────────────────────────

/** { ok:true, data, fetchedAt, stale } | { ok:false, status:"unavailable", reason, lastOkAt, error } */
function shape(r) {
  if (r.status === "unavailable" || r.data == null) {
    const reason = String(r.reason || "") || "unavailable";
    return { ok: false, status: "unavailable", reason, lastOkAt: r.lastOkAt ?? null, error: `upstream unavailable: ${reason}` };
  }
  return { ok: true, data: r.data, fetchedAt: r.fetchedAt, stale: !!r.stale };
}

const unavailable = (reason) => ({ ok: false, status: "unavailable", reason, lastOkAt: null, error: `upstream unavailable: ${reason}` });

async function via(sourceId, key) {
  ensureWeatherFeedSources();
  return shape(await get(sourceId, key));
}

/**
 * Open-Meteo request through the shared cache.
 * @param {{kind?:"forecast"|"marine"|"air"|"archive", lat:number, lon:number, params?:object}} req
 * @returns {Promise<{ok:true,data:any,fetchedAt:number,stale:boolean}|{ok:false,status:"unavailable",reason:string,lastOkAt:number|null}>}
 */
export function getForecast(req = {}) {
  const key = openMeteoKey(req);
  if (!key) return Promise.resolve(unavailable("invalid_coordinates"));
  return via("open-meteo-forecast", key);
}

/** Throwing flavour for callers that already wrap in try/catch: returns the JSON or throws `open-meteo <reason>`. */
export async function openMeteoJson(req = {}) {
  const r = await getForecast(req);
  if (!r.ok) {
    const err = new Error(`open-meteo ${r.reason}`);
    err.status = r.status;
    err.reason = r.reason;
    err.lastOkAt = r.lastOkAt;
    if (/timed out|timeout/i.test(r.reason)) err.code = "timeout";
    throw err;
  }
  return r.data;
}

/** Place-name search (Open-Meteo geocoding). data = the raw upstream JSON ({results?:[...]}); opts.countryCode = ISO-2 filter. */
export function geocodePlace(name, { countryCode } = {}) {
  const n = String(name ?? "").replace(/\|/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return Promise.resolve(unavailable("empty_name"));
  const cc = /^[A-Za-z]{2}$/.test(String(countryCode || "")) ? `|${String(countryCode).toUpperCase()}` : "";
  return via("open-meteo-geocode", `${n}${cc}`);
}

function atmosphereSource(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* the fetch will fail honestly */ }
  if (host === "api.openweathermap.org") return "openweathermap";
  if (host.endsWith("weather.gov")) return "nws";
  if (host.endsWith("airnowapi.org")) return "airnow";
  return "atmosphere-lookup";
}

/**
 * Keyless-atmosphere fetch (NWS, AirNow, OpenWeatherMap, ZIP lookup): returns the JSON, or
 * throws the original upstream error (`status`, `code:"timeout"`). A 404 is cached as a real
 * answer and re-thrown with `status: 404`. API keys in the URL are moved out of the cache key.
 */
export async function atmosphereJson(url, headers) {
  ensureWeatherFeedSources();
  const key = JSON.stringify({ url: String(url).replace(SECRET_PARAM_RE, "$1").replace(/[?&]$/, ""), h: headers || {} });
  // getOrThrow rethrows the ORIGINAL upstream error (status, code:"timeout") so callers keep their branches.
  const data = await getOrThrow(atmosphereSource(url), key);
  if (data?.__httpStatus) {
    const err = new Error(`HTTP ${data.__httpStatus}`);
    err.status = data.__httpStatus;
    throw err;
  }
  return data;
}

/** Forget every cached weather entry and any failure back-off (keeps registrations and any test transport). */
export function clearWeatherCaches() {
  ensureWeatherFeedSources();
  for (const [id] of SOURCES) clearSource(id, { resetBackoff: true });
}

/** Test hook: forget every cached weather entry and any test transport/timeout. */
export function _resetWeatherFeedForTests() {
  _resetFeedCacheForTests();
  ensureWeatherFeedSources();
  setWeatherTransportForTests(null);
  setWeatherTimeoutForTests(null);
}
