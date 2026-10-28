// server/lib/auto-source.js
//
// Phase 9a: research.auto-source — when a lens has thin coverage of a topic,
// gather public sources for it, write them as PUBLIC citation DTUs (safe
// payload only: no article text, ever), and draft ONE private summary DTU
// whose every sentence cites a fetched source. The summary goes public only
// when its author presses Publish (research.auto-source-publish).
//
// Copyright discipline (the reason this module exists in this shape):
//   - Citation DTUs are built by research-mode's publicSafe builder: title,
//     canonical URL, host, dates, an excerpt of at most 300 chars — and no
//     excerpt at all for restricted outlets. Fetched page text lives only
//     in this process, feeds the summary, and is never stored.
//   - Restricted outlets (lib/news-outlet-policy.js — the shared registry)
//     are NEVER fetched. A restricted candidate survives on provider
//     metadata only (headline, link, date). Excluded outlets are dropped
//     entirely; per Ramaj's Oct 27 decisions DW and CBC are also excluded
//     here (DW until an agreement exists, CBC off).
//   - The summary is written from fetched text only, sentence by sentence:
//     a sentence without a valid [n] citation is dropped, and if fewer than
//     2 independent sources remain, NOTHING is saved.
//
// Provenance: citation creates run inside runAsFeedIngest({ domain:
// "research", action: "auto-source" }) so dtu.create stamps the server-only
// meta.feedIngest marker (see hasAutoSourceMarker in
// lib/feed-ingest-provenance.js). "auto-source" is not a PUBLIC_FEED_SOURCES
// id and citations are never tagged "feed", so feed machinery ignores them.
//
// Limits (Ramaj, Oct 27): CONCORD_AUTOSOURCE_USER_HOURLY (default 5) runs
// per user per rolling hour, CONCORD_AUTOSOURCE_DAILY_CAP (default 200)
// runs per UTC day, citations capped by CONCORD_RESEARCH_MAX_CITATIONS
// (default 30). The research action additionally gates on
// CONCORD_AUTOSOURCE_ENABLED (default off).

import { fetchPublicUrl } from "./public-fetch.js";
import { buildCitationRecords, writeCitationDtus, normUrl } from "./research-mode.js";
import { runAsFeedIngest, isQuarantined } from "./feed-ingest-provenance.js";
import { hostTier, hostOf } from "./news-outlet-policy.js";
import { getWikiSearch, getWikiSummary, getWikidataSearch, safeText } from "./public-lookup-sources.js";
import { getGdelt, queryKey as gdeltQueryKey } from "./gdelt-source.js";
import { fetchPublicPage } from "../emergent/conscious-web-search.js";

const DEFAULT_UA = "ConcordOS/1.0 (https://concord-os.org; contact@concord-os.org)";
const userAgent = () => (typeof process.env.CONCORD_PUBLIC_UA === "string" && process.env.CONCORD_PUBLIC_UA.trim()) || DEFAULT_UA;
const enc = encodeURIComponent;
const MAX_FETCHED = 6;

// Ramaj's Oct 27 decisions, applied on top of the shared outlet policy:
// DW is off until a distribution agreement exists; CBC is off.
const DECISION_EXCLUDED = Object.freeze(["dw.com", "cbc.ca"]);
// Reference/scholarly hosts the provider chain itself queries; their pages
// may be fetched for summary text even though the news policy's default
// tier for unknown hosts is "restricted".
const FETCHABLE_EXTRA = Object.freeze([
  "wikipedia.org", "wikimedia.org", "wikidata.org",
  "openalex.org", "crossref.org", "arxiv.org",
]);

const hostMatches = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** Excluded for auto-source: shared-policy exclusions + Ramaj's DW/CBC decisions. */
export function isAutoSourceExcluded(url) {
  const host = hostOf(url);
  if (!host) return true;
  if (hostMatches(host, DECISION_EXCLUDED)) return true;
  return hostTier(url) === "excluded";
}

/** May this URL's page be fetched for summary text? (Restricted news hosts: never.) */
export function isFetchable(url) {
  const host = hostOf(url);
  if (!host || isAutoSourceExcluded(url)) return false;
  if (hostTier(url) === "full") return true;
  return hostMatches(host, FETCHABLE_EXTRA);
}

/** eTLD+1 approximation: last two labels, three for common two-part suffixes. */
export function registrableDomain(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const twoPart = new Set(["co.uk", "org.uk", "com.au", "net.au", "org.au", "com.br", "co.jp", "com.cn", "org.cn"]);
  const tail = parts.slice(-2).join(".");
  return twoPart.has(tail) ? parts.slice(-3).join(".") : tail;
}

