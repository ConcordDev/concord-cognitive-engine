// @env-config-ok: feed source URLs — registry data
import logger from '../logger.js';
import { hostTier } from '../lib/news-outlet-policy.js';
import { summaryForItem, queueItemForSummary } from '../lib/news-summarizer.js';
import { registerSource, hasSource, get as fcGet, peek as fcPeek, stats as fcStats } from '../lib/feed-cache.js';
import { getSharedText, yahooChartUrl, COINGECKO_TOP10_URL, NPR_TOP_URL, BBC_TOP_URL, WHO_DON_URL, WHO_DON_ITEM_BASE } from '../lib/shared-http.js';
// server/emergent/realtime-feeds.js
// Centralized real-time data fetching service — runs on heartbeat ticks,
// pushes data via WebSocket (realtimeEmit).
// All external API calls use free/public endpoints with graceful fallback.
//
// Event-to-DTU Bridge Integration:
// Each feed tick now also fires individual items through bridgeEvent()
// to convert live feed data into scoped, CRETI-scored DTUs in the substrate.
// Feed data streams to the frontend AND persists as knowledge simultaneously.
//
// Caching: every payload lives in the shared feed-cache (source "realtime-feeds", key = the
// socket event name, persisted across restarts). The tick builds a payload only when its entry
// is past the feed's TTL; all raw upstream HTTP goes through lib/shared-http.js (SSRF-guarded,
// budgeted, per-URL back-off, shared with feed-manager and the news RSS pool), so one upstream
// URL is fetched once however many systems want it. The REST snapshot
// (GET /api/realtime/feed/:feed) returns the SAME payload the socket event carries.

const FEED_ERRORS = new Map();

// Event-to-DTU bridge callback — set by tickRealTimeFeeds when bridge is available.
// Each tick function checks this and fires individual feed items through the bridge.
// Null when bridge is not wired (graceful fallback — feeds still work without bridge).
let _bridgeEvent = null;
let _STATE = null;
let _tickEnabledForTests = false;

/** TEST-ONLY: let tickRealTimeFeeds run under NODE_ENV=test (tests inject the transport via shared-http). */
export function __enableRealtimeTickForTests(on = true) { _tickEnabledForTests = !!on; }
/** TEST-ONLY: clear module state (recorded errors, registered RSS definitions). */
export function __resetRealtimeFeedsForTests() { FEED_ERRORS.clear(); _rssDefs.clear(); _bridgeEvent = null; _STATE = null; }

// ── feed table ──────────────────────────────────────────────────────────────
//   ttlMs:      how long a built payload is reused.
//   everyTicks: tickRealTimeFeeds runs every REALTIME_DATA (5th) governor tick (15s each) and each
//               feed fires when tickCount % everyTicks === 0.
//   maxAgeMs:   past this the REST snapshot answers "unavailable" instead of very old data.
export const REALTIME_SOURCE_ID = "realtime-feeds";
export const GOVERNOR_TICK_MS = 15_000;
const HOUR = 3_600_000;
export const REALTIME_FEEDS = Object.freeze({
  "finance:ticker":       { feed: "finance",       ttlMs: 60_000,  everyTicks: 5,   maxAgeMs: HOUR / 2 },
  "crypto:ticker":        { feed: "crypto",        ttlMs: 60_000,  everyTicks: 5,   maxAgeMs: HOUR / 2 },
  "news:update":          { feed: "news",          ttlMs: 120_000, everyTicks: 10,  maxAgeMs: 3 * HOUR },
  "weather:update":       { feed: "weather",       ttlMs: 300_000, everyTicks: 20,  maxAgeMs: 3 * HOUR },
  "research:update":      { feed: "research",      ttlMs: 600_000, everyTicks: 100, maxAgeMs: 24 * HOUR },
  "economy:update":       { feed: "economy",       ttlMs: 600_000, everyTicks: 200, maxAgeMs: 24 * HOUR },
  "health:update":        { feed: "health",        ttlMs: 600_000, everyTicks: 100, maxAgeMs: 24 * HOUR },
  "legal:update":         { feed: "legal",         ttlMs: 600_000, everyTicks: 40,  maxAgeMs: 24 * HOUR },
  "government:update":    { feed: "government",    ttlMs: 600_000, everyTicks: 40,  maxAgeMs: 24 * HOUR },
  "realestate:update":    { feed: "realestate",    ttlMs: 600_000, everyTicks: 60,  maxAgeMs: 24 * HOUR },
  "aviation:update":      { feed: "aviation",      ttlMs: 600_000, everyTicks: 60,  maxAgeMs: 24 * HOUR },
  "insurance:update":     { feed: "insurance",     ttlMs: 600_000, everyTicks: 80,  maxAgeMs: 24 * HOUR },
  "manufacturing:update": { feed: "manufacturing", ttlMs: 600_000, everyTicks: 80,  maxAgeMs: 24 * HOUR },
  "logistics:update":     { feed: "logistics",     ttlMs: 600_000, everyTicks: 80,  maxAgeMs: 24 * HOUR },
  "retail:update":        { feed: "retail",        ttlMs: 600_000, everyTicks: 60,  maxAgeMs: 24 * HOUR },
  "fitness:update":       { feed: "fitness",       ttlMs: 600_000, everyTicks: 80,  maxAgeMs: 24 * HOUR },
  "agriculture:update":   { feed: "agriculture",   ttlMs: 600_000, everyTicks: 60,  maxAgeMs: 24 * HOUR },
  "education:update":     { feed: "education",     ttlMs: 600_000, everyTicks: 80,  maxAgeMs: 24 * HOUR },
});
// energy:update is emitted (a note only, no numbers: it needs an EIA key) but never cached,
// so the REST snapshot honestly says "unavailable".
const ENERGY_EVENT = "energy:update";

