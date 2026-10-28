// server/lib/public-data-sources.js
//
// The phase-8d public data reads — NVD, NASA EONET, Gutendex, Sketchfab, USGS, FEMA,
// REST Countries, sunrise-sunset, Imgflip, Onionoo, npm and the OpenRouter public model
// list — routed through lib/feed-cache.js. Browsers used to call these hosts directly;
// now every widget shares one cache entry per request and the server is the single,
// polite client (descriptive User-Agent, per-source budgets).
//
// SECURITY: this is NOT a proxy. Every request is built from a fixed URL template; the
// client supplies only validated scalar parameters (allowlists, length/charset-checked
// free text, range-checked coordinates). A URL or host is never accepted from a caller.
// Every outbound fetch goes through the SSRF-guarded fetchPublicUrl. API keys are sent
// only as headers, never in a URL, cache key or log line (NVD_API_KEY, optional).
// The OpenRouter model list is public: NO key of any kind is sent, and a client-supplied
// key is never read.
//
// Honesty: failures are never cached as data. Nothing truthful to serve =>
// { ok:false, status:"unavailable", reason, lastOkAt }; stale data is served with
// stale:true + fetchedAt. Nothing is ever invented.
//
// Env: CONCORD_PUBLIC_UA (User-Agent override), NVD_API_KEY (optional; raises the NVD
// rate limit from ~5/30s to ~50/30s).

import { registerSource, hasSource, get, _resetFeedCacheForTests } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";
import { safeText } from "./public-lookup-sources.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DEFAULT_UA = "ConcordOS/1.0 (https://concord-os.org; contact@concord-os.org)";
const userAgent = () => (typeof process.env.CONCORD_PUBLIC_UA === "string" && process.env.CONCORD_PUBLIC_UA.trim()) || DEFAULT_UA;
const nvdKey = () => (typeof process.env.NVD_API_KEY === "string" ? process.env.NVD_API_KEY.trim() : "");

// The literal values the components use (grep the hosts in concord-frontend/components).
export const NVD_SEVERITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const EONET_CATEGORIES = Object.freeze([
  "drought", "dustHaze", "earthquakes", "floods", "landslides", "manmade", "seaLakeIce",
  "severeStorms", "snow", "tempExtremes", "volcanoes", "waterColor", "wildfires",
]);
export const EONET_STATUSES = Object.freeze(["open", "closed", "all"]);
export const USGS_FEEDS = Object.freeze(["significant_week", "all_day", "4.5_week", "2.5_day"]);
export const FEMA_STATES = Object.freeze(["", "CA", "TX", "FL", "NY", "LA", "OK", "IL", "WA", "OR", "CO", "AZ", "GA", "NC", "PR"]);
export const REST_REGIONS = Object.freeze(["Africa", "Americas", "Asia", "Europe", "Oceania", "Antarctic"]);

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Test-only transport (url, init) => Response-like; null => the SSRF-guarded fetchPublicUrl.
let _transport = null;
export function setPublicDataTransportForTests(fn) { _transport = typeof fn === "function" ? fn : null; }

async function rawJson(url, signal, label, headers = {}) {
  const init = { headers: { Accept: "application/json", "User-Agent": userAgent(), ...headers }, signal };
  const r = await fetchPublicUrl(url, init, _transport ? { fetchImpl: _transport } : {});
  if (!r || r.ok !== true) {
    const status = Number(r?.status) || 0;
    throw new UpstreamError(`${label} HTTP ${status || "error"}`, status);
  }
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}

// Keys are JSON arrays so no free-text value can collide with a delimiter.
const keyOf = (...parts) => JSON.stringify(parts);
const enc = encodeURIComponent;

// ── parameter validation / key builders (null => invalid, no fetch) ─────────

export function nvdCvesKey({ keyword, severity } = {}) {
  const hasK = keyword !== undefined && keyword !== null && keyword !== "";
  const hasS = severity !== undefined && severity !== null && severity !== "";
  if (hasK && hasS) return null;
  if (hasS && !NVD_SEVERITIES.includes(severity)) return null;
  if (hasK && !safeText(keyword)) return null;
  return keyOf("nvd-cves", hasK ? "kw" : hasS ? "sev" : "recent", hasK ? keyword.trim() : hasS ? severity : "");
}
export function eonetEventsKey({ status, category } = {}) {
  const st = status === undefined || status === null || status === "" ? "open" : status;
  if (!EONET_STATUSES.includes(st)) return null;
  const cat = category === undefined || category === null ? "" : category;
  if (cat !== "" && !EONET_CATEGORIES.includes(cat)) return null;
  return keyOf("eonet-events", st, cat);
}
export function gutendexBooksKey({ q, topic } = {}) {
  const hasQ = q !== undefined && q !== null && q !== "";
  const hasT = topic !== undefined && topic !== null && topic !== "";
  if (hasQ === hasT) return null; // exactly one mode
  if (hasQ) return safeText(q) ? keyOf("gutendex-books", "search", q.trim()) : null;
  return /^[a-z-]{1,40}$/.test(String(topic).trim()) ? keyOf("gutendex-books", "topic", String(topic).trim()) : null;
}
export function sketchfabSearchKey({ q, downloadable } = {}) {
  const query = q === undefined || q === null ? "" : q;
  if (query !== "" && !safeText(query)) return null;
  return keyOf("sketchfab-search", String(query).trim(), downloadable === true ? "dl" : "all");
}
export function usgsQuakesKey({ feed } = {}) {
  return USGS_FEEDS.includes(feed) ? keyOf("usgs-quakes", feed) : null;
}
export function femaDisastersKey({ state } = {}) {
  const st = state === undefined || state === null ? "" : state;
  return FEMA_STATES.includes(st) ? keyOf("fema-disasters", st) : null;
}
export function restCountriesKey({ region } = {}) {
  if (typeof region !== "string") return null;
  const canon = REST_REGIONS.find((r) => r.toLowerCase() === region.trim().toLowerCase());
  return canon ? keyOf("restcountries-region", canon) : null;
}
export function sunriseSunsetKey({ lat, lng } = {}) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return keyOf("sunrise-sunset", la.toFixed(4), ln.toFixed(4));
}
export function npmSearchKey({ q } = {}) {
  return safeText(q) ? keyOf("npm-search", q.trim()) : null;
}
export const imgflipMemesKey = () => keyOf("imgflip-memes");
export const onionooSummaryKey = () => keyOf("onionoo-summary");
export const openRouterModelsKey = () => keyOf("openrouter-models");

