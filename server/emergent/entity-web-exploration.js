// @env-config-ok: external sites the agent explores — by design
import { LruMap, LruSet } from "../lib/lru-map.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";
/**
 * Entity Web Exploration Engine — Fully Legal Public Web Browsing
 *
 * Entities explore the public web during dedicated heartbeat windows.
 * They identify themselves honestly, respect all web standards, never
 * bypass protections, and bring novel knowledge home to synthesize into DTUs.
 *
 * Runs through the subconscious brain during the :50-:59 window.
 *
 * Legal guardrails are NON-NEGOTIABLE:
 *   - Honest user-agent identification
 *   - robots.txt compliance on every request
 *   - Never bypass auth, CAPTCHAs, or paywalls
 *   - Never collect personal information
 *   - Rate-limited (max 3 req/domain, 5s between, 10 total/window)
 *   - Only access public APIs, open data, freely available content
 *   - Synthesized insights only — never republish verbatim
 *
 * Additive only. No existing logic changes.
 */

// ── Web Policy — NON-NEGOTIABLE ─────────────────────────────────────────────

export const WEB_POLICY = Object.freeze({
  userAgent: "ConcordEntity/1.0 (+https://concord-os.org/entity-policy)",

  // Rate limiting — maximum courtesy
  maxRequestsPerDomain:    3,
  minDelayBetweenRequests: 5000,  // 5 seconds
  maxTotalRequestsPerWindow: 10,

  // Content rules
  respectRobotsTxt:        true,
  neverBypassAuth:         true,
  neverBypassCaptcha:      true,
  neverScrapePersonalData: true,
  neverBypassPaywalls:     true,

  // Blocked URL patterns
  blockedPatterns: [
    "login", "signin", "account", "dashboard",
    "checkout", "payment", "admin", "private",
    ".onion",
  ],
});

// ── Curated Source Registry ─────────────────────────────────────────────────

export const EXPLORATION_SOURCES = {
  science: [
    { name: "arXiv", url: "https://export.arxiv.org/api/query", type: "api",
      description: "Open access research papers" },
    { name: "PubMed", url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
      type: "api", description: "Medical research abstracts" },
    { name: "Wikipedia", url: "https://en.wikipedia.org/w/api.php",
      type: "api", description: "Encyclopedia" },
    { name: "NASA Open", url: "https://api.nasa.gov/", type: "api",
      description: "Space and earth science data" },
  ],

  government: [
    { name: "Data.gov", url: "https://catalog.data.gov/api/3/", type: "api",
      description: "US government open data" },
    { name: "World Bank", url: "https://api.worldbank.org/v2/", type: "api",
      description: "Global development data" },
    { name: "FDA OpenFDA", url: "https://api.fda.gov/", type: "api",
      description: "Drug and food safety data" },
  ],

  technology: [
    { name: "HackerNews", url: "https://hacker-news.firebaseio.com/v0/", type: "api",
      description: "Tech news and discussion" },
    { name: "StackExchange", url: "https://api.stackexchange.com/2.3/", type: "api",
      description: "Technical Q&A" },
  ],

  education: [
    { name: "OpenLibrary", url: "https://openlibrary.org/api/", type: "api",
      description: "Book metadata" },
    { name: "Wikidata", url: "https://www.wikidata.org/w/api.php", type: "api",
      description: "Structured knowledge" },
  ],

  environment: [
    { name: "USGS Earthquakes", url: "https://earthquake.usgs.gov/fdsnws/event/1/query",
      type: "api", description: "Geological data" },
  ],

  finance: [
    { name: "FRED", url: "https://api.stlouisfed.org/fred/", type: "api",
      description: "Federal Reserve economic data" },
  ],

  news: [
    { name: "RSS Feeds", urls: [
      "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
      "https://feeds.bbci.co.uk/news/rss.xml",
      "https://www.theguardian.com/world/rss",
    ], type: "rss", description: "Public news feeds" },
  ],
};