/** "finance" | "finance:ticker" -> "finance:ticker" (null when unknown). */
export function resolveFeedKey(feed) {
  const f = String(feed || "");
  if (Object.hasOwn(REALTIME_FEEDS, f)) return f;
  if (Object.hasOwn(REALTIME_FEEDS, `${f}:ticker`)) return `${f}:ticker`;
  if (Object.hasOwn(REALTIME_FEEDS, `${f}:update`)) return `${f}:update`;
  if (f === "energy" || f === ENERGY_EVENT) return ENERGY_EVENT;
  return null;
}

/** A snapshot older than 2 missed cadences is flagged stale. */
function staleAfterMs(cfg) { return 2 * cfg.everyTicks * GOVERNOR_TICK_MS; }

const _rssDefs = new Map(); // event name -> { domain, feeds, bridgeType, opts } (registered by _tickRssDomain)

export function ensureRealtimeSource() {
  if (hasSource(REALTIME_SOURCE_ID)) return REALTIME_SOURCE_ID;
  registerSource(REALTIME_SOURCE_ID, {
    ttlMs: 600_000,
    staleMaxMs: 24 * HOUR,       // survives a restart (persisted); the REST snapshot enforces each feed's own maxAgeMs
    timeoutMs: 90_000,
    breaker: false,              // independent upstreams: one dead feed must not stop the rest
    keyBackoff: true,
    gateKeyBackoff: true,
    persist: true,
    maxKeys: 60,
    license: "public",
    fetcher: buildFeed,
  });
  return REALTIME_SOURCE_ID;
}

async function buildFeed(key) {
  let payload;
  if (key === "finance:ticker") payload = await buildFinance();
  else if (key === "crypto:ticker") payload = await buildCrypto();
  else if (key === "news:update") payload = await buildNews();
  else if (key === "weather:update") payload = await buildWeather();
  else if (key === "research:update") payload = await buildResearch();
  else if (key === "economy:update") payload = await buildEconomy();
  else if (key === "health:update") payload = await buildHealth();
  else if (_rssDefs.has(key)) payload = await buildRssDomain(_rssDefs.get(key));
  else throw new Error(`unknown_realtime_feed:${key}`);
  // Bridge only on a REAL build (a cache hit or a persisted restore never re-bridges).
  try { bridgePayload(key, payload); } catch (e) { logger.debug?.("emergent:realtime-feeds", "bridge_failed", { key, error: e?.message }); }
  return payload;
}

/** Fresh payload for `key` (cache hit or one coalesced build); null + recorded error when unavailable. */
async function rtFetch(key, { force = false } = {}) {
  ensureRealtimeSource();
  const cfg = REALTIME_FEEDS[key];
  const r = await fcGet(REALTIME_SOURCE_ID, key, { ttlMs: cfg.ttlMs, allowStale: false, force });
  if (r.status === "unavailable") {
    if (r.reason !== "key_backoff") recordError(cfg.feed, new Error(r.reason || "unavailable"));
    return null;
  }
  return r.data;
}

/** Shared-http read; returns the text or throws (a failed build is an honest failure, never cached). */
async function sharedText(url, ttlMs) {
  const r = await getSharedText(url, { ttlMs });
  if (r.status === "unavailable") throw new Error(`${r.reason || "unavailable"}: ${url}`);
  return r.text;
}

/**
 * Outlet policy (lib/news-outlet-policy.js) for an RSS item's description text.
 * Full-display outlets keep the (already stripped/truncated) description. Every other
 * outlet gets Concord's own summary or "" — the outlet's text is used only as in-memory
 * input to the summary queue and is never emitted, bridged or stored.
 */
function policySummary(feed, title, link, strippedDescription) {
  if (hostTier(feed.url) === 'full') return strippedDescription;
  try {
    const have = summaryForItem(title, link);
    if (have) return have;
    if (strippedDescription) queueItemForSummary({ title, url: link, description: strippedDescription, source: feed.name });
  } catch { /* summaries are optional */ }
  return '';
}

function recordError(feed, error) {
  const errors = FEED_ERRORS.get(feed) || [];
  errors.push({ ts: Date.now(), error: String(error?.message || error) });
  if (errors.length > 10) errors.shift();
  FEED_ERRORS.set(feed, errors);
}

