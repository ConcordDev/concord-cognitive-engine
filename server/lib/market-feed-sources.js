// server/lib/market-feed-sources.js
//
// Market / FX upstreams routed through lib/feed-cache.js: CoinGecko, Yahoo Finance
// (v7 quote + v8 chart), Frankfurter (ECB) and open.er-api.com. This is the ONLY server
// module that names these hosts (pinned by tests/no-bare-market-fetch.test.js), so every
// lens macro, 60 s poller and DTU feed shares one cache entry per request: the same coin
// list asked for by the crypto lens, the realtime ticker and the feed-manager costs one
// upstream call per TTL, and a fresh cache means no upstream call at all.
//
// Honesty: failures are never cached as data. When nothing truthful can be served the
// caller gets { ok:false, status:"unavailable", reason, lastOkAt }; stale data is served
// with stale:true + fetchedAt. A price is never invented. A definitive HTTP answer that is
// not data (404 unknown coin/symbol, Yahoo's 401 on v7) is cached briefly as a marker and
// surfaced as reason "http_<status>" so one bad query cannot open the source-wide breaker.
//
// Licensing (metadata only; feed-cache does not enforce it):
//   coingecko   keyed-display-ok  public display requires COINGECKO_ATTRIBUTION (linked).
//   yahoo-*     internal-only     unofficial endpoints, personal/non-commercial terms; kept
//                                 for now by owner decision, to be swapped for a licensed
//                                 provider before Concord charges users.
//   fx-erapi    public            free tier asks for ERAPI_ATTRIBUTION.
//   fx-frankfurter public         ECB reference rates, no key.
//
// Env: COINGECKO_DEMO_API_KEY (optional) — sent ONLY as the `x-cg-demo-api-key` header at
// fetch time (never in a URL, cache key, log line or persist file) and raises the budget.
// Without it the source runs keyless on a shared ~4/min budget and degrades to stale /
// "unavailable" under load rather than failing silently.
//
// Sources register on import (register-once via hasSource) and again on demand via
// ensureMarketFeedSources(), because feed-cache's test reset clears the registry.

import { registerSource, hasSource, get, clearSource, _resetFeedCacheForTests } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const COINGECKO_ATTRIBUTION = "Data provided by CoinGecko";
export const COINGECKO_ATTRIBUTION_URL = "https://www.coingecko.com";
export const ERAPI_ATTRIBUTION = "Rates By Exchange Rate API";
export const ERAPI_ATTRIBUTION_URL = "https://www.exchangerate-api.com";
export const FRANKFURTER_ATTRIBUTION = "Rates: European Central Bank via Frankfurter";
export const FRANKFURTER_ATTRIBUTION_URL = "https://frankfurter.dev";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const YAHOO_BASE = "https://query1.finance.yahoo.com";
// api.frankfurter.app now 301-redirects to api.frankfurter.dev/v1, which the
// SSRF-guarded fetch cannot follow cross-host — call the new base directly.
// The v1 API accepts the same from/to parameter aliases this fetcher sends.
const FRANKFURTER_BASE = "https://api.frankfurter.dev/v1";
const ERAPI_BASE = "https://open.er-api.com/v6/latest";
const YAHOO_UA = "Mozilla/5.0 (Concord-OS/1.0)";

// ── URLs more than one system polls (single source of truth; shared-http re-exports them) ──