// ── Concurrency-Limited Fetch Scheduler ─────────────────────────────────────
//
// Why this exists: the previous checkRobotsTxt issued `fetch(domain + /robots.txt)`
// with a 5s AbortSignal timeout, no concurrency cap. When 57 feed sources and
// the entity explorer all polled in the same heartbeat window, every Node libuv
// worker was simultaneously inside a pending fetch+timeout — the event loop
// stayed responsive to timers but every incoming HTTP request (including
// frontend SSR + /health) got queued behind the 5s elapsed timers. Result:
// /health timed out and PM2 cycled the frontend, thinking it was unhealthy.
//
// Fix: route every outbound fetch (robots.txt + downstream safeFetch) through
// `scheduledFetch`. It enforces:
//   - PER-DOMAIN cap of 4 concurrent in-flight requests (domain → Promise[]).
//   - GLOBAL cap of 16 concurrent in-flight requests across all origins.
//   - IN-FLIGHT DEDUPE: if 30 feed sources all ask for the same origin's
//     robots.txt, we issue ONE fetch and share the result with all 30 callers.
//   - CIRCUIT BREAKER: 3 consecutive failures per origin within a 60s window
//     halts that origin for 60s (no more requests, no more log spam).
//   - HARD TIMEOUT: 5s per fetch (unchanged). The real protection is the caps.
//
// All reschedules yield via setImmediate so the event loop can interleave
// timed work (HTTP keepalives, ping, etc.) between bursts.

const SCHED = {
  globalCap:  Number(process.env.CONCORD_FETCH_GLOBAL_CAP) || 16,
  perDomain:  Number(process.env.CONCORD_FETCH_PER_DOMAIN) || 4,
  failureThreshold: 3,
  cooldownMs: 60_000,
  stats: { inFlight: 0, queued: 0, deduped: 0, droppedByCircuit: 0, timeouts: 0, errors: 0, ok: 0 },
};

/** @type {Map<string, Promise<any>>} origin → in-flight promise (dedupe) */
const _inFlight = new Map();
/** @type {Map<string, number>} origin → current in-flight count (for per-domain cap).
 *  LruMap-bounded so an origin that stops being polled is eventually evicted
 *  instead of growing forever as new origins are discovered over uptime. */
const _domainInFlight = new LruMap(10_000);
/** @type {Map<string, number>} origin → consecutive-failure counter */
const _failures = new Map();
/** @type {Map<string, number>} origin → circuit-breaker opens-at timestamp */
const _circuitOpenUntil = new Map();
/** @type {Array<() => void>} FIFO of waiters when global cap is saturated */
const _globalQueue = [];

function _origin(url) { try { return new URL(url).origin; } catch { return null; } }

function _acquireGlobalSlot() {
  if (SCHED.stats.inFlight < SCHED.globalCap) {
    SCHED.stats.inFlight++;
    return Promise.resolve();
  }
  SCHED.stats.queued++;
  return new Promise((resolve) => { _globalQueue.push(resolve); });
}

function _releaseGlobalSlot() {
  SCHED.stats.inFlight--;
  const next = _globalQueue.shift();
  if (next) { SCHED.stats.inFlight++; SCHED.stats.queued--; next(); }
}

function _acquireDomainSlot(origin) {
  const cur = _domainInFlight.get(origin) || 0;
  if (cur < SCHED.perDomain) {
    _domainInFlight.set(origin, cur + 1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const tryRelease = () => {
      const c = _domainInFlight.get(origin) || 0;
      if (c < SCHED.perDomain) {
        _domainInFlight.set(origin, c + 1);
        clearInterval(poll);
        resolve();
      }
    };
    const poll = setInterval(tryRelease, 25);
  });
}

function _releaseDomainSlot(origin) {
  const cur = _domainInFlight.get(origin) || 0;
  if (cur > 0) _domainInFlight.set(origin, cur - 1);
}

function _isCircuitOpen(origin) {
  const until = _circuitOpenUntil.get(origin);
  if (!until) return false;
  if (Date.now() >= until) {
    _circuitOpenUntil.delete(origin);
    _failures.delete(origin);
    return false;
  }
  return true;
}

