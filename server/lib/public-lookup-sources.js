// server/lib/public-lookup-sources.js
//
// Wikipedia / Wikidata / Commons (source "wikimedia"), StackExchange ("stackexchange") and
// HN Algolia ("hn-algolia") reads routed through lib/feed-cache.js. Browsers used to call
// these hosts directly; now every widget shares one cache entry per request and the server
// is the single, polite client (descriptive User-Agent, per-source budgets, StackExchange
// `backoff` honored).
//
// SECURITY: this is NOT a proxy. Every request is built from a fixed URL template; the
// client supplies only validated scalar parameters (allowlisted lang/site/tags, a Q-id
// regex, length/charset-checked free text). A URL or host is never accepted from a caller.
// Every outbound fetch goes through the SSRF-guarded fetchPublicUrl.
//
// Honesty: failures are never cached as data. Nothing truthful to serve =>
// { ok:false, status:"unavailable", reason, lastOkAt }; stale data is served with
// stale:true + fetchedAt. Nothing is ever invented.
//
// Licensing (metadata only): Wikipedia/Wikidata/Commons text is CC BY-SA 4.0 (Wikidata is
// CC0 but shown with the same credit line), StackExchange content is CC BY-SA with
// attribution. Widgets must show LOOKUP_ATTRIBUTION[...] with its link.
//
// Env: CONCORD_PUBLIC_UA (User-Agent override), STACKEXCHANGE_KEY (optional; appended as
// &key= and raises the daily budget). Neither is ever placed in a cache key or log line.

import { registerSource, hasSource, get, peek, _resetFeedCacheForTests } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WIKI_LANGS = Object.freeze(["en", "de", "fr", "es", "it", "pt", "ja", "zh", "ru", "nl", "pl", "sv", "ar", "hi"]);
// launch_hn is used by the feed components alongside the requested tags.
export const HN_TAGS = Object.freeze(["story", "comment", "ask_hn", "show_hn", "front_page", "launch_hn"]);
// The literal sites the components use (grep api.stackexchange.com in concord-frontend).
export const SE_SITES = Object.freeze([
  "stackoverflow", "superuser", "serverfault", "softwareengineering", "ai", "datascience", "codereview",
  "law", "politics", "workplace", "money", "video", "math", "philosophy",
]);
export const SE_SORTS = Object.freeze(["relevance", "votes", "activity", "creation"]);

export const LOOKUP_ATTRIBUTION = Object.freeze({
  wikipedia: { text: "Wikipedia · CC BY-SA 4.0", href: "https://creativecommons.org/licenses/by-sa/4.0/" },
  wikidata: { text: "Wikidata · CC BY-SA 4.0", href: "https://creativecommons.org/licenses/by-sa/4.0/" },
  commons: { text: "Wikimedia Commons · CC BY-SA 4.0", href: "https://commons.wikimedia.org/wiki/Commons:Licensing" },
  stackexchange: { text: "Stack Exchange · CC BY-SA 4.0", href: "https://stackoverflow.com/legal/terms-of-service/public#licensing" },
});

const DEFAULT_UA = "ConcordOS/1.0 (https://concord-os.org; contact@concord-os.org)";
const userAgent = () => (typeof process.env.CONCORD_PUBLIC_UA === "string" && process.env.CONCORD_PUBLIC_UA.trim()) || DEFAULT_UA;
const seKey = () => (typeof process.env.STACKEXCHANGE_KEY === "string" ? process.env.STACKEXCHANGE_KEY.trim() : "");

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Test-only transport (url, init) => Response-like; null => the SSRF-guarded fetchPublicUrl.
let _transport = null;
export function setPublicLookupTransportForTests(fn) { _transport = typeof fn === "function" ? fn : null; }

async function rawJson(url, signal, label) {
  const init = { headers: { Accept: "application/json", "User-Agent": userAgent() }, signal };
  const r = await fetchPublicUrl(url, init, _transport ? { fetchImpl: _transport } : {});
  if (!r || r.ok !== true) {
    const status = Number(r?.status) || 0;
    throw new UpstreamError(`${label} HTTP ${status || "error"}`, status);
  }
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}

// ── parameter validation (shared by the domain and the key builders) ────────────────

const MAX_LEN = 200;

/** True when a client string is acceptable as free text: bounded, no traversal, scheme or control chars. */
export function safeText(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > MAX_LEN) return false;
  if (s.includes("../") || s.includes("..\\") || s.includes("://")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  return true;
}