// ── limits ──────────────────────────────────────────────────────────────────

const _userHour = new Map(); // userId -> number[] (ms timestamps)
const _globalDay = new Map(); // yyyy-mm-dd -> count

/** CONCORD_AUTOSOURCE_ENABLED gate (default off). */
export function autoSourceEnabled() {
  const v = String(process.env.CONCORD_AUTOSOURCE_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Current usage against the caps (per process; resets on restart). userId null => global only. */
export function autoSourceUsage(userId, nowMs = Date.now()) {
  const { perUserHourly, dailyCap } = autoSourceLimits();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const usedToday = _globalDay.get(day) || 0;
  const out = { dailyCap, perUserHourly, usedToday, remainingToday: Math.max(0, dailyCap - usedToday) };
  if (userId) {
    const usedThisHour = (_userHour.get(userId) || []).filter((t) => t > nowMs - 3600_000).length;
    out.usedThisHour = usedThisHour;
    out.remainingThisHour = Math.max(0, perUserHourly - usedThisHour);
  }
  return out;
}

export function autoSourceLimits() {
  return {
    perUserHourly: Number(process.env.CONCORD_AUTOSOURCE_USER_HOURLY) || 5,
    dailyCap: Number(process.env.CONCORD_AUTOSOURCE_DAILY_CAP) || 200,
  };
}

export function checkAutoSourceLimits(userId, nowMs = Date.now()) {
  const { perUserHourly, dailyCap } = autoSourceLimits();
  const hourAgo = nowMs - 3600_000;
  const runs = (_userHour.get(userId) || []).filter((t) => t > hourAgo);
  _userHour.set(userId, runs);
  if (runs.length >= perUserHourly) return { ok: false, status: 429, error: "rate_limited", reason: "user_hourly_limit" };
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if ((_globalDay.get(day) || 0) >= dailyCap) return { ok: false, status: 429, error: "rate_limited", reason: "global_daily_cap" };
  return { ok: true };
}

export function recordAutoSourceRun(userId, nowMs = Date.now()) {
  const runs = _userHour.get(userId) || [];
  runs.push(nowMs);
  _userHour.set(userId, runs);
  const day = new Date(nowMs).toISOString().slice(0, 10);
  _globalDay.set(day, (_globalDay.get(day) || 0) + 1);
}

export function _resetAutoSourceForTests() { _userHour.clear(); _globalDay.clear(); }

// ── providers ───────────────────────────────────────────────────────────────

async function jsonGet(url) {
  const r = await fetchPublicUrl(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r || r.ok !== true) return null;
  return typeof r.json === "function" ? r.json() : JSON.parse(await r.text());
}

async function textGet(url) {
  const r = await fetchPublicUrl(url, {
    headers: { Accept: "application/atom+xml, application/xml, text/xml", "User-Agent": userAgent() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r || r.ok !== true) return null;
  return typeof r.text === "function" ? r.text() : null;
}

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function openAlexAbstract(w) {
  const idx = w?.abstract_inverted_index;
  if (!idx || typeof idx !== "object") return "";
  const positions = [];
  for (const [word, idxs] of Object.entries(idx)) for (const i of idxs) positions[i] = word;
  return positions.filter(Boolean).join(" ").slice(0, 4000);
}

const PROVIDERS = [
  {
    name: "wikipedia",
    async fetch(topic) {
      const s = await getWikiSearch("en", topic);
      const hits = s?.ok ? (s.data?.query?.search || []) : [];
      const out = hits.slice(0, 5).map((h) => ({
        title: String(h.title || "").slice(0, 200),
        url: `https://en.wikipedia.org/wiki/${enc(String(h.title || "").replace(/ /g, "_"))}`,
        excerpt: stripTags(h.snippet || ""),
        license: "CC BY-SA 4.0, via Wikipedia",
        provider: "wikipedia",
      }));
      if (out.length) {
        const sum = await getWikiSummary("en", hits[0].title);
        if (sum?.ok && sum.data?.extract) out[0].text = String(sum.data.extract).slice(0, 4000);
      }
      return out;
    },
  },
  {
    name: "wikidata",
    async fetch(topic) {
      const s = await getWikidataSearch(topic);
      const hits = s?.ok ? (s.data?.search || []) : [];
      return hits.slice(0, 3).map((h) => ({
        title: String(h.label || h.id || "").slice(0, 200),
        url: h.concepturi || `https://www.wikidata.org/wiki/${h.id}`,
        excerpt: String(h.description || "").slice(0, 300),
        license: "CC BY-SA 4.0, via Wikidata",
        provider: "wikidata",
      }));
    },
  },
  {
    name: "openalex",
    async fetch(topic) {
      const mailto = process.env.OPENALEX_MAILTO || "hello@concord-os.org";
      const j = await jsonGet(`https://api.openalex.org/works?search=${enc(topic)}&per-page=5&mailto=${enc(mailto)}`);
      return (j?.results || []).map((w) => ({
        title: String(w.display_name || w.title || "").slice(0, 200),
        url: w.primary_location?.landing_page_url || w.doi || w.id,
        published: w.publication_date || (w.publication_year ? String(w.publication_year) : undefined),
        outlet: w.primary_location?.source?.display_name || undefined,
        text: openAlexAbstract(w),
        provider: "openalex",
      }));
    },
  },
  {
    name: "crossref",
    async fetch(topic) {
      const j = await jsonGet(`https://api.crossref.org/works?query=${enc(topic)}&rows=5&sort=relevance`);
      return (j?.message?.items || []).map((w) => {
        const dp = w["published-print"]?.["date-parts"]?.[0] || w["published-online"]?.["date-parts"]?.[0] || w.created?.["date-parts"]?.[0];
        return {
          title: String((w.title || [])[0] || "").slice(0, 200),
          url: w.URL,
          published: Array.isArray(dp) ? dp.join("-") : undefined,
          outlet: (w["container-title"] || [])[0] || undefined,
          text: stripTags(w.abstract || "").slice(0, 4000),
          provider: "crossref",
        };
      });
    },
  },
  {
    name: "arxiv",
    async fetch(topic) {
      const xml = await textGet(`https://export.arxiv.org/api/query?search_query=all:${enc(topic)}&start=0&max_results=5&sortBy=relevance`);
      if (!xml) return [];
      const out = [];
      for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const block = m[1];
        const pick = (tag) => {
          const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
          return mm ? stripTags(mm[1]) : "";
        };
        const id = pick("id");
        if (!id) continue;
        out.push({
          title: pick("title").slice(0, 200),
          url: id,
          published: pick("published").slice(0, 10) || undefined,
          outlet: "arXiv",
          text: pick("summary").slice(0, 4000),
          provider: "arxiv",
        });
      }
      return out;
    },
  },
  {
    name: "gdelt",
    async fetch(topic) {
      const r = await getGdelt(gdeltQueryKey(topic, 10));
      return (r?.articles || []).map((a) => ({
        title: String(a.title || "").slice(0, 200),
        url: a.url,
        published: a.seendate || a.datetime || undefined,
        outlet: a.domain || undefined,
        provider: "gdelt",
      }));
    },
  },
  {
    name: "datagov",
    async fetch(topic) {
      const j = await jsonGet(`https://catalog.data.gov/api/3/action/package_search?q=${enc(topic)}&rows=5`);
      return (j?.result?.results || []).map((d) => ({
        title: String(d.title || "").slice(0, 200),
        url: `https://catalog.data.gov/dataset/${d.name}`,
        outlet: "data.gov",
        text: String(d.notes || "").slice(0, 4000),
        provider: "datagov",
      }));
    },
  },
];

// ── summary drafting ────────────────────────────────────────────────────────

export function buildSummaryPrompt(topic, sources) {
  const material = sources.map((s) => `[${s.n}] ${s.title} (${s.url})\n${String(s.text || "").slice(0, 2500)}`).join("\n\n");
  return [
    `Write a short factual summary of "${topic}" using ONLY the numbered sources below.`,
    "Rules: every sentence must end with at least one citation like [1] or [2] naming the source it came from.",
    "Do not use any fact that is not in the sources. Do not add an introduction or conclusion that makes new claims.",
    "Plain sentences only, no headings, no bullet lists.",
    "",
    material,
  ].join("\n");
}

/** Keep only sentences carrying a valid [n]; strip invalid citation markers. Returns { text, cited:Set<number> }. */
export function citedSentences(raw, sourceCount) {
  const sentences = String(raw || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = [];
  const cited = new Set();
  for (const s of sentences) {
    const valid = [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= sourceCount);
    if (!valid.length) continue;
    for (const n of valid) cited.add(n);
    kept.push(s.replace(/\[(\d+)\]/g, (whole, n) => (Number(n) >= 1 && Number(n) <= sourceCount ? whole : "")).replace(/\s+/g, " ").trim());
  }
  return { text: kept.join(" "), cited };
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * Run one auto-source pass. deps (all injectable for tests):
 *   searchDtus(q) -> Promise<DTU[]>          coverage + citation dedupe
 *   runMacro(domain, action, input)          dtu.create
 *   summarize({ topic, sources }) -> string  the brain call
 *   fetchPage(url) -> { text, title } | null page fetcher (default fetchPublicPage)
 *   providers -> [{ name, fetch(topic) }]     default chain above
 *   now() -> ms                              clock for the limiter
 */
export async function autoSource({ topic, lensDomain = null, userId = "anon" } = {}, deps = {}) {
  const t = String(topic || "").trim();
  if (!safeText(t) || t.length < 2) return { ok: false, status: 400, error: "invalid_topic" };
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const limit = checkAutoSourceLimits(userId, now());
  if (!limit.ok) return limit;
  recordAutoSourceRun(userId, now());

  const providers = Array.isArray(deps.providers) ? deps.providers : PROVIDERS;
  const fetchPage = typeof deps.fetchPage === "function" ? deps.fetchPage : fetchPublicPage;
  const runMacro = deps.runMacro;
  if (typeof runMacro !== "function") return { ok: false, status: 500, error: "macro_unavailable" };
  if (typeof deps.summarize !== "function") return { ok: false, status: 503, error: "llm_unavailable", reason: "llm_unavailable" };

  // 1. Coverage: an existing auto-source summary, or a solid citation base,
  //    means the topic is already sourced.
  let hits = [];
  if (typeof deps.searchDtus === "function") {
    try { hits = (await deps.searchDtus(t)) || []; } catch { hits = []; }
  }
  const existingByUrl = new Map();
  let citationHits = 0;
  for (const h of hits) {
    if (h?.meta?.kind === "citation" && h.meta.url) { existingByUrl.set(normUrl(h.meta.url) || h.meta.url, h.id); citationHits++; }
  }
  if (hits.some((h) => h?.meta?.kind === "auto-source") || citationHits >= 3) {
    return { ok: true, covered: true, existing: hits.length };
  }

  // 2. Provider chain, in order. Excluded hosts are dropped on sight.
  const providersUsed = [];
  const seen = new Map();
  for (const p of providers) {
    let list = [];
    try { list = (await p.fetch(t)) || []; } catch { list = []; }
    if (list.length) providersUsed.push(p.name);
    for (const c of list) {
      const url = normUrl(c?.url);
      if (!url || seen.has(url) || isAutoSourceExcluded(url)) continue;
      seen.set(url, { ...c, url, title: String(c.title || url).slice(0, 200), host: hostOf(url) });
    }
  }
  const maxCitations = Number(process.env.CONCORD_RESEARCH_MAX_CITATIONS) || 30;
  const candidates = [...seen.values()].slice(0, maxCitations);
  if (!candidates.length) return { ok: false, reason: "insufficient_sources", providersUsed };

  // 3. Fetch text for fetchable candidates (at most MAX_FETCHED). Restricted
  //    hosts are never fetched; they stay metadata-only leads.
  const fetched = [];
  for (const c of candidates) {
    if (c.text) { c.kind = "page"; fetched.push(c); continue; }
    if (fetched.length < MAX_FETCHED && isFetchable(c.url)) {
      let page = null;
      try { page = await fetchPage(c.url); } catch { page = null; }
      if (page?.text) {
        c.text = String(page.text).slice(0, 4000);
        if (page.title) c.title = String(page.title).slice(0, 200);
        c.kind = "page";
        fetched.push(c);
        continue;
      }
    }
    c.kind = "lead";
    if (!c.excerpt && c.text) c.excerpt = c.text;
  }
  if (!fetched.length) return { ok: false, reason: "insufficient_sources", providersUsed };

  // 4. Summary from fetched text only; uncited sentences are dropped; fewer
  //    than 2 independent sources cited => save nothing.
  const numbered = fetched.map((c, i) => ({ ...c, n: i + 1 }));
  let raw = "";
  try { raw = await deps.summarize({ topic: t, sources: numbered }); } catch { raw = ""; }
  const { text: summaryText, cited } = citedSentences(raw, numbered.length);
  const citedSources = [...cited].map((n) => numbered[n - 1]).filter(Boolean);
  const domains = new Set(citedSources.map((c) => registrableDomain(c.host)));
  if (!summaryText || citedSources.length === 0 || domains.size < 2) {
    return { ok: false, reason: "insufficient_sources", providersUsed };
  }

  // 5. Public citation DTUs (publicSafe payloads), written inside the ingest
  //    scope so the server stamps the auto-source marker. Deduped by
  //    canonical URL against citations that already exist.
  for (const c of candidates) {
    if (!c.excerpt) c.excerpt = String(c.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  const fresh = candidates.filter((c) => !existingByUrl.has(c.url));
  const records = buildCitationRecords(fresh, {
    publicSafe: true,
    tag: "auto-source",
    isRestrictedHost: (url) => !isFetchable(url),
  });
  const saved = await runAsFeedIngest({ domain: "research", action: "auto-source" }, () =>
    writeCitationDtus(records, (d, a, input) => runMacro(d, a, input), { visibility: "public", source: "auto-source" }));
  const idByUrl = new Map(existingByUrl);
  for (const s of saved) idByUrl.set(s.url, s.id);
  const citationIds = [];
  for (const c of citedSources) {
    const id = idByUrl.get(c.url);
    if (!id) return { ok: false, reason: "citation_write_failed", providersUsed };
    citationIds.push(id);
  }
  const allCitationIds = candidates.map((c) => idByUrl.get(c.url)).filter(Boolean);

  // 6. ONE private summary DTU, outside the ingest scope. meta.sources holds
  //    the cited URLs (>= 2), which is what the grounding check counts.
  const citedUrls = citedSources.map((c) => c.url);
  const body = `${summaryText}\n\nSources:\n${citedSources.map((c, i) => `${i + 1}. ${c.title} — ${c.url}`).join("\n")}`;
  const r = await runMacro("dtu", "create", {
    title: `Auto-source summary: ${t}`.slice(0, 200),
    human: { summary: summaryText.slice(0, 600), bullets: citedUrls },
    content: body,
    creti: body,
    tags: ["auto-source", "research-summary", ...(lensDomain ? [String(lensDomain).slice(0, 60)] : [])],
    tier: "regular",
    source: "auto-source",
    visibility: "private",
    meta: {
      kind: "auto-source", topic: t, lensDomain: lensDomain || null, userId,
      sources: citedUrls, citationIds: allCitationIds, providersUsed,
      generatedAt: new Date().toISOString(),
    },
  });
  const summaryId = r?.id || r?.dtu?.id;
  if (!r?.ok || !summaryId) return { ok: false, reason: "summary_write_failed", providersUsed };
  return { ok: true, covered: false, summaryId, citationIds: allCitationIds, sources: citedUrls, providersUsed };
}

// ── publish ─────────────────────────────────────────────────────────────────

// Only the server-set owner counts. meta.* (and authorId) can come from the
// client's create payload, so they must never decide who may publish.
function dtuOwnerId(d) {
  return d?.ownerId || d?.owner_user_id || null;
}

/** Flip a DTU's stored visibility (STATE row + dtus table, best-effort on both). */
export function defaultSetVisibility(id, visibility) {
  let flipped = false;
  try {
    const STATE = globalThis._concordSTATE;
    const d = STATE?.dtus?.get?.(id);
    if (d) { d.visibility = visibility; flipped = true; }
    const db = globalThis._concordDB || STATE?.db;
    if (db?.prepare) db.prepare("UPDATE dtus SET visibility = ? WHERE id = ?").run(visibility, id);
  } catch { /* best-effort: report what the STATE flip did */ }
  return flipped;
}

/**
 * Publish an auto-source summary: author-only (Ramaj's decision), and every
 * cited DTU must still exist. deps: { getDtu(id), setVisibility(id, vis) }.
 */
export async function publishAutoSourceSummary({ summaryId, userId } = {}, deps = {}) {
  const getDtu = deps.getDtu;
  if (typeof getDtu !== "function") return { ok: false, status: 500, error: "store_unavailable" };
  const setVisibility = typeof deps.setVisibility === "function" ? deps.setVisibility : defaultSetVisibility;
  const summary = await getDtu(summaryId);
  if (!summary) return { ok: false, status: 404, error: "summary_not_found" };
  if (summary.meta?.kind !== "auto-source") return { ok: false, status: 400, error: "not_auto_source" };
  const owner = dtuOwnerId(summary);
  if (!owner || !userId || owner !== userId) return { ok: false, status: 403, error: "not_author" };
  if (summary.visibility === "public") return { ok: true, summaryId, alreadyPublished: true };
  if (isQuarantined(summary)) return { ok: false, status: 403, error: "quarantined" };
  const ids = Array.isArray(summary.meta?.citationIds) ? summary.meta.citationIds : [];
  const missing = [];
  for (const id of ids) {
    let d = null;
    try { d = await getDtu(id); } catch { d = null; }
    if (!d) missing.push(id);
  }
  if (missing.length) return { ok: false, status: 409, error: "citation_missing", missing };
  const flipped = await setVisibility(summaryId, "public");
  if (!flipped) return { ok: false, status: 500, error: "publish_failed" };
  return { ok: true, summaryId, visibility: "public" };
}

export { hasAutoSourceMarker } from "./feed-ingest-provenance.js";