// ── Bridge: feed items -> scoped event DTUs (fired once per real build) ──

function fire(evt) {
  _bridgeEvent(evt).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
}

function bridgePayload(key, payload) {
  if (!_bridgeEvent || !payload) return;
  if (key === "finance:ticker") {
    for (const q of payload.quotes) {
      fire({
        type: "market:trade",
        data: { title: `${q.symbol} ${q.changePercent > 0 ? "+" : ""}${q.changePercent}%`, symbol: q.symbol, price: q.price, change: q.change, changePercent: q.changePercent, status: payload.marketStatus },
        source: "yahoo_finance",
        timestamp: payload.fetchedAt,
      });
    }
  } else if (key === "crypto:ticker") {
    for (const c of payload.coins) {
      fire({
        type: "market:crypto",
        data: { title: `${c.id} $${c.price}`, coin: c.id, price: c.price, change24h: c.change24h, marketCap: c.marketCap },
        source: "coingecko",
        timestamp: payload.fetchedAt,
      });
    }
  } else if (key === "news:update") {
    // RSS articles are 'reported' — the source said it happened, Concord didn't witness it
    for (const article of payload.articles) {
      fire({
        type: "news:politics", // generic news — classifier will determine actual domain
        data: {
          title: article.title,
          source: article.source,
          link: article.link,
          pubDate: article.pubDate,
          imageUrl: article.imageUrl,
          summary: article.summary,
        },
        source: article.source?.toLowerCase().replace(/\s/g, "_") || "rss",
        timestamp: article.pubDate ? new Date(article.pubDate).toISOString() : payload.fetchedAt,
      });
    }
  } else if (key === "weather:update") {
    const { lat, lon } = payload.location;
    fire({
      type: "weather:forecast",
      data: { title: `Weather ${lat},${lon}: ${payload.current?.temperature_2m}°`, current: payload.current, location: { lat, lon } },
      source: "open_meteo",
      timestamp: payload.fetchedAt,
    });
  } else if (key === "research:update") {
    for (const paper of payload.papers) {
      fire({
        type: "research:paper",
        data: { title: paper.title, summary: paper.summary, category: paper.category, arxivId: paper.id, published: paper.published },
        source: "arxiv",
        timestamp: paper.published || payload.fetchedAt,
      });
    }
  } else if (key === "economy:update") {
    for (const ind of payload.indicators) {
      fire({
        type: "news:economics",
        data: { title: `${ind.indicator}: ${ind.values?.[0]?.value || "N/A"} (${ind.values?.[0]?.year || "?"})`, indicator: ind.indicator, code: ind.code, values: ind.values },
        source: "world_bank",
        timestamp: payload.fetchedAt,
      });
    }
  } else if (key === "health:update") {
    for (const alert of payload.alerts) {
      fire({
        type: "health:alert",
        data: { title: alert.title, link: alert.link, pubDate: alert.pubDate },
        source: "who",
        timestamp: alert.pubDate ? new Date(alert.pubDate).toISOString() : payload.fetchedAt,
      });
    }
  } else if (_rssDefs.has(key)) {
    const { bridgeType } = _rssDefs.get(key);
    for (const a of payload.articles) {
      fire({
        type: bridgeType,
        data: { title: a.title, source: a.source, link: a.link, pubDate: a.pubDate, summary: a.summary },
        source: a.source?.toLowerCase().replace(/\s/g, "_") || "rss",
        timestamp: a.pubDate ? (new Date(a.pubDate).toISOString() || payload.fetchedAt) : payload.fetchedAt,
      });
    }
  }
}

// ── Financial Data (Yahoo Finance chart endpoint) ──

async function buildFinance() {
  const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"];
  const quotes = [];
  for (const sym of symbols) {
    try {
      const text = await sharedText(yahooChartUrl(sym), REALTIME_FEEDS["finance:ticker"].ttlMs);
      const json = JSON.parse(text);
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta) {
        quotes.push({
          symbol: sym,
          price: meta.regularMarketPrice,
          previousClose: meta.previousClose,
          change: meta.regularMarketPrice - meta.previousClose,
          changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
          currency: meta.currency,
          exchange: meta.exchangeName,
        });
      }
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual symbol failure is ok', { error: _e?.message }); }
  }
  if (quotes.length === 0) throw new Error("no_quotes");
  return {
    ok: true,
    quotes,
    marketStatus: new Date().getUTCHours() >= 13 && new Date().getUTCHours() < 21 ? "open" : "closed",
    fetchedAt: new Date().toISOString(),
  };
}

async function tickFinancialFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("finance:ticker");
  if (payload) realtimeEmit("finance:ticker", payload);
}

// ── Crypto Prices (CoinGecko free API; same upstream URL as feed-manager's top-10 feed) ──

const REALTIME_COINS = ["bitcoin", "ethereum", "solana", "cardano", "polkadot"];

