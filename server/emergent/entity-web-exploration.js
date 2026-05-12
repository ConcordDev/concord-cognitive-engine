import { LruMap, LruSet } from "../lib/lru-map.js";
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

  try {
    const response = await fetch(`${domain}/robots.txt`, {
      headers: { "User-Agent": WEB_POLICY.userAgent },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const text = await response.text();
      const rules = parseRobotsTxt(text);
      robotsCache.set(domain, { rules, fetchedAt: Date.now() });
      return isAllowedByRules(rules, url);
    }

    // No robots.txt = allowed
    robotsCache.set(domain, { rules: { disallow: [], allow: [] }, fetchedAt: Date.now() });
    return true;
  } catch (err) {
    // Can't fetch robots.txt = be cautious, skip
    console.warn('[entity-web-exploration] failed to fetch robots.txt, skipping URL', { domain, err: err.message });
    return false;
  }
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

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": WEB_POLICY.userAgent, ...options.headers },
      signal: AbortSignal.timeout(options.timeout || 10000),
    });
    recordRequest(url);
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
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
  const h = entity.homeostasis;
  const exposure = entity.knowledge.domainExposure;
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

  return `You are entity ${entity.id}, species ${entity.species}.
Your curiosity level: ${entity.homeostasis.curiosity.toFixed(2)}
Your strongest organs: ${topOrgans.join(", ")}
Total explorations: ${entity.knowledge.totalExplorations}

You discovered this from ${finding.source}:
Title: ${finding.title}
Content: ${finding.content}

Synthesize this into a novel insight by connecting it to your existing knowledge.
What is genuinely new or surprising here?
What connections can you draw to other domains?

Return JSON: {
  "title": "your insight title",
  "body": "your synthesized insight (2-3 sentences, novel perspective)",
  "connections": ["domain1", "domain2"],
  "noveltyScore": 0.0-1.0,
  "confidence": 0.0-1.0
}`;
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
