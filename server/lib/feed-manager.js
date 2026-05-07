/**
 * Feed Manager — Centralized Real-Time Feed Registry
 *
 * Maintains a registry of feed sources per lens domain, polls on configurable
 * intervals (separate from heartbeat), parses RSS/XML/JSON/HTML responses,
 * deduplicates against existing DTUs, creates feed DTUs with proper attribution,
 * and emits new items through WebSocket for real-time UI updates.
 *
 * Core invariants:
 *   - Runs on its OWN timer, NOT on heartbeat tick
 *   - Max 100 active feed sources simultaneously
 *   - Max 1,000 feed DTUs created per hour
 *   - Stale feeds (5+ consecutive failures) auto-disable
 *   - Graceful handling of blocked requests (RunPod egress)
 *   - Feed DTUs use meta.via: "feed-manager" marker
 */

import { createHash, randomUUID } from "crypto";
import logger from "../logger.js";
import { feedAttribution } from "./source-attribution.js";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & LIMITS
// ══════════════════════════════════════════════════════════════════════════════

const MAX_ACTIVE_FEEDS = 100;
const MAX_DTUS_PER_HOUR = 1000;
const STALE_THRESHOLD = 5; // consecutive failures before auto-disable
const FETCH_TIMEOUT = 10000;
const DEFAULT_USER_AGENT = "ConcordOS/2.0 FeedManager";
const DEDUP_WINDOW_SIZE = 5000; // max hashes kept for dedup

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════

/** @type {Map<string, object>} Feed source registry keyed by feed id */
const _feedSources = new Map();

/** @type {Map<string, object>} Feed health stats keyed by feed id */
const _feedHealth = new Map();

/** @type {Set<string>} Content hashes for deduplication */
const _seenHashes = new Set();

/** @type {Map<string, NodeJS.Timeout>} Per-feed interval timers */
const _feedTimers = new Map();

/** @type {number} DTUs created in the current hour window */
let _dtuCountThisHour = 0;

/** @type {number} Timestamp of current hour window start */
let _hourWindowStart = Date.now();

/** @type {boolean} Whether feed manager is running */
let _running = false;

/** @type {object|null} Dependencies injected at init */
let _deps = null;

// ══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function safeFetch(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout || FETCH_TIMEOUT);
  return fetch(url, {
    ...opts,
    signal: ac.signal,
    headers: { "User-Agent": DEFAULT_USER_AGENT, ...(opts.headers || {}) },
  }).finally(() => clearTimeout(t));
}

function contentHash(str) {
  return createHash("sha256").update(str).digest("hex").slice(0, 20);
}

function titleHash(title) {
  return contentHash((title || "").toLowerCase().trim());
}

function urlHash(url) {
  return contentHash((url || "").trim());
}

function resetHourWindow() {
  const now = Date.now();
  if (now - _hourWindowStart > 3600000) {
    _dtuCountThisHour = 0;
    _hourWindowStart = now;
  }
}

function canCreateDTU() {
  resetHourWindow();
  return _dtuCountThisHour < MAX_DTUS_PER_HOUR;
}

function trimDedup() {
  if (_seenHashes.size > DEDUP_WINDOW_SIZE) {
    const arr = [..._seenHashes];
    const toRemove = arr.slice(0, arr.length - DEDUP_WINDOW_SIZE);
    for (const h of toRemove) _seenHashes.delete(h);
  }
}

function isDuplicate(item) {
  const hashes = [
    item.sourceUrl ? urlHash(item.sourceUrl) : null,
    item.title ? titleHash(item.title) : null,
    item.content ? contentHash(item.content) : null,
  ].filter(Boolean);

  for (const h of hashes) {
    if (_seenHashes.has(h)) return true;
  }
  // Mark as seen
  for (const h of hashes) _seenHashes.add(h);
  trimDedup();
  return false;
}