async function buildCrypto() {
  const text = await sharedText(COINGECKO_TOP10_URL, REALTIME_FEEDS["crypto:ticker"].ttlMs);
  const data = JSON.parse(text);
  const coins = Object.entries(data)
    .filter(([id]) => REALTIME_COINS.includes(id))
    .map(([id, info]) => ({
      id,
      price: info.usd,
      change24h: info.usd_24h_change?.toFixed(2),
      marketCap: info.usd_market_cap,
    }));
  if (coins.length === 0) throw new Error("no_coins");
  return { ok: true, coins, fetchedAt: new Date().toISOString() };
}

async function tickCryptoFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("crypto:ticker");
  if (payload) realtimeEmit("crypto:ticker", payload);
}

// ── News Feeds (RSS parsing — no API key needed) ──

async function buildNews() {
  const feeds = [
    { name: "BBC", url: BBC_TOP_URL },
    { name: "NPR", url: NPR_TOP_URL },
  ];

  const articles = [];
  for (const feed of feeds) {
    if (hostTier(feed.url) === "excluded") continue; // never fetched
    try {
      const text = await sharedText(feed.url, REALTIME_FEEDS["news:update"].ttlMs);
      {
        // Simple XML item extraction (no dependency needed)
        const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items.slice(0, 5)) {
          const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || "";
          const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
          // Image extraction — RSS feeds carry the article image in one of
          // four shapes. Try them in order of specificity. Without this the
          // news lens / social feed renders a generic icon placeholder for
          // every card, which is the single biggest "looks like vaporware"
          // tell on the substrate.
          const imageUrl =
            item.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/)?.[1] ||
            item.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*medium=["']image["']/)?.[1] ||
            item.match(/<media:content[^>]*medium=["']image["'][^>]*url=["']([^"']+)["']/)?.[1] ||
            item.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp|gif))["']/i)?.[1] ||
            item.match(/<description>[\s\S]*?<img[^>]*src=["']([^"']+)["']/i)?.[1] ||
            null;
          const description =
            item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ||
            item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ||
            "";
          // Strip HTML safely. Use a fixed-point loop because a single
          // pass against /<[^>]+>/ leaves shrapnel like
          // "<scri<script>pt>" → "<scrpt>". Iterate until no further
          // tags are removed, then escape any stray < / > so the field
          // is byte-safe even if a future surface ever renders it as
          // HTML. (CodeQL js/incomplete-multi-character-sanitization.)
          let stripped = description;
          for (let pass = 0; pass < 5; pass += 1) {
            const next = stripped.replace(/<[^>]*>/g, "");
            if (next === stripped) break;
            stripped = next;
          }
          const strippedSummary = stripped
            .replace(/[<>]/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 320);
          if (title) {
            const cleanTitle = title.replace(/<!\[CDATA\[|\]\]>/g, "");
            const full = hostTier(feed.url) === "full";
            articles.push({
              source: feed.name,
              title: cleanTitle,
              link,
              pubDate,
              // summary-only outlets: no outlet image/description, only Concord's own summary (or "")
              imageUrl: full ? imageUrl : null,
              summary: policySummary(feed, cleanTitle, link, strippedSummary),
              contentPolicy: full ? "full" : "summary-only",
            });
          }
        }
      }
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual feed failure is ok', { error: _e?.message }); }
  }
  if (articles.length === 0) throw new Error("no_articles");
  return { ok: true, articles: articles.slice(0, 15), fetchedAt: new Date().toISOString() };
}

async function tickNewsFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("news:update");
  if (payload) realtimeEmit("news:update", payload);
}

// ── Weather Data (Open-Meteo — completely free, no key needed) ──

function weatherPoint(STATE) {
  // Default location (configurable via STATE.settings)
  return { lat: STATE?.settings?.weatherLat || 41.7, lon: STATE?.settings?.weatherLon || -73.9 };
}

async function buildWeather() {
  const { lat, lon } = weatherPoint(_STATE);
  const text = await sharedText(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`,
    REALTIME_FEEDS["weather:update"].ttlMs,
  );
  const data = JSON.parse(text);
  return {
    ok: true,
    current: data.current,
    daily: data.daily,
    location: { lat, lon, timezone: data.timezone },
    fetchedAt: new Date().toISOString(),
  };
}

async function tickWeatherFeeds(STATE, realtimeEmit) {
  // The configured point moved since the cached payload was built: rebuild instead of serving the old place.
  const { lat, lon } = weatherPoint(STATE);
  const have = fcPeek(REALTIME_SOURCE_ID, "weather:update")?.data?.location;
  const moved = !!have && (have.lat !== lat || have.lon !== lon);
  const payload = await rtFetch("weather:update", { force: moved });
  if (payload) realtimeEmit("weather:update", payload);
}

// ── Scientific Papers (arXiv RSS — free) ──

async function buildResearch() {
  const categories = ["cs.AI", "cs.CL", "cs.LG"];
  const papers = [];

  for (const cat of categories) {
    try {
      const text = await sharedText(`https://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=5`, REALTIME_FEEDS["research:update"].ttlMs);
      const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      for (const entry of entries.slice(0, 3)) {
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300) || "";
        const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || "";
        const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || "";
        if (title) papers.push({ category: cat, title, summary, id, published });
      }
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual category failure is ok', { error: _e?.message }); }
  }

  if (papers.length === 0) throw new Error("no_papers");
  return { ok: true, papers: papers.slice(0, 10), fetchedAt: new Date().toISOString() };
}

