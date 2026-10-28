// server/lib/gdelt-source.js
//
// The ONE feed-cache source for GDELT (api.gdeltproject.org). news.headlines,
// news.daily-briefing and grounding.discoverCoverage all read through it, so
// they share a single budget (at most 1 upstream request per GDELT_BUDGET_EVERY_MS,
// warm ticks included), a single serialized queue (>= 5 s between starts), and
// a single 60 s..10 min exponential back-off.
//
// Keys: a news category name ("tech") or a grounding query key (see queryKey()).
// Cached value: the raw GDELT `articles` array. Failures are never cached as
// data; with no budget / in back-off the caller gets stale data or an honest
// { status:"unavailable", reason, lastOkAt }.

import { fetchPublicUrl } from "./public-fetch.js";
import {
  registerSource, hasSource, get, pool, configureFeedCache, _resetFeedCacheForTests,
} from "./feed-cache.js";
import { getDedupKeyAndHash } from "./dedup-keys.js";

export const GDELT_SOURCE_ID = "gdelt";

export const CATEGORY_QUERIES = {
  top:        "(world OR breaking) sourcelang:eng",
  world:      "(world OR international OR foreign) sourcelang:eng",
  business:   "(business OR economy OR markets OR earnings) sourcelang:eng",
  tech:       "(technology OR AI OR software OR startup) sourcelang:eng",
  science:    "(science OR research OR climate OR space) sourcelang:eng",
  politics:   "(politics OR congress OR election OR policy) sourcelang:eng",
  sports:     "(sports OR olympics OR football OR basketball) sourcelang:eng",
  health:     "(health OR medicine OR vaccine OR pandemic) sourcelang:eng",
  entertainment: "(entertainment OR film OR music OR celebrity) sourcelang:eng",
};
export const NEWS_CATEGORIES = Object.keys(CATEGORY_QUERIES);

/** Shared GDELT budget: one upstream request per this many ms across ALL callers (Ramaj D1). */
export const GDELT_BUDGET_EVERY_MS = 100_000;

export const GDELT_TIMEOUT_MS = 20_000;

const DEFAULTS = {
  ttlMs: 15 * 60 * 1000,
  staleMaxMs: 6 * 60 * 60 * 1000,
  // GDELT live answers take ~10 s (measured 2026-10-27); 8 s aborted every request.
  // User-facing callers (news.headlines / daily-briefing) cap their OWN wait at ~8 s and
  // answer { reason:"warming" } while this fetch continues and fills the cache.
  timeoutMs: GDELT_TIMEOUT_MS,
  minSpacingMs: 5000,
  everyMs: GDELT_BUDGET_EVERY_MS,
  backoffStartMs: 60 * 1000,
  backoffMaxMs: 10 * 60 * 1000,
};
let _overrides = {};
let _lastFailure = null; // { reason, at } since the last success; names the cause during back-off

const QUERY_PREFIX = "q|";

/** Cache key for a free-text query (grounding). */
export function queryKey(query, maxRecords) {
  return `${QUERY_PREFIX}${Math.max(1, Math.min(50, Number(maxRecords) || 20))}|${query}`;
}