// ══════════════════════════════════════════════════════════════════════════════
// PARSERS — RSS/XML, JSON API, HTML scrape
// ══════════════════════════════════════════════════════════════════════════════

/** Parse RSS/Atom XML into normalized items */
function parseRSS(text, feedSource) {
  const items = [];

  // Try RSS <item> format
  const rssItems = text.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const raw of rssItems) {
    const title = extractXMLField(raw, "title");
    const link = extractXMLField(raw, "link");
    const pubDate = extractXMLField(raw, "pubDate");
    const description = extractXMLField(raw, "description");
    const categories = extractAllXMLFields(raw, "category");
    if (title) {
      items.push({
        title: cleanCDATA(title),
        sourceUrl: link || "",
        summary: cleanCDATA(description || "").slice(0, 200),
        publishedAt: pubDate ? tryParseDate(pubDate) : new Date().toISOString(),
        categories,
        content: cleanCDATA(description || ""),
      });
    }
  }

  // Try Atom <entry> format if no RSS items
  if (items.length === 0) {
    const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const raw of entries) {
      const title = extractXMLField(raw, "title");
      const link = raw.match(/<link[^>]*href="([^"]*)"[^>]*>/)?.[1] || extractXMLField(raw, "link");
      const published = extractXMLField(raw, "published") || extractXMLField(raw, "updated");
      const summary = extractXMLField(raw, "summary") || extractXMLField(raw, "content");
      const categories = [...raw.matchAll(/term="([^"]*)"/g)].map(m => m[1]);
      if (title) {
        items.push({
          title: cleanCDATA(title),
          sourceUrl: link || "",
          summary: cleanCDATA(summary || "").slice(0, 200),
          publishedAt: published ? tryParseDate(published) : new Date().toISOString(),
          categories,
          content: cleanCDATA(summary || ""),
        });
      }
    }
  }

  return items;
}

/** Parse JSON API responses using named parser functions */
function parseJSON(data, feedSource) {
  const parserName = feedSource.parser || "generic";
  const parser = JSON_PARSERS[parserName];
  if (parser) return parser(data, feedSource);
  return genericJSONParser(data, feedSource);
}

/** Parse HTML by extracting headline-like patterns */
function parseHTML(text, feedSource) {
  const items = [];
  // Extract <h2> or <h3> with links as potential headlines
  const headlinePattern = /<(?:h[1-4]|a)[^>]*>[\s\S]*?<\/(?:h[1-4]|a)>/gi;
  const matches = text.match(headlinePattern) || [];
  for (const raw of matches.slice(0, 20)) {
    const linkMatch = raw.match(/href="([^"]*)"/);
    const textContent = raw.replace(/<[^>]*>/g, "").trim();
    if (textContent.length > 10 && textContent.length < 300) {
      items.push({
        title: textContent,
        sourceUrl: linkMatch?.[1] || feedSource.url,
        summary: textContent.slice(0, 200),
        publishedAt: new Date().toISOString(),
        categories: [],
        content: textContent,
      });
    }
  }
  return items;
}

// ── XML Helpers ──

function extractXMLField(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return re.exec(xml)?.[1] || null;
}

function extractAllXMLFields(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(cleanCDATA(m[1]));
  return results;
}

function cleanCDATA(str) {
  if (!str) return "";
  return str.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]*>/g, "").trim();
}

function tryParseDate(str) {
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch { return new Date().toISOString(); }
}


// ══════════════════════════════════════════════════════════════════════════════
// NAMED JSON PARSERS
// ══════════════════════════════════════════════════════════════════════════════