async function tickResearchFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("research:update");
  if (payload) realtimeEmit("research:update", payload);
}

// ── Economic Data (World Bank API — free) ──

async function buildEconomy() {
  const indicators = [
    { code: "NY.GDP.MKTP.CD", name: "GDP" },
    { code: "FP.CPI.TOTL.ZG", name: "Inflation" },
    { code: "SL.UEM.TOTL.ZS", name: "Unemployment" },
  ];
  const data = [];
  for (const ind of indicators) {
    try {
      const text = await sharedText(
        `https://api.worldbank.org/v2/country/US/indicator/${ind.code}?format=json&per_page=3&date=2020:2025`,
        REALTIME_FEEDS["economy:update"].ttlMs,
      );
      const json = JSON.parse(text);
      const values = json?.[1]?.filter(v => v.value != null).slice(0, 3) || [];
      data.push({ indicator: ind.name, code: ind.code, values: values.map(v => ({ year: v.date, value: v.value })) });
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'silent catch', { error: _e?.message }); }
  }
  if (data.length === 0) throw new Error("no_indicators");
  return { ok: true, indicators: data, fetchedAt: new Date().toISOString() };
}

async function tickEconomyFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("economy:update");
  if (payload) realtimeEmit("economy:update", payload);
}

// ── Health Alerts (WHO Disease Outbreak News — official DON JSON API, free) ──

/** WHO DON OData JSON -> [{title, link, pubDate}] (headline + link + date only). */
export function parseWhoDonJson(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("who_don_bad_json"); }
  const rows = Array.isArray(json?.value) ? json.value : [];
  return rows.slice(0, 5).map((r) => {
    const title = String(r?.Title || "").trim();
    const path = String(r?.ItemDefaultUrl || "").trim();
    const link = path ? `${WHO_DON_ITEM_BASE}/${path.replace(/^\/+/, "")}` : "";
    const d = r?.PublicationDate ? new Date(r.PublicationDate) : null;
    const pubDate = d && !Number.isNaN(d.getTime()) ? d.toUTCString() : "";
    return { title, link, pubDate };
  }).filter((a) => a.title && /^https:\/\/www\.who\.int\//.test(a.link));
}

async function buildHealth() {
  const text = await sharedText(WHO_DON_URL, REALTIME_FEEDS["health:update"].ttlMs);
  if (/^\s*[{[]/.test(text)) {
    const alerts = parseWhoDonJson(text);
    if (alerts.length === 0) throw new Error("no_alerts");
    return { ok: true, alerts, fetchedAt: new Date().toISOString() };
  }
  // RSS fallback (kept for a test double or a WHO RSS comeback).
  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
  const alerts = items.slice(0, 5).map(item => {
    const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    return { title, link, pubDate };
  }).filter(a => a.title);
  if (alerts.length === 0) throw new Error("no_alerts");
  return { ok: true, alerts, fetchedAt: new Date().toISOString() };
}

async function tickHealthFeeds(STATE, realtimeEmit) {
  const payload = await rtFetch("health:update");
  if (payload) realtimeEmit("health:update", payload);
}

// ── Energy Data (EIA API — free with key) ──
// No data source is wired: this is a note-only event (no numbers), kept for socket-shape
// compatibility. It is deliberately NOT cached, so the REST snapshot reports "unavailable".

async function tickEnergyFeeds(STATE, realtimeEmit) {
  const payload = {
    ok: true,
    note: "Energy data requires EIA API key — set EIA_API_KEY in .env",
    fetchedAt: new Date().toISOString(),
  };
  realtimeEmit("energy:update", payload);
}

// ── Generic RSS domain tick ───────────────────────────────────────────────
// Most government / industry data sources expose a free RSS feed. This
// helper drives all 11 previously-dead-listener domains (legal,
// government, realestate, aviation, insurance, manufacturing, logistics,
// retail, fitness, agriculture, education) with the same parsing path
// the news tick uses. Each domain provides a list of free legal RSS
// URLs; we try them in order, swallow per-feed failures, and emit the
// aggregated payload + bridge each article into a DTU.
async function buildRssDomain({ domain, feeds, opts }) {
  const cacheMs = opts.cacheMs || 600000; // 10min default
  const maxPerFeed = opts.maxPerFeed || 5;
  const maxTotal = opts.maxTotal || 15;

  const articles = [];
  for (const feed of feeds) {
    if (hostTier(feed.url) === "excluded") continue; // never fetched
    try {
      const text = await sharedText(feed.url, cacheMs);
      const items = text.match(/<item>[\s\S]*?<\/item>/g)
                || text.match(/<entry>[\s\S]*?<\/entry>/g)
                || [];
      for (const item of items.slice(0, maxPerFeed)) {
        const title = (
          item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
          || item.match(/<title>([\s\S]*?)<\/title>/)?.[1]
          || ""
        ).replace(/\s+/g, " ").trim();
        const link = (
          item.match(/<link[^>]*href=["']([^"']+)["']/)?.[1]
          || item.match(/<link>([\s\S]*?)<\/link>/)?.[1]
          || ""
        ).trim();
        const pubDate = (
          item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]
          || item.match(/<published>([\s\S]*?)<\/published>/)?.[1]
          || item.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]
          || ""
        ).trim();
        const description =
          item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
          || item.match(/<description>([\s\S]*?)<\/description>/)?.[1]
          || item.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]
          || "";
        // Fixed-point HTML strip (same shape as buildNews — preserves
        // the CodeQL js/incomplete-multi-character-sanitization guard).
        let stripped = description;
        for (let pass = 0; pass < 5; pass += 1) {
          const next = stripped.replace(/<[^>]*>/g, "");
          if (next === stripped) break;
          stripped = next;
        }
        const strippedSummary = stripped.replace(/[<>]/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);
        const summary = policySummary(feed, title, link, strippedSummary);
        if (title) articles.push({ source: feed.name, title, link, pubDate, summary, contentPolicy: hostTier(feed.url) === "full" ? "full" : "summary-only" });
        if (articles.length >= maxTotal) break;
      }
      if (articles.length >= maxTotal) break;
    } catch (e) {
      logger.debug?.("emergent:realtime-feeds", `${domain}_feed_failure`, { feed: feed.name, error: e?.message });
    }
  }

  if (articles.length === 0) throw new Error("no_articles");
  return { ok: true, articles, fetchedAt: new Date().toISOString() };
}