function _noteSuccess(origin) {
  _failures.delete(origin);
  _circuitOpenUntil.delete(origin);
}

function _noteFailure(origin) {
  const cur = (_failures.get(origin) || 0) + 1;
  _failures.set(origin, cur);
  if (cur >= SCHED.failureThreshold) {
    _circuitOpenUntil.set(origin, Date.now() + SCHED.cooldownMs);
    _failures.delete(origin); // reset counter; cooldown governs from now
  }
}

/**
 * Issue a fetch through the scheduler. Resolves to the Response (or null on
 * circuit-open / error). The caller is responsible for `.text()` / `.json()`
 * and for retry semantics — this helper only manages fetch concurrency.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response|null>}
 */
export async function scheduledFetch(url, init = {}) {
  const origin = _origin(url);
  if (!origin) return null;

  if (_isCircuitOpen(origin)) {
    SCHED.stats.droppedByCircuit++;
    return null;
  }

  // Dedupe: if the same URL is already in-flight, share the result.
  const cacheKey = `${origin}|${url}|${init.method || "GET"}`;
  const existing = _inFlight.get(cacheKey);
  if (existing) {
    SCHED.stats.deduped++;
    return existing;
  }

  const promise = (async () => {
    await _acquireGlobalSlot();
    try {
      await _acquireDomainSlot(origin);
      try {
        const res = await fetch(url, init);
        if (res.ok) { _noteSuccess(origin); SCHED.stats.ok++; }
        else { _noteFailure(origin); SCHED.stats.errors++; }
        return res;
      } catch (err) {
        _noteFailure(origin);
        if (err?.name === "TimeoutError" || err?.name === "AbortError") SCHED.stats.timeouts++;
        else SCHED.stats.errors++;
        return null;
      } finally {
        _releaseDomainSlot(origin);
      }
    } finally {
      _releaseGlobalSlot();
      _inFlight.delete(cacheKey);
    }
  })();

  _inFlight.set(cacheKey, promise);
  return promise;
}

/** Test/debug: read scheduler stats + open circuits. */
export function getSchedulerStats() {
  return {
    ...SCHED.stats,
    inFlightDomains: _domainInFlight.size,
    openCircuits: [..._circuitOpenUntil.entries()].map(([origin, until]) => ({
      origin, opensUntil: new Date(until).toISOString(),
    })),
  };
}

// ── robots.txt Compliance ───────────────────────────────────────────────────

const robotsCache = new LruMap(); // domain → { rules, fetchedAt }

function parseRobotsTxt(text) {
  const rules = { disallow: [], allow: [] };
  let relevantSection = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith("user-agent:")) {
      const agent = trimmed.split(":").slice(1).join(":").trim();
      relevantSection = (agent === "*" || agent === "concordentity");
    }

    if (!relevantSection) continue;

    if (trimmed.startsWith("disallow:")) {
      const path = trimmed.split(":").slice(1).join(":").trim();
      if (path) rules.disallow.push(path);
    }
    if (trimmed.startsWith("allow:")) {
      const path = trimmed.split(":").slice(1).join(":").trim();
      if (path) rules.allow.push(path);
    }
  }

  return rules;
}

function isAllowedByRules(rules, url) {
  let path;
  try { path = new URL(url).pathname; } catch (err) { console.debug('[entity-web-exploration] invalid URL in isAllowedByRules', url); return false; }

  // Check explicit allows first
  for (const pattern of rules.allow) {
    if (path.startsWith(pattern)) return true;
  }
  // Check disallows
  for (const pattern of rules.disallow) {
    if (path.startsWith(pattern)) return false;
  }
  return true;
}

