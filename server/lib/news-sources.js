// server/lib/news-sources.js
//
// Vetted RSS / API news sources for the News lens, run through the shared
// feed-cache ("news-rss" source: one key per feed id). Warm ticks fill the cache;
// users NEVER cause an upstream fetch here (reads are noFetch).
//
// License gate: every feed declares license + termsUrl + attribution and a content
// tier derived from lib/news-outlet-policy.js. Full-display feeds keep headline +
// short UNMODIFIED snippet + link. Everything else is "restricted": the feed
// description is read in memory only (to give the summarizer its input) and is
// NEVER stored; the pool item is headline, link, date, source name and Concord's
// own summary (null until one exists). Article pages are never fetched.
//
// Excluded outlets (Al Jazeera, France 24, ABC AU) and dead relays
// (feeds.reuters.com, rsshub.app) are not in the registry at all.

import { fetchPublicUrl } from "./public-fetch.js";
import { getSharedTextOrThrow } from "./shared-http.js";
import { registerSource, hasSource, pool, peek, configureFeedCache } from "./feed-cache.js";
import { hostTier, applyOutletPolicy, plainText } from "./news-outlet-policy.js";
import { queueForSummary, summaryFor, itemHash } from "./news-summarizer.js";

export const NEWS_RSS_SOURCE_ID = "news-rss";
export const NEWS_RSS_TTL_MS = 10 * 60 * 1000;
const UA = "ConcordOS/1.0 (+https://concord-os.org; news headlines reader)";
const MAX_ITEMS_PER_FEED = 25;
const HN_TOP = 30;

const ALL_NEWS_CATEGORIES = ["top", "world", "business", "tech", "science", "politics", "sports", "health", "entertainment"];

/**
 * license: "public-domain" | "open" | "commercial-display-ok" | "noncommercial-only"
 * enabled:false => registered for the record but never fetched (DW / CBC need an agreement).
 * kind: "rss" (default) | "hn" (Hacker News Firebase API)
 */