async function _tickRssDomain(domain, feeds, eventName, bridgeType, realtimeEmit, opts = {}) {
  _rssDefs.set(eventName, { domain, feeds, bridgeType, opts });
  const payload = await rtFetch(eventName);
  if (payload) realtimeEmit(eventName, payload);
}

// All 11 previously-dead-listener domains. Sources are free + legal,
// no API key required. Each domain has 1–3 fallback feeds so a single
// broken source doesn't black out the lens.
const _DOMAIN_FEEDS = {
  legal: [
    { name: "CourtListener", url: "https://www.courtlistener.com/feed/court/scotus/" },
    { name: "Federal Register Legal", url: "https://www.federalregister.gov/documents/search.rss?conditions%5Btype%5D%5B%5D=RULE" },
  ],
  government: [
    { name: "Federal Register", url: "https://www.federalregister.gov/documents/current.rss" },
    { name: "House Clerk", url: "https://clerk.house.gov/floor/floor-summary.aspx?format=rss" },
  ],
  realestate: [
    { name: "HUD Press", url: "https://www.hud.gov/sites/dfiles/Main/feeds/HUDpressReleases.xml" },
    { name: "Realtor.com Research", url: "https://www.realtor.com/research/feed/" },
  ],
  aviation: [
    { name: "NTSB", url: "https://www.ntsb.gov/news/Pages/_layouts/15/listfeed.aspx?List=%7B12345678-1234-1234-1234-123456789012%7D" },
    { name: "Aviation Safety Network", url: "https://aviation-safety.net/database/dblist.xml" },
    { name: "FAA News", url: "https://www.faa.gov/newsroom/rss/all.rss" },
  ],
  insurance: [
    { name: "Treasury FIO", url: "https://home.treasury.gov/rss/press-releases" },
    { name: "NAIC News", url: "https://content.naic.org/rss-feed.xml" },
  ],
  manufacturing: [
    { name: "BLS PPI", url: "https://www.bls.gov/feed/ppi.rss" },
    { name: "Federal Reserve G.17", url: "https://www.federalreserve.gov/feeds/g17.xml" },
  ],
  logistics: [
    { name: "BTS", url: "https://www.bts.gov/rss/news" },
    { name: "DOT Press", url: "https://www.transportation.gov/briefing-room.xml" },
  ],
  retail: [
    { name: "BLS CPI", url: "https://www.bls.gov/feed/cpi.rss" },
    { name: "Census Retail Trade", url: "https://www.census.gov/retail/rss.xml" },
  ],
  fitness: [
    { name: "CDC Physical Activity", url: "https://tools.cdc.gov/podcasts/feed.asp?feedid=183" },
    { name: "CDC MMWR", url: "https://www.cdc.gov/mmwr/rss/rss.html" },
  ],
  agriculture: [
    { name: "USDA AMS News", url: "https://www.ams.usda.gov/rss-feeds/ams-news.xml" },
    { name: "USDA Press", url: "https://www.usda.gov/rss/latest-releases.xml" },
  ],
  education: [
    { name: "ED Press", url: "https://www.ed.gov/rss/press-releases.xml" },
    { name: "NCES News", url: "https://nces.ed.gov/whatsnew/rss/whatsnew.xml" },
  ],
};

