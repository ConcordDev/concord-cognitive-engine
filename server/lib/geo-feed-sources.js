// server/lib/geo-feed-sources.js
//
// The ONE door to the public OpenStreetMap Nominatim geocoder, routed through
// lib/feed-cache.js so the whole app obeys the Nominatim usage policy
// (operations.osmfoundation.org/policies/nominatim):
//   - at most 1 request/second app-wide  -> source "nominatim", minSpacingMs 1000
//     (feed-cache serialises it, so concurrent callers queue instead of bursting)
//   - an identifying User-Agent           -> osmUserAgent()
//   - cache results                       -> 30d TTL, persisted across restarts
//   - no autocomplete, no bulk/periodic   -> this module has NO warm keys and no
//     heartbeat; every call is a user-initiated lookup
//   - provider must be switchable         -> NOMINATIM_BASE env override
//   - ODbL attribution                    -> OSM_ATTRIBUTION, for UIs to show
//
// Keys: `search:<normalized q>` and `reverse:<lat,lon at 5dp>`. The cached
// value is the raw upstream JSON (format=jsonv2, addressdetails=1, up to
// SEARCH_FETCH_LIMIT hits) so every caller shapes its own view and callers
// asking for different limits share one entry.
//
// Honesty: failures are never cached as data. When nothing truthful can be
// served the answer is { ok:false, status:"unavailable", reason, lastOkAt }.
// When more than MAX_PENDING lookups are already waiting for the 1 req/s queue
// the answer is reason "geocoder_busy" rather than an unbounded wait.

import { registerSource, hasSource, get, peek } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const DAY = 86_400_000;
const SOURCE_ID = "nominatim";
const DEFAULT_BASE = "https://nominatim.openstreetmap.org";
export const SEARCH_FETCH_LIMIT = 10;
export const MAX_PENDING = 10;
export const OSM_ATTRIBUTION = "Geocoding data © OpenStreetMap contributors (ODbL), via Nominatim";

export function osmUserAgent() {
  const contact = process.env.OSM_CONTACT || "https://concord-os.org";
  return `Concord-OS/1.0 (${contact})`;
}

export function nominatimBase() {
  return String(process.env.NOMINATIM_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const normQuery = (q) => String(q ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function fetchNominatim(key, { signal }) {
  const base = nominatimBase();
  let url;
  if (key.startsWith("search:")) {
    url = `${base}/search?q=${encodeURIComponent(key.slice(7))}&format=jsonv2&limit=${SEARCH_FETCH_LIMIT}&addressdetails=1`;
  } else if (key.startsWith("reverse:")) {
    const [lat, lon] = key.slice(8).split(",");
    url = `${base}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`;
  } else {
    throw new Error(`nominatim: bad key ${key}`);
  }
  const r = await fetchPublicUrl(url, { headers: { "User-Agent": osmUserAgent(), Accept: "application/json" }, signal });
  if (!r.ok) throw new UpstreamError(`nominatim ${r.status}`, r.status);
  return r.json();
}

const SOURCE_CONFIG = {
  ttlMs: 30 * DAY,
  staleMaxMs: 180 * DAY,
  budget: { perMin: 50, perDay: 5000, minSpacingMs: 1000 },
  timeoutMs: 10_000,
  license: "public",
  maxKeys: 20_000,
  persist: true,
  fetcher: fetchNominatim,
};

/** Register-once; safe to call repeatedly (feed-cache's test reset clears the registry). */
export function ensureGeoFeedSources() {
  if (!hasSource(SOURCE_ID)) registerSource(SOURCE_ID, SOURCE_CONFIG);
}
ensureGeoFeedSources();

let _pending = 0;
export function _resetGeoFeedForTests() { _pending = 0; }

function unavailable(reason, lastOkAt = null) {
  return { ok: false, status: "unavailable", reason, lastOkAt, error: `geocoder unavailable: ${reason}` };
}

/**
 * The public failure shape for a REAL geocoder outage: network failure,
 * timeout, upstream 5xx / rate limit, or the queue-full "geocoder_busy".
 * Lens actions return this verbatim. lens-run-http maps the
 * "geocoder_unavailable" code to HTTP 503 (the one opt-in 503) and the
 * client is taught not to auto-retry it — retryAfterS is a hint for the
 * user ("try again in N s"), not for a retry loop. Input errors (empty
 * query, bad coordinates) never use this shape; they stay invalid_input.
 */
export function geocoderUnavailable(reason, lastOkAt = null) {
  return {
    ok: false,
    status: "unavailable",
    code: "geocoder_unavailable",
    error: "geocoder_unavailable",
    reason,
    lastOkAt,
    retryAfterS: reason === "geocoder_busy" ? 5 : 30,
  };
}

async function via(key) {
  ensureGeoFeedSources();
  const hit = peek(SOURCE_ID, key);
  const fresh = hit && !hit.stale;
  // Fresh hits cost nothing; everything else may wait on the 1 req/s queue.
  if (!fresh && _pending >= MAX_PENDING) return unavailable("geocoder_busy");
  if (!fresh) _pending++;
  try {
    const r = await get(SOURCE_ID, key);
    if (r.status === "unavailable" || r.data == null) {
      return unavailable(String(r.reason || "unavailable"), r.lastOkAt ?? null);
    }
    return { ok: true, data: r.data, fetchedAt: r.fetchedAt, stale: !!r.stale };
  } finally {
    if (!fresh) _pending--;
  }
}

/**
 * Forward geocode a free-text query (user-initiated only: no autocomplete).
 * -> { ok:true, data:[raw jsonv2 places, sliced to `limit`], fetchedAt, stale } | { ok:false, status:"unavailable", reason, lastOkAt, error }
 */
export async function nominatimSearch(query, { limit = 5 } = {}) {
  const q = normQuery(query);
  if (!q) return unavailable("empty_query");
  const r = await via(`search:${q}`);
  if (!r.ok) return r;
  const n = Math.max(1, Math.min(SEARCH_FETCH_LIMIT, Math.floor(Number(limit)) || 5));
  return { ...r, data: (Array.isArray(r.data) ? r.data : []).slice(0, n) };
}

/** Reverse geocode lat/lon (rounded to 5dp, ~1 m, for the cache key). -> raw jsonv2 object in `data`. */
export async function nominatimReverse(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return unavailable("bad_coordinates");
  return via(`reverse:${la.toFixed(5)},${lo.toFixed(5)}`);
}