export const NEWS_FEED_REGISTRY = Object.freeze([
  // ── full display ────────────────────────────────────────────────────────
  { id: "sciencedaily-science", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml", categories: ["science", "top"], license: "commercial-display-ok", termsUrl: "https://www.sciencedaily.com/terms.htm", attribution: "ScienceDaily" },
  { id: "sciencedaily-health", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/health.xml", categories: ["health"], license: "commercial-display-ok", termsUrl: "https://www.sciencedaily.com/terms.htm", attribution: "ScienceDaily" },
  { id: "sciencedaily-tech", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/technology.xml", categories: ["tech"], license: "commercial-display-ok", termsUrl: "https://www.sciencedaily.com/terms.htm", attribution: "ScienceDaily" },
  { id: "sciencedaily-environment", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/environment.xml", categories: ["science"], license: "commercial-display-ok", termsUrl: "https://www.sciencedaily.com/terms.htm", attribution: "ScienceDaily" },
  { id: "nasa-news", name: "NASA", url: "https://www.nasa.gov/feed/", categories: ["science", "tech"], license: "public-domain", termsUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/", attribution: "NASA" },
  { id: "fda-press", name: "FDA", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", categories: ["health"], license: "public-domain", termsUrl: "https://www.fda.gov/about-fda/about-website/website-policies", attribution: "U.S. Food and Drug Administration" },
  { id: "hacker-news", name: "Hacker News", kind: "hn", url: "https://hacker-news.firebaseio.com/v0/topstories.json", categories: ["tech"], license: "open", termsUrl: "https://github.com/HackerNews/API", attribution: "Hacker News" },

  // ── summary-only (headline + link + date + source + Concord's own summary) ──
  { id: "bbc-top", name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", categories: ["top"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-world", name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", categories: ["world"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-business", name: "BBC News", url: "https://feeds.bbci.co.uk/news/business/rss.xml", categories: ["business"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-tech", name: "BBC News", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", categories: ["tech"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-science", name: "BBC News", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", categories: ["science"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-health", name: "BBC News", url: "https://feeds.bbci.co.uk/news/health/rss.xml", categories: ["health"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-politics", name: "BBC News", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", categories: ["politics"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "bbc-entertainment", name: "BBC News", url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", categories: ["entertainment"], license: "noncommercial-only", termsUrl: "https://www.bbc.co.uk/usingthebbc/terms/", attribution: "BBC News" },
  { id: "npr-top", name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", categories: ["top"], license: "noncommercial-only", termsUrl: "https://www.npr.org/about-npr/179876898/terms-of-use", attribution: "NPR" },
  { id: "npr-world", name: "NPR", url: "https://feeds.npr.org/1004/rss.xml", categories: ["world"], license: "noncommercial-only", termsUrl: "https://www.npr.org/about-npr/179876898/terms-of-use", attribution: "NPR" },
  { id: "npr-business", name: "NPR", url: "https://feeds.npr.org/1006/rss.xml", categories: ["business"], license: "noncommercial-only", termsUrl: "https://www.npr.org/about-npr/179876898/terms-of-use", attribution: "NPR" },
  { id: "npr-politics", name: "NPR", url: "https://feeds.npr.org/1014/rss.xml", categories: ["politics"], license: "noncommercial-only", termsUrl: "https://www.npr.org/about-npr/179876898/terms-of-use", attribution: "NPR" },
  { id: "npr-health", name: "NPR", url: "https://feeds.npr.org/1128/rss.xml", categories: ["health"], license: "noncommercial-only", termsUrl: "https://www.npr.org/about-npr/179876898/terms-of-use", attribution: "NPR" },
  { id: "guardian-world", name: "The Guardian", url: "https://www.theguardian.com/world/rss", categories: ["world", "top"], license: "noncommercial-only", termsUrl: "https://www.theguardian.com/help/terms-of-service", attribution: "The Guardian" },
  { id: "guardian-business", name: "The Guardian", url: "https://www.theguardian.com/uk/business/rss", categories: ["business"], license: "noncommercial-only", termsUrl: "https://www.theguardian.com/help/terms-of-service", attribution: "The Guardian" },
  { id: "guardian-tech", name: "The Guardian", url: "https://www.theguardian.com/technology/rss", categories: ["tech"], license: "noncommercial-only", termsUrl: "https://www.theguardian.com/help/terms-of-service", attribution: "The Guardian" },
  { id: "guardian-science", name: "The Guardian", url: "https://www.theguardian.com/science/rss", categories: ["science"], license: "noncommercial-only", termsUrl: "https://www.theguardian.com/help/terms-of-service", attribution: "The Guardian" },
  { id: "guardian-sport", name: "The Guardian", url: "https://www.theguardian.com/sport/rss", categories: ["sports"], license: "noncommercial-only", termsUrl: "https://www.theguardian.com/help/terms-of-service", attribution: "The Guardian" },
  { id: "arstechnica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", categories: ["tech", "science"], license: "noncommercial-only", termsUrl: "https://www.condenast.com/user-agreement", attribution: "Ars Technica" },
  { id: "theverge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", categories: ["tech", "entertainment"], license: "noncommercial-only", termsUrl: "https://www.voxmedia.com/pages/terms-of-use", attribution: "The Verge" },
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", categories: ["tech", "business"], license: "noncommercial-only", termsUrl: "https://techcrunch.com/terms-of-service/", attribution: "TechCrunch" },

  // ── registered but OFF (an agreement with the publisher is needed first) ──
  { id: "dw-all", name: "DW", url: "https://rss.dw.com/rdf/rss-en-all", categories: ["world", "top"], license: "noncommercial-only", termsUrl: "https://www.dw.com/en/rss/s-9993", attribution: "DW", enabled: false },
  { id: "cbc-top", name: "CBC News", url: "https://www.cbc.ca/webfeed/rss/rss-topstories", categories: ["world", "top"], license: "noncommercial-only", termsUrl: "https://www.cbc.ca/aboutcbc/discover/termsofuse", attribution: "CBC News", enabled: false },
]);

/** Effective tier for a registry entry: derived from the shared host policy, never trusted from the entry. */
export function feedTier(f) { return hostTier(f.kind === "hn" ? "https://news.ycombinator.com/" : f.url); }

/** Enabled = switched on in the registry AND not excluded by the outlet policy. */
export function isFeedEnabled(f) {
  return f.enabled !== false && feedTier(f) !== "excluded";
}

export function enabledNewsFeeds() { return NEWS_FEED_REGISTRY.filter(isFeedEnabled); }

export function feedsForCategory(category) {
  return enabledNewsFeeds().filter((f) => f.categories.includes(category));
}

export function newsFeedById(id) { return NEWS_FEED_REGISTRY.find((f) => f.id === id) || null; }

// ── test seams ──────────────────────────────────────────────────────────────

let _fetchImpl = null;     // (url, init) => Response-like; bypasses the SSRF guard (caller owns egress)
let _robots = null;        // (url) => Promise<boolean>
export function __setNewsSourcesTestHooks({ fetchImpl, robots } = {}) {
  _fetchImpl = typeof fetchImpl === "function" ? fetchImpl : null;
  _robots = typeof robots === "function" ? robots : null;
}

async function robotsAllows(url) {
  if (_robots) return !!(await _robots(url));
  if (process.env.CONCORD_FEED_ROBOTS_CHECK === "0") return true;
  try {
    const { checkRobotsTxt } = await import("../emergent/entity-web-exploration.js");
    return !!(await checkRobotsTxt(url));
  } catch { return true; } // robots infra optional: fail open for public feeds (same as feed-manager)
}

function guardedFetch(url, signal) {
  const opts = _fetchImpl ? { fetchImpl: _fetchImpl } : {};
  return fetchPublicUrl(url, { signal, headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5" } }, opts);
}

// ── item shaping ────────────────────────────────────────────────────────────

export function dedupHashOf(title, url) { return itemHash(title, url); }

/**
 * RSS/Atom text -> policy-safe items. Uses feed-manager's repo parser (strict dates:
 * a missing/unparseable date stays null instead of "now"). Descriptions never leave
 * this function except (a) a <=300 char unmodified snippet for FULL-tier feeds and
 * (b) the in-memory summarizer queue for restricted feeds.
 */
export async function parseNewsFeed(xml, feed) {
  const { parseRSS } = await import("./feed-manager.js");
  const tier = feedTier(feed);
  const parsed = parseRSS(String(xml || ""), { id: feed.id, name: feed.name, url: feed.url }, { strictDates: true });
  if (!parsed.length) throw new Error("no_items_parsed");
  const out = [];
  for (const p of parsed.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = plainText(p.title);
    const url = String(p.sourceUrl || "").trim();
    if (!title || !/^https?:\/\//i.test(url)) continue;
    if (hostTier(url) === "excluded") continue; // an excluded outlet syndicated through an allowed feed
    const hash = dedupHashOf(title, url);
    const itemTier = tier === "full" ? "full" : "restricted";
    // Restricted tier: the description is NOT passed on, so the persisted record can only hold
    // headline/link/date/source. Summaries are attached at read time from the summary store.
    const rec = applyOutletPolicy(
      { title, url, publishedAt: p.publishedAt || null, source: feed.name, description: itemTier === "full" ? (p.content || p.summary) : undefined },
      { tier: itemTier, attribution: feed.attribution },
    );
    delete rec.summary;
    rec.feedId = feed.id;
    rec.dedupHash = hash;
    out.push(rec);
    if (itemTier === "restricted" && !summaryFor(hash)) {
      const desc = plainText(p.content || p.summary);
      if (desc) queueForSummary({ hash, title, description: desc, url, source: feed.name });
    }
  }
  if (!out.length) throw new Error("no_valid_items");
  return out;
}

async function fetchHackerNews(feed, signal) {
  const r = await guardedFetch(feed.url, signal);
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const ids = (await r.json());
  if (!Array.isArray(ids)) throw new Error("hn_bad_response");
  const top = ids.slice(0, HN_TOP);
  const items = [];
  let i = 0;
  const worker = async () => {
    while (i < top.length) {
      const id = top[i++];
      try {
        const ir = await guardedFetch(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`, signal);
        if (!ir.ok) continue;
        const it = await ir.json();
        if (!it || it.deleted || it.dead || it.type !== "story" || !it.title) continue;
        const url = it.url && /^https?:\/\//i.test(it.url) ? it.url : `https://news.ycombinator.com/item?id=${it.id}`;
        const title = plainText(it.title);
        items.push({
          title, url, publishedAt: Number.isFinite(it.time) ? new Date(it.time * 1000).toISOString() : null,
          source: feed.name, contentPolicy: "full", attribution: feed.attribution, snippet: null,
          feedId: feed.id, dedupHash: dedupHashOf(title, url), discussionUrl: `https://news.ycombinator.com/item?id=${it.id}`,
        });
      } catch (e) { if (signal?.aborted) throw e; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (!items.length) throw new Error("hn_no_items");
  return items;
}

async function fetchNewsFeed(feedId, { signal } = {}) {
  const feed = newsFeedById(feedId);
  if (!feed || !isFeedEnabled(feed)) throw new Error("feed_not_enabled");
  if (!(await robotsAllows(feed.url))) throw new Error("robots_disallow");
  if (feed.kind === "hn") return fetchHackerNews(feed, signal);
  let text;
  if (_fetchImpl) {
    const r = await guardedFetch(feed.url, signal);
    if (!r.ok) throw new Error(`${feed.name} ${r.status}`);
    text = await r.text();
  } else {
    // Production path: read through the URL-keyed shared cache, so a feed URL that realtime-feeds
    // or feed-manager also polls (BBC / NPR) is fetched once. Half the pool TTL = reuse window.
    text = (await getSharedTextOrThrow(feed.url, { ttlMs: Math.floor(NEWS_RSS_TTL_MS / 2) })).text;
  }
  return parseNewsFeed(text, feed); // throws on unparseable => honest failure, nothing cached
}

// ── feed-cache wiring ───────────────────────────────────────────────────────

let _perMinOverride = 0;

function register() {
  registerSource(NEWS_RSS_SOURCE_ID, {
    ttlMs: NEWS_RSS_TTL_MS,
    staleMaxMs: 6 * 60 * 60 * 1000,
    timeoutMs: 25_000,
    // ~25 enabled feeds / 10 min TTL, warmed 4 per ~75 s tick: well under 12 requests/min.
    budget: { minSpacingMs: 1500, perMin: _perMinOverride || 12 },
    breaker: false,      // keys are independent hosts: per-key back-off instead of a source-wide breaker
    keyBackoff: true,
    license: "public",
    persist: true,
    poolSize: 6,
    warm: { keys: enabledNewsFeeds().map((f) => f.id), everyTicks: 1, perCall: 4 },
    fetcher: fetchNewsFeed,
  });
}

export function ensureNewsRssSource() {
  if (!hasSource(NEWS_RSS_SOURCE_ID)) register();
  return NEWS_RSS_SOURCE_ID;
}

/** Test hook: clock/sleep forwarding + forced re-registration. */
export function __configureNewsSourcesForTests({ now, sleep, perMin } = {}) {
  _perMinOverride = perMin || 0;
  if (now || sleep) configureFeedCache({ ...(now ? { now } : {}), ...(sleep ? { sleep } : {}) });
  register();
}

/**
 * Pooled RSS/HN items for a category, newest pulls merged, deduped, from cache only
 * (never an upstream call). -> { items, fetchedAt, anyFresh, feeds:[{id,name,status,fetchedAt}] }
 */
export async function getNewsRssPool(category) {
  ensureNewsRssSource();
  const feeds = feedsForCategory(category);
  const items = [];
  const meta = [];
  let newest = null;
  let anyFresh = false;
  for (const f of feeds) {
    const p = await pool(NEWS_RSS_SOURCE_ID, f.id, {
      cursor: 0, limit: 100000, noFetch: true, dedupeKey: (it) => it?.dedupHash || it?.url,
    });
    meta.push({ id: f.id, name: f.name, attribution: f.attribution, license: f.license, status: p.status, fetchedAt: p.fetchedAt ?? null });
    if (!p.items.length) continue;
    if (p.status === "fresh") anyFresh = true;
    if (p.fetchedAt && (!newest || p.fetchedAt > newest)) newest = p.fetchedAt;
    for (const it of p.items) items.push({ ...it, _feedCategory: category });
  }
  return { items, fetchedAt: newest, anyFresh, feeds: meta };
}

/** Raw cached entry of one feed (for ops / tests). */
export function peekNewsFeed(feedId) { return peek(NEWS_RSS_SOURCE_ID, feedId); }