async function tickLegalFeeds(_STATE, realtimeEmit)         { return _tickRssDomain("legal",         _DOMAIN_FEEDS.legal,         "legal:update",         "news:legal",         realtimeEmit); }
async function tickGovernmentFeeds(_STATE, realtimeEmit)    { return _tickRssDomain("government",    _DOMAIN_FEEDS.government,    "government:update",    "news:government",    realtimeEmit); }
async function tickRealEstateFeeds(_STATE, realtimeEmit)    { return _tickRssDomain("realestate",    _DOMAIN_FEEDS.realestate,    "realestate:update",    "news:realestate",    realtimeEmit); }
async function tickAviationFeeds(_STATE, realtimeEmit)      { return _tickRssDomain("aviation",      _DOMAIN_FEEDS.aviation,      "aviation:update",      "news:aviation",      realtimeEmit); }
async function tickInsuranceFeeds(_STATE, realtimeEmit)     { return _tickRssDomain("insurance",     _DOMAIN_FEEDS.insurance,     "insurance:update",     "news:insurance",     realtimeEmit); }
async function tickManufacturingFeeds(_STATE, realtimeEmit) { return _tickRssDomain("manufacturing", _DOMAIN_FEEDS.manufacturing, "manufacturing:update", "news:manufacturing", realtimeEmit); }
async function tickLogisticsFeeds(_STATE, realtimeEmit)     { return _tickRssDomain("logistics",     _DOMAIN_FEEDS.logistics,     "logistics:update",     "news:logistics",     realtimeEmit); }
async function tickRetailFeeds(_STATE, realtimeEmit)        { return _tickRssDomain("retail",        _DOMAIN_FEEDS.retail,        "retail:update",        "news:retail",        realtimeEmit); }
async function tickFitnessFeeds(_STATE, realtimeEmit)       { return _tickRssDomain("fitness",       _DOMAIN_FEEDS.fitness,       "fitness:update",       "news:fitness",       realtimeEmit); }
async function tickAgricultureFeeds(_STATE, realtimeEmit)   { return _tickRssDomain("agriculture",   _DOMAIN_FEEDS.agriculture,   "agriculture:update",   "news:agriculture",   realtimeEmit); }
async function tickEducationFeeds(_STATE, realtimeEmit)     { return _tickRssDomain("education",     _DOMAIN_FEEDS.education,     "education:update",     "news:education",     realtimeEmit); }

// The REST snapshot can be asked for a domain feed before its first tick this process (e.g. right
// after a restart, served from the persisted file) — nothing to register for that, the persisted
// entry is read straight from the cache. _rssDefs is only needed by the builder.

// ── Main tick dispatcher ──