// Both are written in the exact form the fetchers send (chart: interval before range; CoinGecko: the
// canonical sorted-key form), so the literal a poller lists is the URL that actually goes upstream.
export const yahooChartUrl = (sym) =>
  `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
export const COINGECKO_TOP10_URL =
  `${COINGECKO_BASE}/simple/price?ids=avalanche-2,bitcoin,cardano,chainlink,dogecoin,ethereum,polkadot,polygon-ecosystem-token,ripple,solana&include_24hr_change=true&include_market_cap=true&vs_currencies=usd`;

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Test-only transport (url, init) => Response-like; null => the SSRF-guarded fetchPublicUrl.
let _transport = null;
let _timeoutMs = 10_000;
export function setMarketTransportForTests(fn) { _transport = typeof fn === "function" ? fn : null; }

async function rawJson(url, headers, signal, label) {
  const init = { headers: { Accept: "application/json", ...(headers || {}) }, signal };
  const r = await fetchPublicUrl(url, init, _transport ? { fetchImpl: _transport } : {});
  if (!r || r.ok !== true) {
    const status = Number(r?.status) || 0;
    throw new UpstreamError(`${label} HTTP ${status || "error"}`, status);
  }
  // Some injected test transports only implement text().
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}

/** Fetch JSON, turning the listed definitive statuses into a cacheable marker instead of a failure. */
async function jsonOrMarker(url, headers, signal, label, markerStatuses) {
  try {
    return await rawJson(url, headers, signal, label);
  } catch (e) {
    if (markerStatuses.includes(e?.status)) return { __httpStatus: e.status };
    throw e;
  }
}

// ── key encoding ────────────────────────────────────────────────────────────

/**
 * Canonical CoinGecko key: "/path?k=v&k=v" with params sorted and the comma-lists in `ids`
 * sorted, so the poller and a user search for the same coins land on one entry.
 * Returns null for a path that is not a plain /api/v3 resource path.
 */
export function coingeckoKey(pathWithQuery) {
  const raw = String(pathWithQuery ?? "");
  const qi = raw.indexOf("?");
  const p = qi < 0 ? raw : raw.slice(0, qi);
  if (!/^\/[A-Za-z0-9._~%/-]+$/.test(p) || p.includes("..") || p.includes("//")) return null;
  const params = new URLSearchParams(qi < 0 ? "" : raw.slice(qi + 1));
  const entries = [];
  for (const [k, v] of params) {
    if (v === "") continue;
    entries.push([k, k === "ids" ? v.split(",").map((s) => s.trim()).filter(Boolean).sort().join(",") : v]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const q = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ",")}`).join("&");
  return q ? `${p}?${q}` : p;
}

const normSymbol = (s) => String(s ?? "").trim().toUpperCase();
const SYMBOL_OK = /^[A-Z0-9^=.\-_]{1,24}$/;
const CHART_RANGE_OK = /^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$/;
const CHART_INTERVAL_OK = /^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/;
const CCY_OK = /^[A-Z]{3}$/;

export function yahooQuoteKey(symbols) {
  const list = [...new Set((Array.isArray(symbols) ? symbols : [symbols]).map(normSymbol).filter(Boolean))].sort();
  if (list.length === 0 || list.length > 50 || !list.every((s) => SYMBOL_OK.test(s))) return null;
  return list.join(",");
}

export function yahooChartKey(symbol, { range = "1mo", interval = "1d" } = {}) {
  const s = normSymbol(symbol);
  if (!SYMBOL_OK.test(s) || !CHART_RANGE_OK.test(range) || !CHART_INTERVAL_OK.test(interval)) return null;
  return `${s}|${range}|${interval}`;
}

// ── fetchers (key, { signal }) -> JSON-serializable data ────────────────────

const coingeckoApiKey = () => (typeof process.env.COINGECKO_DEMO_API_KEY === "string" ? process.env.COINGECKO_DEMO_API_KEY.trim() : "");

function fetchCoinGecko(key, { signal }) {
  const k = coingeckoApiKey();
  return jsonOrMarker(`${COINGECKO_BASE}${key}`, k ? { "x-cg-demo-api-key": k } : {}, signal, "coingecko", [404]);
}

// Yahoo's v7 /quote answers 401 to unauthenticated callers; that is a stable answer, so it is
// cached as a marker and the caller decides (market.js falls back to the v8 chart).
function fetchYahooQuote(key, { signal }) {
  return jsonOrMarker(`${YAHOO_BASE}/v7/finance/quote?symbols=${encodeURIComponent(key)}`, { "User-Agent": YAHOO_UA }, signal, "yahoo-quote", [401, 403, 404]);
}