const JSON_PARSERS = {
  /** Yahoo Finance v8 chart API */
  "yahoo-finance": (data) => {
    const results = data?.chart?.result || [];
    return results.map(r => {
      const meta = r?.meta || {};
      return {
        title: `${meta.symbol || "?"}: $${meta.regularMarketPrice || "N/A"} (${((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2)}%)`,
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(meta.symbol || "")}`,
        summary: `${meta.symbol} at $${meta.regularMarketPrice}, prev close $${meta.previousClose}, exchange: ${meta.exchangeName}`,
        publishedAt: new Date().toISOString(),
        categories: ["stocks", "market"],
        content: JSON.stringify(meta),
        extra: { price: meta.regularMarketPrice, change: meta.regularMarketPrice - meta.previousClose, symbol: meta.symbol },
      };
    }).filter(i => i.title);
  },

  /** CoinGecko simple price */
  "coingecko": (data) => {
    return Object.entries(data || {}).map(([id, info]) => ({
      title: `${id}: $${info.usd} (${(info.usd_24h_change || 0).toFixed(2)}% 24h)`,
      sourceUrl: `https://www.coingecko.com/en/coins/${id}`,
      summary: `${id} price: $${info.usd}, 24h change: ${(info.usd_24h_change || 0).toFixed(2)}%, market cap: $${info.usd_market_cap || "N/A"}`,
      publishedAt: new Date().toISOString(),
      categories: ["crypto", "market"],
      content: JSON.stringify(info),
      extra: { price: info.usd, change24h: info.usd_24h_change, marketCap: info.usd_market_cap },
    }));
  },

  /** Hacker News API (top stories) */
  "hackernews": (data) => {
    // data is array of story objects
    if (!Array.isArray(data)) return [];
    return data.map(story => ({
      title: story.title || "Untitled",
      sourceUrl: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      summary: `${story.title} — ${story.score || 0} points, ${story.descendants || 0} comments`,
      publishedAt: story.time ? new Date(story.time * 1000).toISOString() : new Date().toISOString(),
      categories: ["tech", "hackernews"],
      content: `${story.title}\nScore: ${story.score}, Comments: ${story.descendants}`,
      extra: { score: story.score, comments: story.descendants, hnId: story.id },
    }));
  },

  /** USGS Earthquake GeoJSON */
  "usgs-earthquake": (data) => {
    const features = data?.features || [];
    return features.map(f => {
      const props = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      return {
        title: `M${props.mag} Earthquake: ${props.place || "Unknown location"}`,
        sourceUrl: props.url || "",
        summary: `Magnitude ${props.mag} at ${props.place}. Depth: ${coords[2] || "?"}km. ${props.tsunami ? "⚠ Tsunami warning" : ""}`,
        publishedAt: props.time ? new Date(props.time).toISOString() : new Date().toISOString(),
        categories: ["earthquake", "geology", "seismic"],
        content: JSON.stringify({ mag: props.mag, place: props.place, depth: coords[2], tsunami: props.tsunami }),
        extra: { magnitude: props.mag, lat: coords[1], lon: coords[0], depth: coords[2] },
      };
    });
  },

  /** Open-Meteo weather */
  "open-meteo": (data) => {
    const current = data?.current || {};
    return [{
      title: `Weather: ${current.temperature_2m || "?"}°C, Wind ${current.wind_speed_10m || "?"}km/h`,
      sourceUrl: "https://open-meteo.com/",
      summary: `Current: ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C). Wind: ${current.wind_speed_10m}km/h. Precipitation: ${current.precipitation}mm`,
      publishedAt: new Date().toISOString(),
      categories: ["weather", "forecast"],
      content: JSON.stringify(data.current),
      extra: { temp: current.temperature_2m, wind: current.wind_speed_10m },
    }];
  },

  /** World Bank API indicators */
  "world-bank": (data) => {
    // World Bank returns [metadata, dataArray]
    const records = Array.isArray(data) ? data[1] : (data || []);
    if (!Array.isArray(records)) return [];
    return records.filter(r => r.value != null).map(r => ({
      title: `${r.indicator?.value || "Indicator"}: ${r.value} (${r.date})`,
      sourceUrl: `https://data.worldbank.org/indicator/${r.indicator?.id || ""}`,
      summary: `${r.country?.value || ""} — ${r.indicator?.value}: ${r.value} for ${r.date}`,
      publishedAt: new Date().toISOString(),
      categories: ["economics", "global"],
      content: JSON.stringify(r),
      extra: { value: r.value, year: r.date, country: r.country?.value },
    }));
  },

  /** NASA APOD */
  "nasa-apod": (data) => {
    if (!data?.title) return [];
    return [{
      title: `NASA APOD: ${data.title}`,
      sourceUrl: data.hdurl || data.url || "",
      summary: (data.explanation || "").slice(0, 200),
      publishedAt: data.date ? tryParseDate(data.date) : new Date().toISOString(),
      categories: ["space", "astronomy", "nasa"],
      content: data.explanation || "",
      extra: { mediaType: data.media_type, copyright: data.copyright },
    }];
  },

  /** Generic JSON — tries common patterns */
  "generic": (data) => genericJSONParser(data),
};