function urlForKey(key) {
  let query; let max = 50;
  if (Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES, key)) {
    query = CATEGORY_QUERIES[key];
  } else if (typeof key === "string" && key.startsWith(QUERY_PREFIX)) {
    const rest = key.slice(QUERY_PREFIX.length);
    const i = rest.indexOf("|");
    max = Number(rest.slice(0, i)) || 20;
    query = rest.slice(i + 1);
  } else {
    throw new Error(`unknown GDELT key ${String(key).slice(0, 40)}`);
  }
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=${max}&format=json&sort=DateDesc`;
}

async function fetchGdelt(key, { signal } = {}) {
  const url = urlForKey(key);
  try {
    const r = await fetchPublicUrl(url, { signal });
    if (!r.ok) {
      throw new Error(r.status === 429 ? "rate_limited" : `GDELT ${r.status}`);
    }
    const data = await r.json();
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    _lastFailure = null;
    return articles;
  } catch (e) {
    _lastFailure = { reason: mapReason(`upstream_error: ${e?.message || "network"}`), at: Date.now() };
    throw e;
  }
}

/** Public reason strings: "rate_limited", "timeout", "upstream_error: GDELT 503", "budget_exhausted", ... */
function mapReason(reason) {
  const r = String(reason || "");
  if (r === "upstream_error: rate_limited") return "rate_limited";
  if (/^upstream_error: timeout after/.test(r)) return "timeout";
  if (r === "upstream_backoff") return _lastFailure?.reason || r;
  return r;
}

function register() {
  const o = { ...DEFAULTS, ..._overrides };
  registerSource(GDELT_SOURCE_ID, {
    ttlMs: o.ttlMs,
    staleMaxMs: o.staleMaxMs,
    timeoutMs: o.timeoutMs,
    budget: { minSpacingMs: o.minSpacingMs, everyMs: o.everyMs, burst: 1 },
    breaker: { baseMs: o.backoffStartMs, maxMs: o.backoffMaxMs },
    license: "public",
    serialize: true, // strictly one GDELT request in flight, even if minSpacingMs is lowered
    persist: true,
    persistFilter: (k) => Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES, k), // never write user claim queries to disk
    warm: { keys: NEWS_CATEGORIES, everyTicks: 1 },
    fetcher: fetchGdelt,
  });
}
function ensureSource() { if (!hasSource(GDELT_SOURCE_ID)) register(); }

/** Make sure the source (and its warm key list) is registered. Safe to call repeatedly. */
export function ensureGdeltSource() { ensureSource(); return GDELT_SOURCE_ID; }

/** Test hook: override source settings (and clock/sleep) and re-register. */
export function __configureGdeltForTests({ now, sleep, ...overrides } = {}) {
  _overrides = { ..._overrides, ...overrides };
  if (now || sleep) configureFeedCache({ ...(now ? { now } : {}), ...(sleep ? { sleep } : {}) });
  if (hasSource(GDELT_SOURCE_ID)) register();
}
export function __resetGdeltForTests() {
  _resetFeedCacheForTests();
  _overrides = {};
  _lastFailure = null;
}

/**
 * Never rejects. Reads one key through the shared source.
 * @returns {{ articles:Array, status:"fresh"|"stale"|"unavailable", stale:boolean,
 *   fetchedAt:string|null, lastOkAt:string|null, reason:string|null, degradedReason:string|null }}
 */
export async function getGdelt(key, { ttlMs, allowStale = true } = {}) {
  ensureSource();
  const r = await get(GDELT_SOURCE_ID, key, { allowStale, ...(ttlMs >= 0 ? { ttlMs } : {}) });
  const iso = (t) => (typeof t === "number" ? new Date(t).toISOString() : null);
  if (r.status === "unavailable") {
    const reason = mapReason(r.reason);
    return { articles: [], status: "unavailable", stale: false, fetchedAt: null, lastOkAt: iso(r.lastOkAt), reason, degradedReason: reason };
  }
  // Served from cache but the last upstream attempt failed: say why (honest degraded label).
  const degradedReason = r.stale && _lastFailure ? _lastFailure.reason : null;
  return {
    articles: Array.isArray(r.data) ? r.data : [],
    status: r.status, stale: !!r.stale,
    fetchedAt: iso(r.fetchedAt), lastOkAt: iso(r.fetchedAt),
    reason: degradedReason, degradedReason,
  };
}

/**
 * Deduped articles from the last few GDELT pulls of one key, newest pull first. Reads the
 * cache only (never an upstream call). Used for the rotating news pool.
 */
export async function getGdeltPool(key) {
  ensureSource();
  const p = await pool(GDELT_SOURCE_ID, key, {
    cursor: 0, limit: 100000, noFetch: true,
    dedupeKey: (a) => getDedupKeyAndHash({ title: a?.title || "", sourceUrl: a?.url || "" }).hash,
  });
  return {
    items: p.items,
    status: p.status === "unavailable" ? "unavailable" : p.status, // "fresh" | "stale" | "unavailable"
    fetchedAt: typeof p.fetchedAt === "number" ? new Date(p.fetchedAt).toISOString() : null,
    lastOkAt: typeof p.lastOkAt === "number" ? new Date(p.lastOkAt).toISOString() : null,
  };
}

/** News category read (unknown categories fall back to "top"). */
export function getGdeltCategory(category) {
  return getGdelt(Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES, category) ? category : "top");
}
