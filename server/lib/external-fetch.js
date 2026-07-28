// server/lib/external-fetch.js
//
// Shared helper for lens macros that pull live data from free public
// APIs. Promotes the fetchJsonWithTimeout pattern that was copy-pasted
// across server/domains/*-live.js into one place, and adds a TTL
// response cache so repeated calls within a window don't re-hit the
// upstream API.
//
//   import { cachedFetchJson, registerLiveFeed } from "../lib/external-fetch.js";
//
//   const data = await cachedFetchJson(url, { ttlMs: 600000 });
//
//   registerLiveFeed(register, "weather", "live", async (input) => {
//     return cachedFetchJson(`https://api.open-meteo.com/...`);
//   });

// SECURITY (2026-07-27): every fetch below goes through the SSRF guard.
//
// This module is imported by 38 files and its docstring above says it is for
// "free public APIs" — but it used a bare `fetch(url)`, so any caller that
// passed a URL derived from user input reached whatever that URL named,
// including cloud metadata (169.254.169.254), the loopback Ollama brains, and
// RFC1918. Two such callers were live and REFLECTED (the response body comes
// back to the caller, so it is exfiltration, not just a blind probe):
//
//   • domains/importdomain.js — the `rest_api` and `csv_url` connector kinds
//     fetch `cfg.url`, which is `params.url` straight off the macro input,
//     and return the parsed body to the caller as `rows`.
//   • domains/custom.js#bindingTest — fetches a user-authored REST binding's
//     `target.url` and returns a sample of the response plus its field names.
//
// Guarding HERE rather than at those two call sites is deliberate: it closes
// the class for all 38 importers at once, including any added later, instead
// of leaving the next caller to rediscover the same hole. Checked before
// making it a chokepoint — no importer legitimately fetches a private or
// loopback address, which is consistent with the module's stated purpose.
//
// Callers that need to bypass the guard for tests inject `opts.fetchImpl`,
// exactly as connectorFetch and fetchPublicUrl already allow.
import { fetchPublicUrl } from "./public-fetch.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const _cache = new Map(); // url -> { data, expiresAt }

/**
 * fetchJsonWithTimeout — fetch + parse JSON with an AbortController
 * timeout. Throws on non-2xx or timeout.
 */
export async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // `fetchImpl` is pulled out of opts so it reaches fetchPublicUrl's
    // transport-override channel rather than being passed down as a fetch
    // init field, where it would be silently ignored.
    const { fetchImpl, ...init } = opts || {};
    const r = await fetchPublicUrl(
      url,
      { ...init, signal: ctrl.signal },
      fetchImpl ? { fetchImpl } : {}
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * cachedFetchJson — fetchJsonWithTimeout with a TTL cache keyed by URL.
 * @param {string} url
 * @param {object} [o]
 * @param {number} [o.ttlMs=300000] cache lifetime
 * @param {object} [o.opts] fetch options (cache key still the URL — pass
 *        unique URLs for unique requests)
 * @param {number} [o.timeoutMs]
 */
export async function cachedFetchJson(url, { ttlMs = DEFAULT_TTL_MS, opts = {}, timeoutMs } = {}) {
  const now = Date.now();
  const hit = _cache.get(url);
  if (hit && hit.expiresAt > now) return hit.data;
  const data = await fetchJsonWithTimeout(url, opts, timeoutMs);
  if (_cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(url, { data, expiresAt: now + ttlMs });
  return data;
}

/** Drop all cached responses (used by tests). */
export function clearExternalFetchCache() {
  _cache.clear();
}

/**
 * registerLiveFeed — wrap a fetch function as a live-feed macro that
 * returns the standard shape `{ ok, source, fetchedAt, result }` and
 * degrades gracefully to `{ ok:false, reason:"api_unreachable" }`.
 *
 * @param {Function} register the System-B registrar: register(domain,name,fn,opts)
 * @param {string} domain
 * @param {string} name
 * @param {Function} fetchFn async (input, ctx) => data
 * @param {object} [o]
 * @param {string} [o.note]
 * @param {string} [o.source] label for the data source
 */
export function registerLiveFeed(register, domain, name, fetchFn, { note, source } = {}) {
  register(domain, name, async (ctx, input = {}) => {
    try {
      const data = await fetchFn(input || {}, ctx);
      return {
        ok: true,
        source: source || data?.source || name,
        fetchedAt: Math.floor(Date.now() / 1000),
        result: data,
      };
    } catch (e) {
      return { ok: false, reason: "api_unreachable", error: String(e?.message || e) };
    }
  }, { note: note || `live feed: ${domain}.${name}` });
}