function genericJSONParser(data, feedSource) {
  // Try common JSON shapes: { items: [] }, { results: [] }, { data: [] }, or raw array
  const arr = data?.items || data?.results || data?.data || data?.entries || data?.articles || data?.features || (Array.isArray(data) ? data : []);
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 20).map(item => ({
    title: item.title || item.name || item.headline || item.subject || JSON.stringify(item).slice(0, 80),
    sourceUrl: item.url || item.link || item.href || "",
    summary: (item.summary || item.description || item.abstract || item.snippet || "").slice(0, 200),
    publishedAt: tryParseDate(item.published || item.publishedAt || item.date || item.created_at || item.timestamp || ""),
    categories: item.tags || item.categories || [],
    content: item.content || item.body || item.text || "",
  }));
}


// ══════════════════════════════════════════════════════════════════════════════
// CORE FEED PROCESSING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch and process a single feed source.
 * @param {object} feedSource - Feed source config
 * @returns {Promise<{items: object[], errors: string[]}>}
 */
async function fetchFeed(feedSource) {
  const health = _feedHealth.get(feedSource.id) || initHealth(feedSource.id);

  if (!feedSource.enabled) return { items: [], errors: ["disabled"] };
  if (!canCreateDTU()) return { items: [], errors: ["hourly_dtu_limit_reached"] };

  try {
    health.lastAttempt = Date.now();
    const res = await safeFetch(feedSource.url, {
      timeout: feedSource.timeout || FETCH_TIMEOUT,
      headers: feedSource.headers || {},
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    let items = [];
    const type = feedSource.type || "rss";

    if (type === "rss" || type === "xml" || type === "atom") {
      const text = await res.text();
      items = parseRSS(text, feedSource);
    } else if (type === "json") {
      const data = await res.json();
      items = parseJSON(data, feedSource);
    } else if (type === "html") {
      const text = await res.text();
      items = parseHTML(text, feedSource);
    }

    // Update health
    health.lastSuccess = Date.now();
    health.consecutiveFailures = 0;
    health.totalFetches++;
    health.totalItems += items.length;
    health.lastItemCount = items.length;
    _feedHealth.set(feedSource.id, health);

    return { items, errors: [] };
  } catch (err) {
    health.consecutiveFailures++;
    health.totalErrors++;
    health.lastError = err.message;
    health.lastErrorAt = Date.now();
    _feedHealth.set(feedSource.id, health);

    // Auto-disable stale feeds
    if (health.consecutiveFailures >= STALE_THRESHOLD) {
      feedSource.enabled = false;
      feedSource.autoDisabledAt = new Date().toISOString();
      feedSource.autoDisableReason = `${STALE_THRESHOLD}+ consecutive failures: ${err.message}`;
      _feedSources.set(feedSource.id, feedSource);
      logger.warn?.("[feed-manager] Auto-disabled stale feed", { id: feedSource.id, errors: health.consecutiveFailures });
    }

    return { items: [], errors: [err.message] };
  }
}

function initHealth(feedId) {
  const h = {
    feedId,
    lastAttempt: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    totalFetches: 0,
    totalErrors: 0,
    totalItems: 0,
    totalDTUsCreated: 0,
    lastItemCount: 0,
    lastError: null,
    lastErrorAt: null,
    createdAt: Date.now(),
  };
  _feedHealth.set(feedId, h);
  return h;
}

/**
 * Convert a parsed feed item into a DTU and commit it.
 * @param {object} item - Parsed feed item
 * @param {object} feedSource - Feed source config
 * @returns {Promise<{ok: boolean, dtuId?: string}>}
 */
async function commitFeedDTU(item, feedSource) {
  if (!canCreateDTU()) return { ok: false, error: "hourly_limit" };
  if (isDuplicate(item)) return { ok: false, error: "duplicate" };

  const now = new Date().toISOString();
  const dtuId = `feed_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const tags = [
    ...(feedSource.tags || []),
    ...(Array.isArray(item.categories) ? item.categories.slice(0, 5) : []),
    "feed",
    "live",
  ].map(t => String(t).toLowerCase().trim()).filter(Boolean);
  const uniqueTags = [...new Set(tags)].slice(0, 15);

  // Build universal source attribution
  const attribution = feedAttribution(feedSource, item);

  const dtu = {
    id: dtuId,
    title: (item.title || "Untitled Feed Item").slice(0, 200),
    tier: "regular",
    scope: "global", // Feed DTUs are public data, always global scope
    tags: uniqueTags,
    source: attribution, // Universal source attribution object
    core: {
      definitions: [item.summary || item.title || ""],
      assertions: [],
      evidence: item.sourceUrl ? [{ type: "url", value: item.sourceUrl, label: feedSource.name || feedSource.id }] : [],
    },
    meta: {
      feedId: feedSource.id,
      fetchedAt: now,
      via: "feed-manager",
      sourceUrl: item.sourceUrl || "",
      sourceName: feedSource.name || feedSource.id,
      publishedAt: item.publishedAt || now,
      source: attribution, // Also stored in meta for backward compat
    },
    createdAt: now,
    updatedAt: now,
    epistemologicalStance: "reported",
  };

  // Commit through the injected pipeline
  try {
    if (_deps?.pipelineCommitDTU) {
      const ctx = _deps.makeInternalCtx?.("feed-manager") || { actor: { userId: "feed-manager", role: "owner", scopes: ["*"], internal: true }, internal: true };
      const result = await _deps.pipelineCommitDTU(ctx, dtu, { op: "feed.ingest", allowRewrite: false });
      if (result?.ok) {
        _dtuCountThisHour++;
        const health = _feedHealth.get(feedSource.id);
        if (health) health.totalDTUsCreated++;
        return { ok: true, dtuId };
      }
      return { ok: false, error: result?.error || "pipeline_rejected" };
    } else if (_deps?.STATE?.dtus) {
      // Fallback: direct insert
      _deps.STATE.dtus.set(dtuId, dtu);
      _dtuCountThisHour++;
      const health = _feedHealth.get(feedSource.id);
      if (health) health.totalDTUsCreated++;
      return { ok: true, dtuId };
    }
    return { ok: false, error: "no_commit_path" };
  } catch (err) {
    logger.warn?.("[feed-manager] DTU commit failed", { feedId: feedSource.id, error: err.message });
    return { ok: false, error: err.message };
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// FEED TICK — Process one feed source (called by its interval timer)
// ══════════════════════════════════════════════════════════════════════════════

async function tickFeed(feedId) {
  const feedSource = _feedSources.get(feedId);
  if (!feedSource || !feedSource.enabled) return;

  // Check system load before fetching
  if (_deps?.checkLoad && !_deps.checkLoad()) {
    logger.debug?.("[feed-manager] Skipping feed tick due to high load", { feedId });
    return;
  }

  const { items, errors } = await fetchFeed(feedSource);
  if (errors.length > 0 && items.length === 0) return;

  let created = 0;
  for (const item of items.slice(0, 10)) { // max 10 items per feed per tick
    const result = await commitFeedDTU(item, feedSource);
    if (result.ok) {
      created++;
      // Emit via WebSocket for real-time UI updates
      if (_deps?.realtimeEmit) {
        try {
          _deps.realtimeEmit("feed:new-dtu", {
            dtuId: result.dtuId,
            feedId: feedSource.id,
            domain: feedSource.domain,
            title: item.title,
            sourceUrl: item.sourceUrl,
            sourceName: feedSource.name || feedSource.id,
            tags: feedSource.tags,
          });
        } catch (_e) { /* non-critical */ }
      }

      // Also emit through event-to-DTU bridge if available
      if (_deps?.bridgeEvent) {
        try {
          const eventType = mapDomainToEventType(feedSource.domain);
          await _deps.bridgeEvent({
            type: eventType,
            data: {
              title: item.title,
              source: feedSource.name || feedSource.id,
              link: item.sourceUrl,
              summary: item.summary,
            },
            source: feedSource.id,
            timestamp: item.publishedAt,
          });
        } catch (_e) { /* bridge is optional */ }
      }
    }
  }

  if (created > 0) {
    logger.info?.("[feed-manager] Feed tick", { feedId, itemsFetched: items.length, dtusCreated: created });
  }
}

function mapDomainToEventType(domain) {
  const map = {
    finance: "market:trade",
    news: "news:politics",
    sports: "news:sports",
    weather: "weather:alert",
    healthcare: "health:alert",
    science: "research:paper",
    technology: "news:tech",
    energy: "market:commodity",
    geology: "weather:alert",
    ocean: "weather:alert",
    space: "research:paper",
    legal: "news:politics",
    agriculture: "market:commodity",
    environment: "news:environment",
    "real-estate": "news:economics",
    trades: "news:economics",
    transportation: "news:tech",
    global: "news:politics",
    music: "news:culture",
  };
  return map[domain] || "news:politics";
}

// ══════════════════════════════════════════════════════════════════════════════
// FEED TIMER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

function startFeedTimer(feedSource) {
  stopFeedTimer(feedSource.id);
  if (!feedSource.enabled) return;

  const interval = Math.max(feedSource.interval || 60000, 5000); // min 5s
  const timer = setInterval(() => {
    tickFeed(feedSource.id).catch(err => {
      logger.warn?.("[feed-manager] Feed tick error", { feedId: feedSource.id, error: err.message });
    });
  }, interval);

  // Prevent timer from keeping Node alive
  if (timer.unref) timer.unref();
  _feedTimers.set(feedSource.id, timer);

  // Initial fetch with small random delay to avoid thundering herd
  const startDelay = Math.floor(Math.random() * 5000) + 1000;
  setTimeout(() => {
    tickFeed(feedSource.id).catch(err => {
      logger.warn?.("[feed-manager] Initial fetch error", { feedId: feedSource.id, error: err.message });
    });
  }, startDelay);
}

function stopFeedTimer(feedId) {
  const timer = _feedTimers.get(feedId);
  if (timer) {
    clearInterval(timer);
    _feedTimers.delete(feedId);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize the feed manager with dependencies.
 * @param {object} deps - { STATE, pipelineCommitDTU, makeInternalCtx, realtimeEmit, bridgeEvent, checkLoad }
 */
export function initFeedManager(deps = {}) {
  _deps = deps;
  logger.info?.("[feed-manager] Initialized with deps:", Object.keys(deps).filter(k => !!deps[k]).join(", "));
}

/**
 * Register a feed source and start polling.
 * @param {object} source - Feed source config
 * @returns {{ ok: boolean, error?: string }}
 */
export function registerFeed(source) {
  if (!source?.id || !source?.url) return { ok: false, error: "missing_id_or_url" };

  const activeCount = [..._feedSources.values()].filter(f => f.enabled).length;
  if (activeCount >= MAX_ACTIVE_FEEDS && source.enabled !== false) {
    return { ok: false, error: `max_active_feeds_reached (${MAX_ACTIVE_FEEDS})` };
  }

  const feed = {
    id: source.id,
    name: source.name || source.id,
    domain: source.domain || "general",
    type: source.type || "rss",
    url: source.url,
    interval: source.interval || 60000,
    parser: source.parser || "generic",
    tags: source.tags || [],
    enabled: source.enabled !== false,
    headers: source.headers || {},
    timeout: source.timeout || FETCH_TIMEOUT,
    registeredAt: new Date().toISOString(),
    ...(source.autoDisabledAt && { autoDisabledAt: source.autoDisabledAt }),
    ...(source.autoDisableReason && { autoDisableReason: source.autoDisableReason }),
  };

  _feedSources.set(feed.id, feed);
  initHealth(feed.id);

  if (feed.enabled && _running) {
    startFeedTimer(feed);
  }

  return { ok: true, feedId: feed.id };
}

/**
 * Register multiple feed sources at once.
 * @param {object[]} sources
 * @returns {{ registered: number, errors: string[] }}
 */
export function registerFeeds(sources) {
  let registered = 0;
  const errors = [];
  for (const src of sources) {
    const result = registerFeed(src);
    if (result.ok) registered++;
    else errors.push(`${src.id}: ${result.error}`);
  }
  return { registered, errors };
}

/**
 * Enable or disable a feed source.
 * @param {string} feedId
 * @param {boolean} enabled
 */
export function setFeedEnabled(feedId, enabled) {
  const feed = _feedSources.get(feedId);
  if (!feed) return { ok: false, error: "not_found" };
  feed.enabled = !!enabled;
  if (enabled) {
    feed.autoDisabledAt = undefined;
    feed.autoDisableReason = undefined;
    const health = _feedHealth.get(feedId);
    if (health) health.consecutiveFailures = 0;
    if (_running) startFeedTimer(feed);
  } else {
    stopFeedTimer(feedId);
  }
  _feedSources.set(feedId, feed);
  return { ok: true };
}

/**
 * Update polling interval for a feed.
 * @param {string} feedId
 * @param {number} intervalMs
 */
export function setFeedInterval(feedId, intervalMs) {
  const feed = _feedSources.get(feedId);
  if (!feed) return { ok: false, error: "not_found" };
  feed.interval = Math.max(intervalMs, 5000);
  _feedSources.set(feedId, feed);
  if (feed.enabled && _running) startFeedTimer(feed); // restart with new interval
  return { ok: true };
}

/**
 * Remove a feed source entirely.
 * @param {string} feedId
 */
export function removeFeed(feedId) {
  stopFeedTimer(feedId);
  _feedSources.delete(feedId);
  _feedHealth.delete(feedId);
  return { ok: true };
}

/**
 * Get all registered feed sources.
 */
export function listFeeds() {
  return [..._feedSources.values()];
}

/**
 * Get feeds filtered by domain.
 * @param {string} domain
 */
export function listFeedsByDomain(domain) {
  return [..._feedSources.values()].filter(f => f.domain === domain);
}

/**
 * Get health dashboard data for all feeds.
 */
export function getFeedHealthDashboard() {
  const feeds = [..._feedSources.values()];
  const health = [..._feedHealth.values()];

  return {
    totalFeeds: feeds.length,
    activeFeeds: feeds.filter(f => f.enabled).length,
    disabledFeeds: feeds.filter(f => !f.enabled).length,
    autoDisabled: feeds.filter(f => f.autoDisabledAt).length,
    dtusThisHour: _dtuCountThisHour,
    maxDtusPerHour: MAX_DTUS_PER_HOUR,
    running: _running,
    feeds: feeds.map(f => {
      const h = _feedHealth.get(f.id) || {};
      return {
        id: f.id,
        name: f.name,
        domain: f.domain,
        type: f.type,
        url: f.url,
        interval: f.interval,
        enabled: f.enabled,
        autoDisabled: !!f.autoDisabledAt,
        autoDisableReason: f.autoDisableReason || null,
        health: {
          lastSuccess: h.lastSuccess ? new Date(h.lastSuccess).toISOString() : null,
          lastAttempt: h.lastAttempt ? new Date(h.lastAttempt).toISOString() : null,
          lastError: h.lastError || null,
          consecutiveFailures: h.consecutiveFailures || 0,
          totalFetches: h.totalFetches || 0,
          totalErrors: h.totalErrors || 0,
          totalItems: h.totalItems || 0,
          totalDTUsCreated: h.totalDTUsCreated || 0,
          successRate: h.totalFetches > 0 ? ((h.totalFetches - h.totalErrors) / h.totalFetches * 100).toFixed(1) + "%" : "N/A",
        },
      };
    }),
  };
}

/**
 * Get health for a single feed.
 * @param {string} feedId
 */
export function getFeedHealth(feedId) {
  return _feedHealth.get(feedId) || null;
}

/**
 * Test connectivity for a feed source (fetches once without creating DTUs).
 * @param {string} feedIdOrUrl
 */
export async function testFeedConnectivity(feedIdOrUrl) {
  const feedSource = _feedSources.get(feedIdOrUrl) || { id: "test", url: feedIdOrUrl, type: "rss" };
  try {
    const res = await safeFetch(feedSource.url, { timeout: 8000 });
    const contentType = res.headers?.get?.("content-type") || "";
    const status = res.status;
    const size = parseInt(res.headers?.get?.("content-length") || "0", 10);
    const text = await res.text();
    const itemCount = feedSource.type === "json" ? "N/A" : (text.match(/<item>/g) || text.match(/<entry>/g) || []).length;
    return {
      ok: res.ok,
      status,
      contentType,
      size: size || text.length,
      itemCount,
      reachable: true,
      latencyMs: Date.now() - (feedSource._testStart || Date.now()),
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      error: err.message,
      blocked: err.message.includes("abort") || err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND"),
    };
  }
}

/**
 * Start the feed manager — begins all enabled feed timers.
 */
export function startFeedManager() {
  if (_running) return;
  _running = true;
  for (const feed of _feedSources.values()) {
    if (feed.enabled) startFeedTimer(feed);
  }
  logger.info?.("[feed-manager] Started", { feedCount: _feedSources.size, active: [..._feedSources.values()].filter(f => f.enabled).length });
}

/**
 * Stop the feed manager — clears all timers.
 */
export function stopFeedManager() {
  _running = false;
  for (const feedId of _feedTimers.keys()) {
    stopFeedTimer(feedId);
  }
  logger.info?.("[feed-manager] Stopped");
}

/**
 * Force-tick a specific feed (for testing/manual refresh).
 * @param {string} feedId
 */
export async function forceTick(feedId) {
  const feed = _feedSources.get(feedId);
  if (!feed) return { ok: false, error: "not_found" };
  const orig = feed.enabled;
  feed.enabled = true; // temporarily enable for test
  await tickFeed(feedId);
  feed.enabled = orig;
  return { ok: true };
}


// ══════════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default {
  initFeedManager,
  registerFeed,
  registerFeeds,
  setFeedEnabled,
  setFeedInterval,
  removeFeed,
  listFeeds,
  listFeedsByDomain,
  getFeedHealthDashboard,
  getFeedHealth,
  testFeedConnectivity,
  startFeedManager,
  stopFeedManager,
  forceTick,
};
