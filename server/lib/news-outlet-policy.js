// server/lib/news-outlet-policy.js
//
// The ONE host -> content-policy mapping for news. Used by the News lens
// (domains/news.js + lib/news-sources.js), the generic feed-manager
// (lib/feed-manager.js) and emergent/realtime-feeds.js, so an outlet can never
// be "full text" in one path and "summary-only" in another.
//
// Tiers
//   full        headline + a short UNMODIFIED snippet (<= SNIPPET_MAX chars) + link,
//               with attribution. Only outlets whose terms (or US federal
//               public-domain status) allow display on a public site.
//   restricted  DEFAULT for every host not listed in FULL_HOSTS. Store/display ONLY
//               headline (unedited), link, publish date, source name and Concord's
//               OWN short summary (or null until one exists). Never the feed
//               description / article text / excerpts. Never fetch the article page.
//   excluded    never fetched, never registered as enabled, removed from every registry.
//
// Honest-by-construction: nothing here invents text. A missing summary is null.

export const SNIPPET_MAX = 300;
export const SUMMARY_MAX_WORDS = 45;
export const SUMMARY_MIN_WORDS = 4;
export const SUMMARY_OVERLAP_RUN = 8;

/** Outlets cleared for headline + short unmodified snippet + link. Suffix-matched on a domain boundary. */
export const FULL_HOSTS = Object.freeze([
  "sciencedaily.com",
  "nasa.gov",
  // US federal agencies (works of the US government: public domain)
  "nih.gov", "cdc.gov", "noaa.gov", "usgs.gov", "fda.gov", "epa.gov", "nist.gov", "nsf.gov",
  "energy.gov", "usda.gov", "hhs.gov", "federalregister.gov",
  // Hacker News (official open API)
  "news.ycombinator.com", "hacker-news.firebaseio.com", "hnrss.org",
  // arXiv: openly licensed metadata/abstracts (not a news outlet; listed so the research feeds keep their abstracts)
  "arxiv.org",
  // GDELT itself is a metadata index (open); the article outlets it points at are classified by their own host.
  "gdeltproject.org",
]);

/** Never fetched, never enabled. */
export const EXCLUDED_HOSTS = Object.freeze([
  "aljazeera.com", "aljazeera.net",
  "france24.com",
  "abc.net.au",
]);

/** Dead / unlicensed relays removed everywhere (Ramaj D7). Also treated as excluded. */
export const DEAD_HOSTS = Object.freeze([
  "feeds.reuters.com",
  "rsshub.app",
]);