const QID_RE = /^Q[0-9]{1,12}$/;

// Keys are JSON arrays so no free-text value can collide with a delimiter.
const keyOf = (...parts) => JSON.stringify(parts);

export function wikiSummaryKey(lang, title) {
  if (!WIKI_LANGS.includes(lang) || !safeText(title)) return null;
  return keyOf("wiki-summary", lang, title.trim());
}
export function wikiSearchKey(lang, q) {
  if (!WIKI_LANGS.includes(lang) || !safeText(q)) return null;
  return keyOf("wiki-search", lang, q.trim());
}
export function wikiOnThisDayKey(kind, month, day) {
  const m = Number(month), d = Number(day);
  if (!["all", "selected", "births", "deaths", "events", "holidays"].includes(kind)) return null;
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return keyOf("wiki-otd", kind, String(m).padStart(2, "0"), String(d).padStart(2, "0"));
}
export function wikidataEntityKey(id) {
  if (typeof id !== "string" || !QID_RE.test(id)) return null;
  return keyOf("wikidata-entity", id);
}
export function wikidataSearchKey(q) {
  if (!safeText(q)) return null;
  return keyOf("wikidata-search", q.trim());
}
export function commonsSearchKey(q) {
  if (!safeText(q)) return null;
  return keyOf("commons-search", q.trim());
}
// StackExchange: q (search), tagged (questions by tag) or neither (the site's question list); never both.
// sort in SE_SORTS (default relevance for q, votes otherwise).
export function seSearchKey(site, { q, tagged, sort } = {}) {
  if (!SE_SITES.includes(site)) return null;
  const hasQ = q !== undefined && q !== null && q !== "";
  const hasT = tagged !== undefined && tagged !== null && tagged !== "";
  if (hasQ && hasT) return null;
  const so = sort === undefined || sort === null || sort === "" ? (hasQ ? "relevance" : "votes") : sort;
  if (!SE_SORTS.includes(so)) return null;
  if (hasQ) return safeText(q) ? keyOf("se-search", site, "q", q.trim(), so) : null;
  if (hasT) return safeText(tagged) && /^[A-Za-z0-9.+#_;-]{1,100}$/.test(tagged.trim()) ? keyOf("se-search", site, "tagged", tagged.trim(), so) : null;
  return keyOf("se-search", site, "list", "", so);
}
// HN Algolia: q optional (empty = the tag's own feed); byDate selects search_by_date.
export function hnSearchKey(q, tags, byDate = false) {
  const query = q === undefined || q === null ? "" : q;
  if (query !== "" && !safeText(query)) return null;
  const t = tags === undefined || tags === null || tags === "" ? "story" : tags;
  if (!HN_TAGS.includes(t)) return null;
  return keyOf("hn-search", String(query).trim(), t, byDate ? "date" : "rank");
}

// ── fetchers: (key, { signal }) -> JSON ─────────────────────────────────────

const enc = encodeURIComponent;

// StackExchange asks callers to stop for `backoff` seconds; the pause is source-wide.
let _seBackoffUntil = 0;
export function seBackoffRemainingMs() { return Math.max(0, _seBackoffUntil - Date.now()); }

async function fetchWikimedia(key, { signal }) {
  const [kind, a, b, c] = JSON.parse(key);
  switch (kind) {
    case "wiki-summary":
      return rawJson(`https://${a}.wikipedia.org/api/rest_v1/page/summary/${enc(b.replace(/ /g, "_"))}`, signal, "wikipedia");
    case "wiki-search":
      return rawJson(`https://${a}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(b)}&srlimit=20&format=json`, signal, "wikipedia");
    case "wiki-otd":
      return rawJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/${a}/${b}/${c}`, signal, "wikipedia");
    case "wikidata-entity":
      return rawJson(`https://www.wikidata.org/wiki/Special:EntityData/${a}.json`, signal, "wikidata");
    case "wikidata-search":
      return rawJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(a)}&format=json&language=en&type=item&limit=20`, signal, "wikidata");
    case "commons-search": {
      const params = new URLSearchParams({
        action: "query", generator: "search", gsrnamespace: "6", gsrsearch: `filetype:bitmap ${a}`, gsrlimit: "20",
        prop: "imageinfo|pageimages", iiprop: "url|size|extmetadata", iiurlwidth: "320", pithumbsize: "320", format: "json",
      });
      return rawJson(`https://commons.wikimedia.org/w/api.php?${params}`, signal, "commons");
    }
    default:
      throw new UpstreamError("wikimedia unknown kind", 0);
  }
}