export async function tickRealTimeFeeds(STATE, tickCount, realtimeEmit, callBrain, bridgeEvent) {
  // Skip live external data fetches under test — in CI's no-egress sandbox these
  // block to their AbortSignal timeout, stalling the event loop and starving the
  // behavior smoke suite. Tests don't assert on live feed contents (tests that do
  // call __enableRealtimeTickForTests and inject the transport).
  if (String(process.env.NODE_ENV).toLowerCase() === "test" && !_tickEnabledForTests) return { ok: false, reason: "test_mode" };
  // Set the module-level bridge callback so tick functions can use it
  _bridgeEvent = typeof bridgeEvent === "function" ? bridgeEvent : null;
  _STATE = STATE;
  ensureRealtimeSource();

  const tasks = [];

  // Financial + Crypto — every 5th tick (~75s)
  if (tickCount % 5 === 0) {
    tasks.push(tickFinancialFeeds(STATE, realtimeEmit, callBrain).catch(e => recordError("finance", e)));
    tasks.push(tickCryptoFeeds(STATE, realtimeEmit).catch(e => recordError("crypto", e)));
  }

  // News — every 10th tick (~150s)
  if (tickCount % 10 === 0) {
    tasks.push(tickNewsFeeds(STATE, realtimeEmit).catch(e => recordError("news", e)));
  }

  // Weather — every 20th tick (~5 min)
  if (tickCount % 20 === 0) {
    tasks.push(tickWeatherFeeds(STATE, realtimeEmit).catch(e => recordError("weather", e)));
  }

  // Research — every 100th tick (~25 min)
  if (tickCount % 100 === 0) {
    tasks.push(tickResearchFeeds(STATE, realtimeEmit).catch(e => recordError("research", e)));
  }

  // Economy — every 200th tick (~50 min)
  if (tickCount % 200 === 0) {
    tasks.push(tickEconomyFeeds(STATE, realtimeEmit).catch(e => recordError("economy", e)));
  }

  // Health — every 100th tick
  if (tickCount % 100 === 0) {
    tasks.push(tickHealthFeeds(STATE, realtimeEmit).catch(e => recordError("health", e)));
  }

  // Energy — every 200th tick
  if (tickCount % 200 === 0) {
    tasks.push(tickEnergyFeeds(STATE, realtimeEmit).catch(e => recordError("energy", e)));
  }

  // ── Domain RSS feeds for previously-dead-listener lenses ──
  // Cadences staggered so we don't hammer all 11 sources in the same
  // tick. Each domain runs every 40–80 ticks (10–20 min) which is
  // generous for press-release / regulatory feeds that update hourly
  // to daily.
  if (tickCount % 40 === 0) {
    tasks.push(tickLegalFeeds(STATE, realtimeEmit).catch(e => recordError("legal", e)));
    tasks.push(tickGovernmentFeeds(STATE, realtimeEmit).catch(e => recordError("government", e)));
  }
  if (tickCount % 60 === 0) {
    tasks.push(tickRealEstateFeeds(STATE, realtimeEmit).catch(e => recordError("realestate", e)));
    tasks.push(tickAviationFeeds(STATE, realtimeEmit).catch(e => recordError("aviation", e)));
  }
  if (tickCount % 80 === 0) {
    tasks.push(tickInsuranceFeeds(STATE, realtimeEmit).catch(e => recordError("insurance", e)));
    tasks.push(tickManufacturingFeeds(STATE, realtimeEmit).catch(e => recordError("manufacturing", e)));
    tasks.push(tickLogisticsFeeds(STATE, realtimeEmit).catch(e => recordError("logistics", e)));
  }
  if (tickCount % 60 === 0) {
    tasks.push(tickRetailFeeds(STATE, realtimeEmit).catch(e => recordError("retail", e)));
    tasks.push(tickAgricultureFeeds(STATE, realtimeEmit).catch(e => recordError("agriculture", e)));
  }
  if (tickCount % 80 === 0) {
    tasks.push(tickFitnessFeeds(STATE, realtimeEmit).catch(e => recordError("fitness", e)));
    tasks.push(tickEducationFeeds(STATE, realtimeEmit).catch(e => recordError("education", e)));
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

// ── Snapshot reads (REST) ───────────────────────────────────────────────────

/**
 * What GET /api/realtime/feed/:feed returns: the SAME payload the socket event carries (`data`),
 * plus freshness metadata. Never fetches and never invents data:
 *   fresh / stale  -> { status, stale, fetchedAt, ageMs, data }
 *   nothing usable -> { status:"unavailable", reason, lastOkAt, data:null }
 *   unknown feed   -> { known:false }
 */
export function getRealtimeSnapshot(feed, now = Date.now()) {
  const event = resolveFeedKey(feed);
  if (!event) return { known: false, feed: String(feed), status: "unavailable", reason: "unknown_feed", lastOkAt: null, data: null };
  const base = { known: true, feed: String(feed), event };
  if (event === ENERGY_EVENT) {
    return { ...base, status: "unavailable", reason: "requires_eia_api_key", lastOkAt: null, data: null };
  }
  ensureRealtimeSource(); // also restores the persisted file, so a fresh process can answer before its first tick
  const cfg = REALTIME_FEEDS[event];
  const e = fcPeek(REALTIME_SOURCE_ID, event);
  if (!e) {
    const last = (FEED_ERRORS.get(cfg.feed) || []).slice(-1)[0];
    return { ...base, status: "unavailable", reason: last ? (/^upstream_error/.test(last.error) ? last.error : `upstream_error: ${last.error}`) : "not_fetched_yet", lastOkAt: null, data: null };
  }
  const age = now - e.fetchedAt;
  if (age > cfg.maxAgeMs) {
    return { ...base, status: "unavailable", reason: "too_old", lastOkAt: new Date(e.fetchedAt).toISOString(), data: null };
  }
  const stale = age > staleAfterMs(cfg);
  return { ...base, status: stale ? "stale" : "fresh", stale, fetchedAt: new Date(e.fetchedAt).toISOString(), ageMs: age, data: e.data };
}

export function getRealtimeFeedStatus() {
  // Include feed manager status if available
  let feedManagerStatus = null;
  try {
    if (globalThis._feedManager) {
      feedManagerStatus = globalThis._feedManager.getFeedHealthDashboard();
    }
  } catch (_e) { /* feed manager may not be initialized */ }

  const snapshots = {};
  for (const event of [...Object.keys(REALTIME_FEEDS), ENERGY_EVENT]) {
    const s = getRealtimeSnapshot(event);
    snapshots[event] = { status: s.status, stale: !!s.stale, fetchedAt: s.fetchedAt ?? null, reason: s.reason ?? null, lastOkAt: s.lastOkAt ?? null };
  }
  const cs = fcStats();
  return {
    cacheSize: Object.values(snapshots).filter(s => s.status === "fresh" || s.status === "stale").length,
    errors: Object.fromEntries(FEED_ERRORS),
    feeds: ["finance", "crypto", "news", "weather", "research", "economy", "health", "energy"],
    snapshots,
    feedCache: { realtime: cs[REALTIME_SOURCE_ID] ?? null, sharedHttp: cs["shared-http"] ?? null },
    feedManager: feedManagerStatus,
  };
}

/** Back-compat: the bare payload (or null). Prefer getRealtimeSnapshot for metadata. */
export function getRealtimeFeedData(feed) {
  const s = getRealtimeSnapshot(feed);
  return s.status === "fresh" || s.status === "stale" ? s.data : null;
}
