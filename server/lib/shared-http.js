// server/lib/shared-http.js
//
// One URL-keyed raw-text cache on the shared feed-cache ("shared-http"), so the SAME
// upstream URL is fetched once no matter which system asks: emergent/realtime-feeds.js,
// lib/feed-manager.js (DTU ingest) and lib/news-sources.js (news RSS pool).
//
// Every fetch goes through the SSRF guard (fetchPublicUrl). Failures are never cached
// as data; a dead URL backs off per key (60s..10min) without blocking other URLs.
// Callers pick their own TTL per read (a read younger than the TTL is a cache hit).

import { fetchPublicUrl } from "./public-fetch.js";
import { registerSource, hasSource, get, getOrThrow } from "./feed-cache.js";

export const SHARED_HTTP_SOURCE_ID = "shared-http";
export const SHARED_UA = "ConcordOS/1.0 (+https://concord-os.org; feed reader)";
const MAX_BODY_CHARS = 3_000_000;
const FETCH_TIMEOUT_MS = 10_000;

// ── upstream URLs that more than one system polls ───────────────────────────
// Single source of truth: realtime-feeds builds its requests from these, and
// feed-manager's feed-sources.js lists the same literal URLs (pinned by a test).

export const yahooChartUrl = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
export const COINGECKO_TOP10_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,polkadot,ripple,dogecoin,chainlink,avalanche-2,polygon-ecosystem-token&vs_currencies=usd&include_24hr_change=true&include_market_cap=true";
export const NPR_TOP_URL = "https://feeds.npr.org/1001/rss.xml";
export const BBC_TOP_URL = "https://feeds.bbci.co.uk/news/rss.xml";
export const BBC_WORLD_URL = "https://feeds.bbci.co.uk/news/world/rss.xml";
// WHO retired the Disease Outbreak News RSS (feeds/entity/don/en/rss.xml now 404s). This is
// WHO's official DON OData JSON API (the one who.int's own DON page reads): newest 5, headline +
// date + item path only. WHO terms: headline + link + attribution, never the article body.
export const WHO_DON_URL = "https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDate%20desc&$top=5&$select=Title,PublicationDate,ItemDefaultUrl,DonId";
export const WHO_DON_ITEM_BASE = "https://www.who.int/emergencies/disease-outbreak-news/item";

const SHARED_URLS = new Set([
  ...["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"].map(yahooChartUrl),
  COINGECKO_TOP10_URL, NPR_TOP_URL, BBC_TOP_URL, BBC_WORLD_URL, WHO_DON_URL,
]);

/** True when this exact URL is polled by more than one system and must read through the shared cache. */
export function isSharedUpstream(url) { return SHARED_URLS.has(String(url || "")); }
export function sharedUpstreamUrls() { return [...SHARED_URLS]; }

// ── transport (test seam) ───────────────────────────────────────────────────

let _fetchImpl = null;
/** TEST-ONLY: (url, init) => Response-like, replaces the real guarded transport. */
export function __setSharedHttpFetchImpl(fn) { _fetchImpl = typeof fn === "function" ? fn : null; }

async function fetchText(url, { signal } = {}) {
  const res = await fetchPublicUrl(
    url,
    { signal, headers: { "User-Agent": SHARED_UA, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5" } },
    _fetchImpl ? { fetchImpl: _fetchImpl } : {},
  );
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.retryAfter = res.headers?.get?.("retry-after") ?? null;
    throw err;
  }
  const text = await res.text();
  if (typeof text !== "string" || !text.length) throw new Error("empty_body");
  if (text.length > MAX_BODY_CHARS) throw new Error("body_too_large");
  return { text, contentType: res.headers?.get?.("content-type") || "" };
}

export function ensureSharedHttpSource() {
  if (hasSource(SHARED_HTTP_SOURCE_ID)) return SHARED_HTTP_SOURCE_ID;
  registerSource(SHARED_HTTP_SOURCE_ID, {
    ttlMs: 60_000,
    staleMaxMs: 6 * 60 * 60 * 1000,
    timeoutMs: FETCH_TIMEOUT_MS + 2000,
    // ~40 distinct URLs across realtime/feed-manager/news; each is read at most every 30s-10min.
    budget: { perMin: 120 },
    breaker: false,       // independent hosts: per-key back-off, never a source-wide breaker
    keyBackoff: true,
    gateKeyBackoff: true,
    license: "public",
    maxKeys: 150,
    fetcher: (url, { signal } = {}) => fetchText(url, { signal }),
  });
  return SHARED_HTTP_SOURCE_ID;
}

/**
 * Fresh-or-honest-failure read. -> { status, text?, contentType?, fetchedAt, stale, reason?, lastOkAt? }
 * Never serves stale text: an expired entry is refetched (shared with any concurrent caller), and a
 * failed refetch is "unavailable".
 */
export async function getSharedText(url, { ttlMs = 60_000 } = {}) {
  ensureSharedHttpSource();
  const r = await get(SHARED_HTTP_SOURCE_ID, String(url), { ttlMs, allowStale: false });
  if (r.status === "unavailable") return { status: "unavailable", reason: r.reason, lastOkAt: r.lastOkAt ?? null, fetchedAt: null, stale: false };
  return { status: r.status, text: r.data.text, contentType: r.data.contentType, fetchedAt: r.fetchedAt, stale: r.stale };
}

/** Throwing flavour: returns { text, contentType }; throws the ORIGINAL upstream error (keeps .status/.retryAfter). */
export async function getSharedTextOrThrow(url, { ttlMs = 60_000 } = {}) {
  ensureSharedHttpSource();
  const data = await getOrThrow(SHARED_HTTP_SOURCE_ID, String(url), { ttlMs, allowStale: false });
  return data;
}

/** Response-like wrapper so feed-manager's parsing path (status/ok/headers/text/json) is unchanged. */
export function responseLike({ text, contentType = "" }) {
  return {
    ok: true, status: 200, statusText: "OK",
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? contentType : null) },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}