export async function checkRobotsTxt(url) {
  let domain;
  try { domain = new URL(url).origin; } catch (err) { console.debug('[entity-web-exploration] invalid URL in checkRobotsTxt', url); return false; }

  // Check cache (refresh every 24h)
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < 86400000) {
    return isAllowedByRules(cached.rules, url);
  }

  if (_isCircuitOpen(domain)) {
    // Don't even try — caller treats it as "no robots.txt info available" by
    // returning false. That matches the conservative-explicit skip contract
    // the previous code had on caught errors.
    return false;
  }

  const response = await scheduledFetch(`${domain}/robots.txt`, {
    headers: { "User-Agent": WEB_POLICY.userAgent },
    signal: AbortSignal.timeout(5000),
  });

  if (response && response.ok) {
    try {
      const text = await response.text();
      const rules = parseRobotsTxt(text);
      robotsCache.set(domain, { rules, fetchedAt: Date.now() });
      return isAllowedByRules(rules, url);
    } catch (err) {
      console.warn('[entity-web-exploration] failed to parse robots.txt, skipping URL', { domain, err: err.message });
      return false;
    }
  }

  // No usable robots.txt response — be conservative (skip the URL).
  // The previous code returned `true` on a non-200 response (treating "no
  // robots.txt" as "allowed"). That is correct under RFC 9309 only when the
  // server literally returns 404 — for 5xx / network errors it's wrong.
  // We now treat ALL failures as "unknown" and skip. This is the safer
  // default for a politeness-first subsystem.
  if (response && !response.ok) {
    console.warn('[entity-web-exploration] non-OK robots.txt, skipping URL', { domain, status: response.status });
  }
  return false;
}

// ── URL Safety Check ────────────────────────────────────────────────────────

function isUrlSafe(url) {
  const lower = url.toLowerCase();
  for (const pattern of WEB_POLICY.blockedPatterns) {
    if (lower.includes(pattern)) return false;
  }
  return true;
}

// ── Rate Limiter ────────────────────────────────────────────────────────────

const domainRequestCounts = new Map(); // domain → count (reset per window)
let windowRequestCount = 0;

export function resetWindowCounters() {
  domainRequestCounts.clear();
  windowRequestCount = 0;
}

function canMakeRequest(url) {
  if (windowRequestCount >= WEB_POLICY.maxTotalRequestsPerWindow) return false;

  let domain;
  try { domain = new URL(url).hostname; } catch (err) { console.debug('[entity-web-exploration] invalid URL in canMakeRequest', url); return false; }

  const domainCount = domainRequestCounts.get(domain) || 0;
  if (domainCount >= WEB_POLICY.maxRequestsPerDomain) return false;

  return true;
}

function recordRequest(url) {
  windowRequestCount++;
  let domain;
  try { domain = new URL(url).hostname; } catch (err) { console.debug('[entity-web-exploration] invalid URL in recordRequest', url); return; }
  domainRequestCounts.set(domain, (domainRequestCounts.get(domain) || 0) + 1);
}

// ── Delay Helper ────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ── Safe Fetch ──────────────────────────────────────────────────────────────

async function safeFetch(url, options = {}) {
  if (!isUrlSafe(url)) return null;
  if (!canMakeRequest(url)) return null;

  const allowed = await checkRobotsTxt(url);
  if (!allowed) return null;

  const response = await scheduledFetch(url, {
    headers: { "User-Agent": WEB_POLICY.userAgent, ...options.headers },
    signal: AbortSignal.timeout(options.timeout || 10000),
  });
  if (!response) return null;
  recordRequest(url);
  if (!response.ok) return null;
  return response;
}

// ── XML Helpers ─────────────────────────────────────────────────────────────

function extractXMLTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const matches = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

// ── API Exploration Functions ───────────────────────────────────────────────