function fetchYahooChart(key, { signal }) {
  const [symbol, range, interval] = key.split("|");
  return jsonOrMarker(`${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,{ "User-Agent": YAHOO_UA }, signal, "yahoo-chart", [404]);
}

// key: "BASE|SYM,SYM" (symbols may be empty = every currency)
function fetchFrankfurter(key, { signal }) {
  const [base, symbols] = key.split("|");
  const q = [`from=${encodeURIComponent(base)}`];
  if (symbols) q.push(`to=${encodeURIComponent(symbols).replace(/%2C/gi, ",")}`);
  return rawJson(`${FRANKFURTER_BASE}/latest?${q.join("&")}`, {}, signal, "frankfurter");
}

function fetchErApi(key, { signal }) {
  return rawJson(`${ERAPI_BASE}/${encodeURIComponent(key)}`, {}, signal, "er-api");
}

// ── registration ────────────────────────────────────────────────────────────

// Independent keys (symbols / pairs): per-key back-off, never a source-wide breaker.
const PER_KEY = { breaker: false, keyBackoff: true, gateKeyBackoff: true };

function coingeckoConfig(keyed) {
  return {
    ttlMs: 120 * SEC, staleMaxMs: HOUR, timeoutMs: _timeoutMs, license: "keyed-display-ok", maxKeys: 2000,
    budget: keyed ? { perMin: 60, perDay: 330 } : { perMin: 4, perDay: 400 },
    fetcher: fetchCoinGecko,
  };
}

const OTHER_SOURCES = [
  ["yahoo-quote", { ttlMs: 60 * SEC, staleMaxMs: 15 * MIN, budget: { perMin: 20, perDay: 3000 }, timeoutMs: 10_000, license: "internal-only", maxKeys: 500, ...PER_KEY, fetcher: fetchYahooQuote }],
  ["yahoo-chart", { ttlMs: 5 * MIN, staleMaxMs: HOUR, budget: { perMin: 20, perDay: 2000 }, timeoutMs: 10_000, license: "internal-only", maxKeys: 500, ...PER_KEY, fetcher: fetchYahooChart }],
  ["fx-frankfurter", { ttlMs: HOUR, staleMaxMs: 2 * DAY, budget: { perMin: 10 }, timeoutMs: 10_000, license: "public", maxKeys: 200, ...PER_KEY, fetcher: fetchFrankfurter }],
  ["fx-erapi", { ttlMs: 6 * HOUR, staleMaxMs: 3 * DAY, budget: { perMin: 5 }, timeoutMs: 10_000, license: "public", maxKeys: 200, ...PER_KEY, fetcher: fetchErApi }],
];

let _cgKeyed = null; // which budget the coingecko source is currently registered with

/** Register-once; re-registers coingecko only when the Demo key appears/disappears. Safe to call repeatedly. */
export function ensureMarketFeedSources() {
  const keyed = !!coingeckoApiKey();
  if (!hasSource("coingecko") || _cgKeyed !== keyed) {
    registerSource("coingecko", coingeckoConfig(keyed));
    _cgKeyed = keyed;
  }
  for (const [id, cfg] of OTHER_SOURCES) {
    if (!hasSource(id)) registerSource(id, cfg);
  }
}
ensureMarketFeedSources();

// ── accessors ───────────────────────────────────────────────────────────────

const unavailable = (reason, extra = {}) => ({
  ok: false, status: "unavailable", reason, lastOkAt: null, error: `upstream unavailable: ${reason}`, ...extra,
});

/** { ok:true, data, fetchedAt, stale } | { ok:false, status:"unavailable", reason, lastOkAt, error[, httpStatus] } */
function shape(r) {
  if (r.status === "unavailable" || r.data == null) {
    const reason = String(r.reason || "") || "unavailable";
    return unavailable(reason, { lastOkAt: r.lastOkAt ?? null });
  }
  if (r.data.__httpStatus) {
    return unavailable(`http_${r.data.__httpStatus}`, { httpStatus: r.data.__httpStatus, lastOkAt: null });
  }
  return { ok: true, data: r.data, fetchedAt: r.fetchedAt, stale: !!r.stale };
}

// o.allowStale === false: an expired entry is refetched (or reported unavailable) instead of served stale,
// for pollers that re-publish the value as "fresh" under their own timestamp.
async function via(sourceId, key, o = {}) {
  ensureMarketFeedSources();
  return shape(await get(sourceId, key, o.allowStale === false ? { allowStale: false } : {}));
}

/** Throwing flavour: returns the JSON or throws `<label> <reason>` (err.status / err.reason / err.httpStatus). */
function orThrow(label, r) {
  if (r.ok) return r.data;
  const err = new Error(`${label} ${r.reason}`);
  err.status = r.status;
  err.reason = r.reason;
  err.httpStatus = r.httpStatus;
  err.lastOkAt = r.lastOkAt;
  throw err;
}

/** CoinGecko request ("/coins/markets?vs_currency=usd&...") through the shared cache. */
export function getCoinGecko(pathWithQuery, o = {}) {
  const key = coingeckoKey(pathWithQuery);
  if (!key) return Promise.resolve(unavailable("invalid_request"));
  return via("coingecko", key, o);
}
export async function coingeckoJson(pathWithQuery, o = {}) { return orThrow("coingecko", await getCoinGecko(pathWithQuery, o)); }

/** Yahoo v7 quote for a list of symbols. data = raw upstream JSON ({quoteResponse:{result:[...]}}). */
export function getYahooQuotes(symbols, o = {}) {
  const key = yahooQuoteKey(symbols);
  if (!key) return Promise.resolve(unavailable("invalid_symbols"));
  return via("yahoo-quote", key, o);
}

/** Yahoo v8 chart. data = raw upstream JSON ({chart:{result:[...]}}). */
export function getYahooChart(symbol, opts = {}) {
  const key = yahooChartKey(symbol, opts);
  if (!key) return Promise.resolve(unavailable("invalid_request"));
  return via("yahoo-chart", key, opts);
}

/** Frankfurter (ECB) latest rates. data = raw upstream JSON ({base,date,rates}). */
export function getFrankfurterLatest({ base = "USD", symbols } = {}) {
  const b = normSymbol(base);
  const list = [...new Set((Array.isArray(symbols) ? symbols : []).map(normSymbol))].filter(Boolean).sort();
  if (!CCY_OK.test(b) || !list.every((s) => CCY_OK.test(s))) return Promise.resolve(unavailable("invalid_currency"));
  return via("fx-frankfurter", `${b}|${list.join(",")}`);
}

/** open.er-api.com latest rates for a base. data = raw upstream JSON ({rates,time_last_update_utc,...}). */
export function getErApiLatest(base = "USD") {
  const b = normSymbol(base);
  if (!CCY_OK.test(b)) return Promise.resolve(unavailable("invalid_currency"));
  return via("fx-erapi", b);
}

// ── URL-keyed reads for the pollers that list literal upstream URLs ─────────

/** Which market source (if any) a literal upstream URL belongs to, so pollers read the shared cache. */
export function marketUpstream(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "api.coingecko.com" && u.pathname.startsWith("/api/v3/")) {
    return { source: "coingecko", pathWithQuery: `${u.pathname.slice("/api/v3".length)}${u.search}` };
  }
  const m = u.hostname === "query1.finance.yahoo.com" && u.pathname.match(/^\/v8\/finance\/chart\/([^/]+)$/);
  if (m) {
    const range = u.searchParams.get("range") || "1mo";
    const interval = u.searchParams.get("interval") || "1d";
    return { source: "yahoo-chart", symbol: decodeURIComponent(m[1]), range, interval };
  }
  return null;
}

export function isMarketUpstream(url) { return marketUpstream(url) !== null; }

/** Shaped read for a literal market URL (pollers); unavailable for anything else. */
export function getMarketUpstream(url, o = {}) {
  const m = marketUpstream(url);
  if (!m) return Promise.resolve(unavailable("not_a_market_url"));
  return m.source === "coingecko" ? getCoinGecko(m.pathWithQuery, o) : getYahooChart(m.symbol, { range: m.range, interval: m.interval, ...o });
}

// ── housekeeping ────────────────────────────────────────────────────────────

/** Forget every cached market entry and any failure back-off (keeps registrations). */
export function clearMarketCaches() {
  ensureMarketFeedSources();
  for (const id of ["coingecko", ...OTHER_SOURCES.map(([i]) => i)]) clearSource(id, { resetBackoff: true });
}

/** Test hook: forget every cached entry, the registrations and any test transport. */
export function _resetMarketFeedForTests() {
  _resetFeedCacheForTests();
  _cgKeyed = null;
  ensureMarketFeedSources();
  setMarketTransportForTests(null);
}