// ── fetchers: (key, { signal }) -> JSON ─────────────────────────────────────

async function fetchNvd(key, { signal }) {
  const [, mode, term] = JSON.parse(key);
  const p = new URLSearchParams({ resultsPerPage: "25" });
  if (mode === "kw") p.set("keywordSearch", term);
  else if (mode === "sev") p.set("cvssV3Severity", term);
  const k = nvdKey();
  return rawJson(`https://services.nvd.nist.gov/rest/json/cves/2.0?${p}`, signal, "nvd", k ? { apiKey: k } : {});
}
async function fetchEonet(key, { signal }) {
  const [, status, category] = JSON.parse(key);
  const p = new URLSearchParams({ limit: "30" });
  if (status !== "all") p.set("status", status);
  if (category) p.set("category", category);
  return rawJson(`https://eonet.gsfc.nasa.gov/api/v3/events?${p}`, signal, "eonet");
}
async function fetchGutendex(key, { signal }) {
  const [, mode, term] = JSON.parse(key);
  const qs = mode === "search" ? `search=${enc(term)}` : `topic=${enc(term)}&sort=popular`;
  return rawJson(`https://gutendex.com/books/?${qs}`, signal, "gutendex");
}
async function fetchSketchfab(key, { signal }) {
  const [, q, dl] = JSON.parse(key);
  const p = new URLSearchParams({ type: "models", count: "20", sort_by: "-likeCount", archives_flavours: "false" });
  if (q) p.set("q", q);
  if (dl === "dl") p.set("downloadable", "true");
  return rawJson(`https://api.sketchfab.com/v3/search?${p}`, signal, "sketchfab");
}
async function fetchUsgs(key, { signal }) {
  const [, feed] = JSON.parse(key);
  return rawJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`, signal, "usgs");
}
async function fetchFema(key, { signal }) {
  const [, state] = JSON.parse(key);
  const filter = state ? `&$filter=state%20eq%20'${state}'` : "";
  return rawJson(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=30&$orderby=declarationDate%20desc${filter}`, signal, "fema");
}
async function fetchRestCountries(key, { signal }) {
  const [, region] = JSON.parse(key);
  return rawJson(`https://restcountries.com/v3.1/region/${enc(region)}?fields=name,cca3,capital,region,subregion,population,area,languages,currencies`, signal, "restcountries");
}
async function fetchSunriseSunset(key, { signal }) {
  const [, lat, lng] = JSON.parse(key);
  return rawJson(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`, signal, "sunrise-sunset");
}
async function fetchImgflip(key, { signal }) {
  return rawJson("https://api.imgflip.com/get_memes", signal, "imgflip");
}
async function fetchOnionoo(key, { signal }) {
  return rawJson("https://onionoo.torproject.org/summary?limit=2000", signal, "onionoo");
}
async function fetchNpm(key, { signal }) {
  const [, q] = JSON.parse(key);
  return rawJson(`https://registry.npmjs.org/-/v1/search?text=${enc(q)}&size=20`, signal, "npm");
}
async function fetchOpenRouter(key, { signal }) {
  // Public model list only. No Authorization header is ever sent here.
  return rawJson("https://openrouter.ai/api/v1/models", signal, "openrouter");
}

// ── registration ────────────────────────────────────────────────────────────

// Independent keys (one query each): a bad query must not open a source-wide breaker.
const PER_KEY = { breaker: false, keyBackoff: true, gateKeyBackoff: true };
const base = (ttlMs, staleMaxMs, perMin, perDay) => ({
  ttlMs, staleMaxMs, timeoutMs: 10_000, license: "public", persist: true, maxKeys: 5000, ...PER_KEY,
  budget: { perMin, perDay },
});

let _nvdKeyed = null;

/** Register-once; re-registers nvd only when NVD_API_KEY appears/disappears. Safe to call repeatedly. */
export function ensurePublicDataSources() {
  const keyed = !!nvdKey();
  if (!hasSource("nvd") || _nvdKeyed !== keyed) {
    registerSource("nvd", { ...base(HOUR, 7 * DAY, keyed ? 40 : 5, keyed ? 5000 : 500), fetcher: fetchNvd });
    _nvdKeyed = keyed;
  }
  const defs = [
    ["eonet", base(15 * MIN, DAY, 30, 5000), fetchEonet],
    ["gutendex", base(DAY, 30 * DAY, 30, 5000), fetchGutendex],
    ["sketchfab", base(HOUR, 7 * DAY, 30, 5000), fetchSketchfab],
    ["usgs-quakes", base(5 * MIN, DAY, 30, 5000), fetchUsgs],
    ["fema", base(6 * HOUR, 7 * DAY, 30, 5000), fetchFema],
    ["restcountries", base(DAY, 30 * DAY, 30, 5000), fetchRestCountries],
    ["sunrise-sunset", base(DAY, 30 * DAY, 30, 5000), fetchSunriseSunset],
    ["imgflip", base(DAY, 30 * DAY, 30, 5000), fetchImgflip],
    ["onionoo", base(15 * MIN, DAY, 30, 5000), fetchOnionoo],
    ["npm-registry", base(HOUR, 7 * DAY, 30, 5000), fetchNpm],
    ["openrouter", base(HOUR, 7 * DAY, 30, 5000), fetchOpenRouter],
  ];
  for (const [id, cfg, fetcher] of defs) {
    if (!hasSource(id)) registerSource(id, { ...cfg, fetcher });
  }
}
ensurePublicDataSources();

// ── accessors ───────────────────────────────────────────────────────────────

const unavailable = (reason, extra = {}) => ({
  ok: false, status: "unavailable", reason, lastOkAt: null, error: `upstream unavailable: ${reason}`, ...extra,
});

/** { ok:true, data, fetchedAt, stale } | { ok:false, status:"unavailable", reason, lastOkAt, error } */
function shape(r) {
  if (r.status === "unavailable" || r.data == null) return unavailable(String(r.reason || "") || "unavailable", { lastOkAt: r.lastOkAt ?? null });
  return { ok: true, data: r.data, fetchedAt: r.fetchedAt, stale: !!r.stale };
}

async function via(sourceId, key) {
  ensurePublicDataSources();
  if (!key) return unavailable("invalid_request");
  return shape(await get(sourceId, key));
}

export const getNvdCves = (o) => via("nvd", nvdCvesKey(o || {}));
export const getEonetEvents = (o) => via("eonet", eonetEventsKey(o || {}));
export const getGutendexBooks = (o) => via("gutendex", gutendexBooksKey(o || {}));
export const getSketchfabSearch = (o) => via("sketchfab", sketchfabSearchKey(o || {}));
export const getUsgsQuakes = (o) => via("usgs-quakes", usgsQuakesKey(o || {}));
export const getFemaDisasters = (o) => via("fema", femaDisastersKey(o || {}));
export const getRestCountriesRegion = (o) => via("restcountries", restCountriesKey(o || {}));
export const getSunriseSunset = (o) => via("sunrise-sunset", sunriseSunsetKey(o || {}));
export const getImgflipMemes = () => via("imgflip", imgflipMemesKey());
export const getOnionooSummary = () => via("onionoo", onionooSummaryKey());
export const getNpmSearch = (o) => via("npm-registry", npmSearchKey(o || {}));
export const getOpenRouterModels = () => via("openrouter", openRouterModelsKey());

/** Test hook: forget every cached entry, registrations and transport. */
export function _resetPublicDataForTests() {
  _resetFeedCacheForTests();
  _nvdKeyed = null;
  ensurePublicDataSources();
  setPublicDataTransportForTests(null);
}