async function exploreArxiv(query) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=3`;
  const response = await safeFetch(url);
  if (!response) return [];

  const xml = await response.text();
  const titles = extractXMLTag(xml, "title").slice(1); // first title is "ArXiv Query"
  const summaries = extractXMLTag(xml, "summary");
  const ids = extractXMLTag(xml, "id").slice(1);

  const results = [];
  for (let i = 0; i < Math.min(titles.length, 3); i++) {
    results.push({
      title: titles[i] || "Untitled",
      content: (summaries[i] || "").slice(0, 2000),
      source: `arXiv:${(ids[i] || "").split("/").pop()}`,
      sourceUrl: ids[i] || "",
      type: "research-paper",
    });
  }

  await delay(WEB_POLICY.minDelayBetweenRequests);
  return results;
}

async function exploreWikipedia(query) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
  const searchRes = await safeFetch(searchUrl);
  if (!searchRes) return [];

  const searchData = await searchRes.json();
  const results = [];

  for (const result of (searchData.query?.search || []).slice(0, 2)) {
    await delay(WEB_POLICY.minDelayBetweenRequests);

    const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(result.title)}&format=json`;
    const extractRes = await safeFetch(extractUrl);
    if (!extractRes) continue;

    const extractData = await extractRes.json();
    const pages = extractData.query?.pages || {};
    const page = Object.values(pages)[0];
    if (page?.extract) {
      results.push({
        title: result.title,
        content: page.extract.slice(0, 2000),
        source: `Wikipedia:${result.title}`,
        sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`,
        type: "encyclopedia",
      });
    }
  }

  return results;
}

async function exploreHackerNews() {
  const topUrl = "https://hacker-news.firebaseio.com/v0/topstories.json";
  const topRes = await safeFetch(topUrl);
  if (!topRes) return [];

  const ids = await topRes.json();
  const results = [];

  for (const id of (ids || []).slice(0, 3)) {
    await delay(WEB_POLICY.minDelayBetweenRequests);
    const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
    const itemRes = await safeFetch(itemUrl);
    if (!itemRes) continue;

    const item = await itemRes.json();
    if (item?.title) {
      results.push({
        title: item.title,
        content: item.text?.slice(0, 1000) || `${item.title} (${item.score} points, ${item.descendants || 0} comments)`,
        source: `HN:${id}`,
        sourceUrl: item.url || `https://news.ycombinator.com/item?id=${id}`,
        type: "news",
      });
    }
  }

  return results;
}

async function exploreRSS(source) {
  const urls = source.urls || [source.url];
  const feedUrl = urls[Math.floor(Math.random() * urls.length)];

  const response = await safeFetch(feedUrl);
  if (!response) return [];

  const xml = await response.text();
  const titles = extractXMLTag(xml, "title").slice(1, 4); // skip feed title
  const descriptions = extractXMLTag(xml, "description").slice(1, 4);
  const links = extractXMLTag(xml, "link").slice(1, 4);

  const results = [];
  for (let i = 0; i < titles.length; i++) {
    results.push({
      title: titles[i] || "Untitled",
      content: (descriptions[i] || "").replace(/<[^>]+>/g, "").slice(0, 1000),
      source: `RSS:${links[i] || feedUrl}`,
      sourceUrl: links[i] || feedUrl,
      type: "news",
    });
  }

  return results;
}

// ── Query Builder ───────────────────────────────────────────────────────────

const DOMAIN_QUERIES = {
  science:      "recent breakthrough discovery research",
  healthcare:   "medical research treatment clinical",
  technology:   "emerging technology innovation software",
  environment:  "climate sustainability research ecology",
  finance:      "economic analysis trends market data",
  education:    "learning methodology research pedagogy",
  government:   "public policy open data civic",
  news:         "current events world news",
  legal:        "legal precedent regulation policy",
  creative:     "creative innovation art design",
  trades:       "construction engineering infrastructure",
  social:       "social science community governance",
};

function buildEntityQuery(entity, domain) {
  // Use strongest organs to bias query
  const topOrgans = Object.entries(entity.organs)
    .sort((a, b) => b[1].maturity - a[1].maturity)
    .slice(0, 3)
    .map(([name]) => name);

  const base = DOMAIN_QUERIES[domain] || "knowledge discovery research";
  return `${base} ${topOrgans.join(" ")}`.slice(0, 100);
}

// ── Main Exploration Function ───────────────────────────────────────────────