async function fetchStackExchange(key, { signal }) {
  const [, site, mode, term, sort] = JSON.parse(key);
  const p = new URLSearchParams({ order: "desc", sort, site, pagesize: "25" });
  if (mode === "q") p.set("q", term);
  else if (mode === "tagged") p.set("tagged", term);
  const k = seKey();
  if (k) p.set("key", k);
  const path = mode === "q" ? "search/advanced" : "questions";
  const j = await rawJson(`https://api.stackexchange.com/2.3/${path}?${p}`, signal, "stackexchange");
  if (j && Number(j.backoff) > 0) _seBackoffUntil = Math.max(_seBackoffUntil, Date.now() + Number(j.backoff) * 1000);
  return j;
}

async function fetchHn(key, { signal }) {
  const [, q, tags, order] = JSON.parse(key);
  const ep = order === "date" ? "search_by_date" : "search";
  return rawJson(`https://hn.algolia.com/api/v1/${ep}?${q ? `query=${enc(q)}&` : ""}tags=${enc(tags)}&hitsPerPage=25`, signal, "hn-algolia");
}

// ── registration ────────────────────────────────────────────────────────────

// Independent keys (one query each): a bad query must not open a source-wide breaker.
const PER_KEY = { breaker: false, keyBackoff: true, gateKeyBackoff: true };

function seConfig(keyed) {
  return {
    ttlMs: 6 * HOUR, staleMaxMs: 7 * DAY, timeoutMs: 10_000, license: "public", persist: true, maxKeys: 5000, ...PER_KEY,
    budget: keyed ? { perMin: 10, perDay: 9000 } : { perMin: 10, perDay: 250 },
    fetcher: fetchStackExchange,
  };
}

let _seKeyed = null;

/** Register-once; re-registers stackexchange only when STACKEXCHANGE_KEY appears/disappears. Safe to call repeatedly. */
export function ensurePublicLookupSources() {
  if (!hasSource("wikimedia")) {
    registerSource("wikimedia", {
      ttlMs: DAY, staleMaxMs: 30 * DAY, timeoutMs: 10_000, license: "public", persist: true, maxKeys: 5000, ...PER_KEY,
      budget: { perMin: 60, perDay: 5000 }, fetcher: fetchWikimedia,
    });
  }
  const keyed = !!seKey();
  if (!hasSource("stackexchange") || _seKeyed !== keyed) {
    registerSource("stackexchange", seConfig(keyed));
    _seKeyed = keyed;
  }
  if (!hasSource("hn-algolia")) {
    registerSource("hn-algolia", {
      ttlMs: 15 * MIN, staleMaxMs: DAY, timeoutMs: 10_000, license: "public", persist: true, maxKeys: 5000, ...PER_KEY,
      budget: { perMin: 60, perDay: 5000 }, fetcher: fetchHn,
    });
  }
}
ensurePublicLookupSources();

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
  ensurePublicLookupSources();
  if (!key) return unavailable("invalid_request");
  if (sourceId === "stackexchange" && seBackoffRemainingMs() > 0) {
    // StackExchange told us to back off: serve what we have, never call upstream.
    const hit = peek("stackexchange", key);
    return hit ? { ok: true, data: hit.data, fetchedAt: hit.fetchedAt, stale: true } : unavailable("upstream_backoff");
  }
  return shape(await get(sourceId, key));
}

export const getWikiSummary = (lang, title) => via("wikimedia", wikiSummaryKey(lang, title));
export const getWikiSearch = (lang, q) => via("wikimedia", wikiSearchKey(lang, q));
export const getWikiOnThisDay = (kind, month, day) => via("wikimedia", wikiOnThisDayKey(kind, month, day));
export const getWikidataEntity = (id) => via("wikimedia", wikidataEntityKey(id));
export const getWikidataSearch = (q) => via("wikimedia", wikidataSearchKey(q));
export const getCommonsSearch = (q) => via("wikimedia", commonsSearchKey(q));
export const getSeSearch = (site, o) => via("stackexchange", seSearchKey(site, o));
export const getHnSearch = (q, tags, byDate) => via("hn-algolia", hnSearchKey(q, tags, byDate));

/** Test hook: forget every cached entry, registrations, back-off and transport. */
export function _resetPublicLookupForTests() {
  _resetFeedCacheForTests();
  _seKeyed = null;
  _seBackoffUntil = 0;
  ensurePublicLookupSources();
  setPublicLookupTransportForTests(null);
}