export function hostOf(urlOrHost) {
  const raw = String(urlOrHost || "").trim();
  if (!raw) return "";
  let h = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try { h = new URL(raw).hostname; } catch { return ""; }
  } else {
    h = raw.split(/[/?#]/)[0].replace(/:\d+$/, "");
  }
  return h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function matches(host, list) {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** @returns {"full"|"restricted"|"excluded"} unknown / empty hosts are "restricted". */
export function hostTier(urlOrHost) {
  const host = hostOf(urlOrHost);
  if (!host) return "restricted";
  if (matches(host, EXCLUDED_HOSTS) || matches(host, DEAD_HOSTS)) return "excluded";
  if (matches(host, FULL_HOSTS)) return "full";
  // Federal agencies publish works of the US government (public domain); the repo's feed lists use federal .gov hosts.
  if (host.endsWith(".gov") || host.endsWith(".mil")) return "full";
  return "restricted";
}

export function isExcludedHost(urlOrHost) { return hostTier(urlOrHost) === "excluded"; }

export function contentPolicyFor(tier) { return tier === "full" ? "full" : "summary-only"; }

// ── text helpers ────────────────────────────────────────────────────────────

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

export function decodeEntities(s) {
  return String(s || "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; });
}

/** Plain text of a feed field: tags removed (fixed-point), entities decoded, whitespace collapsed. */
export function plainText(s) {
  let t = String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "");
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, " ");
    if (next === t) break;
    t = next;
  }
  return decodeEntities(t).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/** Short snippet for FULL-tier items: the feed's own words, cut (never reworded) to <= SNIPPET_MAX. */
export function shortSnippet(text, max = SNIPPET_MAX) {
  const t = plainText(text);
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function words(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** Longest run of consecutive (normalized) words shared by a and b. */
export function longestSharedRun(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  let best = 0;
  let prev = new Array(wb.length + 1).fill(0);
  for (let i = 1; i <= wa.length; i++) {
    const cur = new Array(wb.length + 1).fill(0);
    for (let j = 1; j <= wb.length; j++) {
      if (wa[i - 1] === wb[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Validate a model-written Concord summary against the outlet text it was derived from.
 * Rejects (=> store NO summary): empty, too short/long, more than 2 sentences, or any
 * run of SUMMARY_OVERLAP_RUN+ consecutive words shared with the description.
 * @returns {{ok:true, summary:string}|{ok:false, reason:string}}
 */
export function validateConcordSummary(summary, description) {
  const s = String(summary || "").replace(/^["'“”\s]+|["'“”\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!s) return { ok: false, reason: "empty" };
  const n = words(s).length;
  if (n < SUMMARY_MIN_WORDS) return { ok: false, reason: "too_short" };
  if (n > SUMMARY_MAX_WORDS) return { ok: false, reason: "too_long" };
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences > 2) return { ok: false, reason: "too_many_sentences" };
  if (longestSharedRun(s, plainText(description)) >= SUMMARY_OVERLAP_RUN) return { ok: false, reason: "copied_from_source" };
  return { ok: true, summary: s };
}

// ── item shaping ────────────────────────────────────────────────────────────

/**
 * Build the policy-safe record for a feed item. For restricted/excluded tiers the
 * feed description is NOT carried over: only headline, link, date, source name and
 * Concord's own summary (null until one exists).
 * @param {{title:string,url:string,publishedAt?:string|null,source?:string,description?:string,summary?:string|null}} item
 * @param {{tier?:string, attribution?:string}} [o]
 */
export function applyOutletPolicy(item, o = {}) {
  const tier = o.tier || hostTier(item.url);
  const base = {
    title: String(item.title || "").trim(),
    url: String(item.url || ""),
    publishedAt: item.publishedAt || null,
    source: item.source || hostOf(item.url) || "",
    contentPolicy: contentPolicyFor(tier),
    attribution: o.attribution || item.source || hostOf(item.url) || "",
  };
  if (tier === "full") {
    return { ...base, snippet: item.description ? shortSnippet(item.description) : (item.snippet || null), summary: null };
  }
  return { ...base, summary: item.summary || null, ...(item.summary ? { summaryBy: "concord" } : {}) };
}

// ── read-only audit helper for existing DTUs ────────────────────────────────

const TEXT_FIELDS = ["body", "content", "description", "excerpt", "summary", "creti", "cretiHuman", "text", "snippet"];
const ARTICLE_TEXT_MIN = 300;

export function dtuUrls(d) {
  const out = [];
  const push = (u) => { if (typeof u === "string" && u) out.push(u); };
  push(d?.meta?.sourceUrl); push(d?.meta?.externalUrl); push(d?.meta?.url); push(d?.sourceUrl); push(d?.link); push(d?.url);
  push(d?.source?.url); push(d?.meta?.source?.url); push(d?.meta?.link);
  for (const ev of Array.isArray(d?.core?.evidence) ? d.core.evidence : []) push(ev?.value);
  return out;
}

export function dtuTextFields(d) {
  const fields = [];
  for (const f of TEXT_FIELDS) {
    if (typeof d?.[f] === "string") fields.push(d[f]);
    if (typeof d?.meta?.[f] === "string") fields.push(d.meta[f]);
  }
  for (const def of Array.isArray(d?.core?.definitions) ? d.core.definitions : []) {
    if (typeof def === "string") fields.push(def);
  }
  if (typeof d?.human?.summary === "string") fields.push(d.human.summary);
  if (typeof d?.data?.summary === "string") fields.push(d.data.summary);
  if (typeof d?.data?.description === "string") fields.push(d.data.description);
  return fields;
}

/**
 * The per-DTU match behind countRestrictedFullTextDtus, exported so the
 * summary-only migration (lib/restricted-dtu-summarize.js) plans from the
 * exact same rule instead of a forked copy: a source URL whose host tier is
 * not "full", plus article text (> ~300 chars beyond the title) in a text
 * field. Returns { u, tier, host } for the matched URL, or null.
 */
export function restrictedFullTextHit(d) {
  if (!d || typeof d !== "object") return null;
  const urls = dtuUrls(d);
  const hit = urls.map((u) => ({ u, tier: hostTier(u), host: hostOf(u) })).find((x) => x.host && x.tier !== "full");
  if (!hit) return null;
  const title = String(d.title || "").trim();
  const hasText = dtuTextFields(d).some((t) => {
    const v = String(t || "").trim();
    if (!v || v === title) return false;
    const beyond = v.startsWith(title) ? v.length - title.length : v.length;
    return beyond > ARTICLE_TEXT_MIN;
  });
  return hasText ? hit : null;
}

/**
 * READ-ONLY. Counts DTUs whose source/link host is restricted or excluded AND that hold
 * article text (a body/content/description/excerpt longer than ~300 chars beyond the title).
 * Pure: never mutates its input and touches no store. DTUs with no URL at all are not
 * attributable to an outlet and are not counted.
 * @param {Iterable<object>} dtus
 * @returns {{count:number, examined:number, ids:string[], byHost:Record<string,number>}}
 */
export function countRestrictedFullTextDtus(dtus) {
  let examined = 0;
  const ids = [];
  const byHost = {};
  let count = 0;
  for (const d of dtus || []) {
    if (!d || typeof d !== "object") continue;
    examined++;
    const hit = restrictedFullTextHit(d);
    if (!hit) continue;
    count++;
    byHost[hit.host] = (byHost[hit.host] || 0) + 1;
    if (ids.length < 200 && d.id) ids.push(String(d.id));
  }
  return { count, examined, ids, byHost };
}

// ── summary-only shaping (ingest guard + migration) ────────────────────────

/**
 * The one summary-only body shape (same lines feed-manager's restricted
 * commit has always written): headline, Source:, Published:, Concord
 * summary: (only when a validated Concord summary exists), Link:. Nothing
 * from the outlet's body. Pure.
 */
export function restrictedContentText({ title, sourceName, publishedAt, summary, url } = {}) {
  return [
    `${title || ""}`,
    `Source: ${sourceName || ""}`,
    publishedAt ? `Published: ${publishedAt}` : null,
    summary ? `Concord summary: ${summary}` : null,
    url ? `Link: ${url}` : null,
  ].filter(Boolean).join("\n");
}

const BLOCK_TEXT_FIELDS = ["content", "creti", "cretiHuman", "body"];
const SHORT_TEXT_FIELDS = ["description", "excerpt", "text", "snippet"];

/**
 * Strip a DTU (or DTU draft) down to summary-only when its source host is
 * not full-tier. Pure: returns a NEW object; the input is never mutated.
 * Full-tier and URL-less drafts are returned unchanged (same reference).
 *
 * Field mapping (mirrors feed-manager's compliant commit + the research
 * citation rule):
 *   content / creti / cretiHuman / body / description / excerpt / text /
 *   snippet (top level and under meta)  -> the restrictedContentText shape
 *   summary fields (summary, human.summary, data.summary, meta.summary)
 *     -> the validated Concord summary, or "" when there is none
 *   core.definitions -> [summary || title]   (feed-manager's shape)
 *   data.description -> the shape
 *   contentPolicy + meta.contentPolicy -> "summary-only"
 * Everything else (id, title, tags, owner, visibility, source link,
 * attribution objects, meta.sourceName, meta.publishedAt) is preserved.
 *
 * `concordSummary`, when given, is kept only if validateConcordSummary
 * accepts it against the draft's own outlet text — a copied or over-long
 * "summary" is dropped, never stored.
 */
export function enforceSummaryOnly(dtuDraft, { concordSummary = null } = {}) {
  if (!dtuDraft || typeof dtuDraft !== "object") return dtuDraft;
  const url = dtuUrls(dtuDraft).find((u) => hostOf(u)) || "";
  if (!url) return dtuDraft;
  if (hostTier(url) === "full") return dtuDraft;

  const outletText = dtuTextFields(dtuDraft).reduce((a, b) => (String(b).length > String(a).length ? b : a), "");
  let summary = null;
  if (concordSummary) {
    const v = validateConcordSummary(concordSummary, outletText);
    if (v.ok) summary = v.summary;
  }

  const title = String(dtuDraft.title || "");
  const sourceName = dtuDraft.meta?.sourceName
    || (typeof dtuDraft.source === "object" ? dtuDraft.source?.name : null)
    || dtuDraft.meta?.source?.name
    || hostOf(url);
  const publishedAt = dtuDraft.meta?.publishedAt || dtuDraft.meta?.published || null;
  const shape = restrictedContentText({ title, sourceName, publishedAt, summary, url });

  let stripped = false;
  const swapBlock = (obj, f) => { if (typeof obj[f] === "string") { obj[f] = shape; stripped = true; } };
  const out = { ...dtuDraft };
  for (const f of [...BLOCK_TEXT_FIELDS, ...SHORT_TEXT_FIELDS]) swapBlock(out, f);
  if (typeof out.summary === "string" || summary) { out.summary = summary || ""; stripped = true; }
  if (stripped && typeof out.content !== "string") out.content = shape;
  if (stripped && typeof out.creti !== "string" && out.creti === undefined) out.creti = shape;

  if (out.core && typeof out.core === "object" && Array.isArray(out.core.definitions)) {
    out.core = { ...out.core, definitions: [summary || title] };
  }
  if (out.human && typeof out.human === "object") {
    out.human = { ...out.human, summary: summary || "" };
  }
  if (out.data && typeof out.data === "object") {
    const data = { ...out.data };
    if (typeof data.summary === "string" || summary) data.summary = summary || "";
    if (typeof data.description === "string") data.description = shape;
    out.data = data;
  }
  if (out.meta && typeof out.meta === "object") {
    const meta = { ...out.meta };
    for (const f of [...BLOCK_TEXT_FIELDS, ...SHORT_TEXT_FIELDS]) swapBlock(meta, f);
    if (typeof meta.summary === "string" || summary) meta.summary = summary || "";
    meta.contentPolicy = "summary-only";
    out.meta = meta;
  } else {
    out.meta = { contentPolicy: "summary-only" };
  }
  out.contentPolicy = "summary-only";
  return out;
}