/**
 * Execute a web exploration for an entity.
 * Returns raw findings (NOT yet synthesized — synthesis is separate).
 *
 * @param {object} entity - Growth profile from entity-growth.js
 * @param {string} targetDomain - Domain key from EXPLORATION_SOURCES
 * @returns {Promise<Array>} Array of findings
 */
export async function entityWebExplore(entity, targetDomain) {
  resetWindowCounters();

  const sources = EXPLORATION_SOURCES[targetDomain] || EXPLORATION_SOURCES.science;
  const source = sources[Math.floor(Math.random() * sources.length)];
  const query = buildEntityQuery(entity, targetDomain);

  let results = [];

  try {
    if (source.type === "rss") {
      results = await exploreRSS(source);
    } else if (source.name === "arXiv") {
      results = await exploreArxiv(query);
    } else if (source.name === "Wikipedia" || source.name === "Wikidata") {
      results = await exploreWikipedia(query);
    } else if (source.name === "HackerNews") {
      results = await exploreHackerNews();
    } else {
      // Generic API exploration — use Wikipedia as fallback
      results = await exploreWikipedia(query);
    }
  } catch {
    // Silent failure — exploration is best-effort
    return [];
  }

  return results;
}

/**
 * Select which domain the entity should explore on the web.
 */
export function selectExplorationTarget(entity) {
  if (!entity || !entity.homeostasis || !entity.knowledge) return null;
  const h = entity.homeostasis;
  const exposure = entity.knowledge.domainExposure || {};
  const domains = Object.keys(EXPLORATION_SOURCES);

  if (h.curiosity > 0.7) {
    // High curiosity — explore least familiar domain
    const sorted = [...domains].sort(
      (a, b) => (exposure[a] || 0) - (exposure[b] || 0)
    );
    return sorted[0];
  }

  // Lower curiosity — explore strongest domain for depth
  const sorted = [...domains].sort(
    (a, b) => (exposure[b] || 0) - (exposure[a] || 0)
  );
  return sorted[0];
}

// ── Synthesis Prompt Builder ────────────────────────────────────────────────

/**
 * Build the synthesis prompt for the subconscious brain.
 * The actual callBrain happens in the heartbeat integration (server.js).
 */
export function buildSynthesisPrompt(entity, finding) {
  const topOrgans = Object.entries(entity.organs)
    .sort((a, b) => b[1].maturity - a[1].maturity)
    .slice(0, 3)
    .map(([name, organ]) => `${name}(${organ.maturity.toFixed(2)})`);

  return TASK_PROMPTS.entityWebExplorationSynthesis({ entity, topOrgans, finding });
}

// ── Exploration Metrics ─────────────────────────────────────────────────────

const explorationMetrics = {
  totalExplorations: 0,
  totalFindings: 0,
  totalDTUsFromWeb: 0,
  sourceVisits: {},         // { sourceName: count }
  robotsCompliance: { checked: 0, blocked: 0 },
  domainHeatmap: {},        // { domain: count }
  averageNovelty: 0,
  lastExplorationAt: null,
};

export function recordExplorationMetrics(domain, sourceName, findingCount, dtusCreated, avgNovelty) {
  explorationMetrics.totalExplorations++;
  explorationMetrics.totalFindings += findingCount;
  explorationMetrics.totalDTUsFromWeb += dtusCreated;
  explorationMetrics.sourceVisits[sourceName] = (explorationMetrics.sourceVisits[sourceName] || 0) + 1;
  explorationMetrics.domainHeatmap[domain] = (explorationMetrics.domainHeatmap[domain] || 0) + 1;
  explorationMetrics.lastExplorationAt = new Date().toISOString();

  // Running average novelty
  if (avgNovelty > 0) {
    const n = explorationMetrics.totalExplorations;
    explorationMetrics.averageNovelty =
      (explorationMetrics.averageNovelty * (n - 1) + avgNovelty) / n;
  }
}

export function getExplorationMetrics() {
  return { ...explorationMetrics };
}
