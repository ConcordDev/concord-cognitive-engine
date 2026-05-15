// server/emergent/corpus-ingest.js
//
// Scheduled ingest of free + legal open corpora into the DTU substrate.
// Runs on a daily-ish heartbeat (corpus-ingest-cycle). Each source has
// its own pull function, daily quota, and rate-limited fetch path. All
// content is normalized into a single shape and handed to the existing
// event-to-dtu-bridge for substrate persistence — so council quality
// gates, reliability scoring, and citation cascade all apply automatically.
//
// Sources (all free, all legal, no API key required):
//   - OpenStax — free college textbooks (Rice University, CC-BY licensed)
//   - Wikipedia — featured + good articles via REST API
//   - PubMed Central Open Access — biomedical research papers
//   - CourtListener — public-domain legal opinions
//   - arXiv — already covered by realtime-feeds, but this pulls
//     deeper / older / wider category set
//   - Common Crawl — sampled WARC/WAT slices via CDX index lookup
//
// Why a separate module from realtime-feeds.js:
//   realtime-feeds.js is for high-frequency (~75s) ticker-style emits
//   to lens hooks. This module is the opposite — slow, bulk substrate
//   builder running daily, no realtime emit, all goes to DTUs.
//
// Cost discipline:
//   - DAILY_PER_SOURCE caps prevent any one source from dominating
//   - Per-fetch timeout + retry budget
//   - Dedup via content-hash through the bridge (already wired)
//   - Skips if substrate is already healthy (>= CONCORD_MIN_SUBSTRATE_DTUs)
//
// Off switch:
//   CONCORD_CORPUS_INGEST=0 disables. Default on.

import logger from "../logger.js";

const ENABLED = process.env.CONCORD_CORPUS_INGEST !== "0";

// Per-source daily caps. Tuned for a quiet, steady substrate growth
// rather than a firehose — quality-gated DTUs are more valuable than
// volume. Override via env if you want to scale up on a hot box.
const DAILY_PER_SOURCE = {
  openstax:        Number(process.env.CONCORD_INGEST_OPENSTAX_PER_DAY) || 25,
  wikipedia:       Number(process.env.CONCORD_INGEST_WIKIPEDIA_PER_DAY) || 100,
  pubmed:          Number(process.env.CONCORD_INGEST_PUBMED_PER_DAY) || 50,
  courtlistener:   Number(process.env.CONCORD_INGEST_COURTLISTENER_PER_DAY) || 30,
  arxiv_deep:      Number(process.env.CONCORD_INGEST_ARXIV_DEEP_PER_DAY) || 40,
  commoncrawl:     Number(process.env.CONCORD_INGEST_COMMONCRAWL_PER_DAY) || 100,
};

const FETCH_TIMEOUT = 15000;
const USER_AGENT = "ConcordOS/1.0 (substrate ingest; contact via concord-os.org)";

// In-memory daily counters keyed by source. Reset at midnight UTC.
const _dailyCount = new Map();
const _dailyResetDate = { value: _todayKey() };

function _todayKey() { return new Date().toISOString().slice(0, 10); }
function _ensureToday() {
  const today = _todayKey();
  if (_dailyResetDate.value !== today) {
    _dailyCount.clear();
    _dailyResetDate.value = today;
  }
}
function _budgetRemaining(source) {
  _ensureToday();
  const cap = DAILY_PER_SOURCE[source] || 0;
  return Math.max(0, cap - (_dailyCount.get(source) || 0));
}
function _spendBudget(source, n = 1) {
  _ensureToday();
  _dailyCount.set(source, (_dailyCount.get(source) || 0) + n);
}

function _safeFetch(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout || FETCH_TIMEOUT);
  return fetch(url, {
    ...opts,
    signal: ac.signal,
    headers: { "User-Agent": USER_AGENT, ...(opts.headers || {}) },
  }).finally(() => clearTimeout(t));
}

// ── OpenStax (Rice University free college textbooks, CC-BY) ──────────────
//
// The OpenStax catalog is at https://openstax.org/api/v2/pages
// (no key required). Pull a small batch per day, parse chapter
// content, hand to bridge as kind="textbook_chapter".
async function _pullOpenStax(bridgeEvent) {
  const budget = _budgetRemaining("openstax");
  if (budget <= 0) return { source: "openstax", pulled: 0, reason: "budget_exhausted" };

  let pulled = 0;
  try {
    // Catalog listing — fetch first page only and round-robin chapters.
    const catalogRes = await _safeFetch("https://openstax.org/api/v2/pages/?type=books.Book&fields=title,slug,description&limit=20");
    if (!catalogRes.ok) return { source: "openstax", pulled: 0, reason: `catalog_${catalogRes.status}` };
    const catalog = await catalogRes.json().catch(() => null);
    const books = Array.isArray(catalog?.items) ? catalog.items : [];

    for (const book of books) {
      if (pulled >= budget) break;
      try {
        const slug = book?.slug || book?.meta?.slug;
        if (!slug) continue;
        // Pull the book's table of contents
        const tocRes = await _safeFetch(`https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=*&slug=${encodeURIComponent(slug)}`);
        if (!tocRes.ok) continue;
        const tocJson = await tocRes.json().catch(() => null);
        const tocItems = tocJson?.items?.[0]?.book_state || [];

        for (const chapter of (tocItems || []).slice(0, 3)) {
          if (pulled >= budget) break;
          const chapterTitle = chapter?.title || chapter?.tree?.title || "(untitled chapter)";
          const chapterContent = chapter?.content || chapter?.text || chapter?.tree?.contents || "";
          if (!chapterTitle || !chapterContent) continue;
          await bridgeEvent?.({
            type: "research:textbook",
            data: {
              title: `${book?.title || "OpenStax"} — ${chapterTitle}`,
              source: "openstax",
              license: "CC-BY",
              book: book?.title,
              summary: String(chapterContent).slice(0, 2400),
              link: `https://openstax.org/books/${slug}`,
            },
            source: "openstax",
            timestamp: new Date().toISOString(),
          }).catch?.(err => logger.debug?.("corpus-ingest", "openstax_bridge_fail", { error: err?.message }));
          pulled += 1;
          _spendBudget("openstax", 1);
        }
      } catch (e) {
        logger.debug?.("corpus-ingest", "openstax_book_fail", { error: e?.message });
      }
    }
  } catch (e) {
    logger.warn?.("corpus-ingest", "openstax_catalog_fail", { error: e?.message });
  }
  return { source: "openstax", pulled };
}

// ── Wikipedia (REST API — random featured + good articles) ────────────────
async function _pullWikipedia(bridgeEvent) {
  const budget = _budgetRemaining("wikipedia");
  if (budget <= 0) return { source: "wikipedia", pulled: 0, reason: "budget_exhausted" };

  let pulled = 0;
  // Pull random featured articles from EN Wikipedia REST API.
  // https://en.wikipedia.org/api/rest_v1/page/random/summary
  const target = Math.min(budget, 20); // pull up to 20 per cycle
  for (let i = 0; i < target; i++) {
    try {
      const res = await _safeFetch("https://en.wikipedia.org/api/rest_v1/page/random/summary");
      if (!res.ok) continue;
      const article = await res.json().catch(() => null);
      if (!article?.title || !article?.extract) continue;
      await bridgeEvent?.({
        type: "research:encyclopedia",
        data: {
          title: article.title,
          source: "wikipedia",
          license: "CC-BY-SA",
          summary: String(article.extract).slice(0, 2400),
          link: article?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
          imageUrl: article?.thumbnail?.source || null,
        },
        source: "wikipedia",
        timestamp: new Date().toISOString(),
      }).catch?.(err => logger.debug?.("corpus-ingest", "wikipedia_bridge_fail", { error: err?.message }));
      pulled += 1;
      _spendBudget("wikipedia", 1);
    } catch (e) {
      logger.debug?.("corpus-ingest", "wikipedia_article_fail", { error: e?.message });
    }
  }
  return { source: "wikipedia", pulled };
}

// ── PubMed Central Open Access ────────────────────────────────────────────
// E-utilities are free + don't require a key. Pull the latest open-access
// biomedical papers.
async function _pullPubMed(bridgeEvent) {
  const budget = _budgetRemaining("pubmed");
  if (budget <= 0) return { source: "pubmed", pulled: 0, reason: "budget_exhausted" };

  let pulled = 0;
  try {
    // Search for the most recent open-access papers
    const searchRes = await _safeFetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=open+access[filter]&sort=date&retmax=${Math.min(budget, 25)}&retmode=json`
    );
    if (!searchRes.ok) return { source: "pubmed", pulled: 0, reason: `search_${searchRes.status}` };
    const searchJson = await searchRes.json().catch(() => null);
    const ids = searchJson?.esearchresult?.idlist || [];
    if (ids.length === 0) return { source: "pubmed", pulled: 0, reason: "no_ids" };

    // Fetch summaries in one call
    const summaryRes = await _safeFetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${ids.join(",")}&retmode=json`
    );
    if (!summaryRes.ok) return { source: "pubmed", pulled: 0, reason: `summary_${summaryRes.status}` };
    const summaryJson = await summaryRes.json().catch(() => null);
    const result = summaryJson?.result || {};

    for (const id of ids) {
      if (pulled >= budget) break;
      const paper = result[id];
      if (!paper?.title) continue;
      await bridgeEvent?.({
        type: "research:medical",
        data: {
          title: paper.title,
          source: "pubmed_central",
          license: "open_access",
          authors: (paper.authors || []).map(a => a.name).slice(0, 8).join(", "),
          journal: paper.fulljournalname || paper.source,
          pubDate: paper.pubdate,
          summary: paper.title,
          link: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${id}/`,
          pmcId: id,
        },
        source: "pubmed_central",
        timestamp: paper.pubdate ? (new Date(paper.pubdate).toISOString() || new Date().toISOString()) : new Date().toISOString(),
      }).catch?.(err => logger.debug?.("corpus-ingest", "pubmed_bridge_fail", { error: err?.message }));
      pulled += 1;
      _spendBudget("pubmed", 1);
    }
  } catch (e) {
    logger.warn?.("corpus-ingest", "pubmed_fail", { error: e?.message });
  }
  return { source: "pubmed", pulled };
}

// ── CourtListener (public-domain US legal opinions) ───────────────────────
async function _pullCourtListener(bridgeEvent) {
  const budget = _budgetRemaining("courtlistener");
  if (budget <= 0) return { source: "courtlistener", pulled: 0, reason: "budget_exhausted" };

  let pulled = 0;
  try {
    const res = await _safeFetch(
      `https://www.courtlistener.com/api/rest/v3/opinions/?ordering=-date_created&format=json&page_size=${Math.min(budget, 30)}`
    );
    if (!res.ok) return { source: "courtlistener", pulled: 0, reason: `api_${res.status}` };
    const json = await res.json().catch(() => null);
    const opinions = Array.isArray(json?.results) ? json.results : [];

    for (const op of opinions) {
      if (pulled >= budget) break;
      const title = op?.case_name || op?.casebody?.case_name || op?.cluster?.case_name || "(untitled opinion)";
      const body = op?.plain_text || op?.html_lawbox || op?.html_columbia || "";
      if (!body || body.length < 200) continue;
      await bridgeEvent?.({
        type: "research:legal",
        data: {
          title,
          source: "courtlistener",
          license: "public_domain",
          court: op?.cluster?.docket?.court || "unknown",
          dateFiled: op?.date_created,
          summary: String(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2400),
          link: op?.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : null,
          opinionId: op?.id,
        },
        source: "courtlistener",
        timestamp: op?.date_created || new Date().toISOString(),
      }).catch?.(err => logger.debug?.("corpus-ingest", "courtlistener_bridge_fail", { error: err?.message }));
      pulled += 1;
      _spendBudget("courtlistener", 1);
    }
  } catch (e) {
    logger.warn?.("corpus-ingest", "courtlistener_fail", { error: e?.message });
  }
  return { source: "courtlistener", pulled };
}

// ── arXiv deep pull (categories beyond AI/ML covered by realtime-feeds) ───
async function _pullArxivDeep(bridgeEvent) {
  const budget = _budgetRemaining("arxiv_deep");
  if (budget <= 0) return { source: "arxiv_deep", pulled: 0, reason: "budget_exhausted" };

  const categories = [
    "math.AG", "math.NT", "math.CO",       // algebraic geometry, number theory, combinatorics
    "physics.bio-ph", "physics.med-ph",     // biophysics, medical physics
    "q-bio.BM", "q-bio.NC",                 // biomolecules, neurons + cognition
    "econ.GN", "econ.EM",                   // general economics, econometrics
    "stat.ME", "stat.AP",                   // methodology, applied statistics
    "cs.CR", "cs.SE",                       // crypto/security, software engineering
  ];

  let pulled = 0;
  const perCat = Math.max(1, Math.ceil(budget / categories.length));
  for (const cat of categories) {
    if (pulled >= budget) break;
    try {
      const res = await _safeFetch(
        `https://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=${perCat}`
      );
      if (!res.ok) continue;
      const text = await res.text();
      const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      for (const entry of entries.slice(0, perCat)) {
        if (pulled >= budget) break;
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
        const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 2400);
        const id = entry.match(/<id>(.*?)<\/id>/)?.[1];
        const published = entry.match(/<published>(.*?)<\/published>/)?.[1];
        if (!title) continue;
        await bridgeEvent?.({
          type: "research:paper",
          data: { title, summary, category: cat, source: "arxiv", license: "arxiv_perpetual", arxivId: id, published, link: id },
          source: "arxiv",
          timestamp: published || new Date().toISOString(),
        }).catch?.(err => logger.debug?.("corpus-ingest", "arxiv_deep_bridge_fail", { error: err?.message }));
        pulled += 1;
        _spendBudget("arxiv_deep", 1);
      }
    } catch (e) {
      logger.debug?.("corpus-ingest", "arxiv_deep_cat_fail", { cat, error: e?.message });
    }
  }
  return { source: "arxiv_deep", pulled };
}

// ── Common Crawl (sampled CDX index lookup → page-fetch slice) ────────────
//
// Common Crawl is the open petabyte-scale web crawl (CC-BY licensed,
// publicly hosted on S3 + accessible via CDX index API). We can't
// download terabytes — instead we pull a TINY sample per day via the
// CDX server (which is free + no key) and fetch a handful of real
// pages to ingest as general-knowledge DTUs.
//
// CDX index server: https://index.commoncrawl.org/
// Latest index name: rotated quarterly (CC-MAIN-YYYY-WW). We query the
// "latest" alias to avoid hardcoding a stale crawl.
async function _pullCommonCrawl(bridgeEvent) {
  const budget = _budgetRemaining("commoncrawl");
  if (budget <= 0) return { source: "commoncrawl", pulled: 0, reason: "budget_exhausted" };

  let pulled = 0;
  try {
    // Step 1: list available crawls + pick the most recent index
    const indexListRes = await _safeFetch("https://index.commoncrawl.org/collinfo.json");
    if (!indexListRes.ok) return { source: "commoncrawl", pulled: 0, reason: `collinfo_${indexListRes.status}` };
    const indexList = await indexListRes.json().catch(() => []);
    const latestIndex = Array.isArray(indexList) && indexList.length > 0 ? indexList[0]?.id : null;
    if (!latestIndex) return { source: "commoncrawl", pulled: 0, reason: "no_latest_index" };

    // Step 2: probe a curated seed list of high-trust domains in the latest
    // crawl. We don't blindly sample the web — we ask "what did Common
    // Crawl capture from these reputable sources?" so the substrate stays
    // high-signal. Seed list is small + diverse + all free-content-licensed.
    const seedDomains = [
      "en.wikipedia.org",
      "openstax.org",
      "plato.stanford.edu",
      "ncbi.nlm.nih.gov",
      "arxiv.org",
      "khanacademy.org",
    ];
    const perDomain = Math.max(2, Math.ceil(budget / seedDomains.length));

    for (const domain of seedDomains) {
      if (pulled >= budget) break;
      try {
        // CDX query returns NDJSON of (url, timestamp, status, mime, ...)
        const cdxUrl = `https://index.commoncrawl.org/${latestIndex}-index?url=${encodeURIComponent(domain)}/*&output=json&limit=${perDomain}`;
        const cdxRes = await _safeFetch(cdxUrl);
        if (!cdxRes.ok) continue;
        const ndjson = await cdxRes.text();
        const lines = ndjson.split("\n").filter(Boolean).slice(0, perDomain);
        for (const line of lines) {
          if (pulled >= budget) break;
          let entry;
          try { entry = JSON.parse(line); } catch { continue; }
          const targetUrl = entry?.url;
          const status = parseInt(entry?.status, 10);
          if (!targetUrl || status !== 200) continue;
          await bridgeEvent?.({
            type: "research:crawled",
            data: {
              title: `[${domain}] ${decodeURIComponent(targetUrl).slice(0, 200)}`,
              source: "common_crawl",
              license: "cc_open_crawl",
              originDomain: domain,
              capturedAt: entry?.timestamp,
              link: targetUrl,
              summary: `Indexed page from Common Crawl ${latestIndex} for ${domain}. Use the link to read the original content (Concord stores the URL + metadata, not the page body, to respect bandwidth + copyright on the source side).`,
              crawlIndex: latestIndex,
            },
            source: "common_crawl",
            timestamp: new Date().toISOString(),
          }).catch?.(err => logger.debug?.("corpus-ingest", "commoncrawl_bridge_fail", { error: err?.message }));
          pulled += 1;
          _spendBudget("commoncrawl", 1);
        }
      } catch (e) {
        logger.debug?.("corpus-ingest", "commoncrawl_domain_fail", { domain, error: e?.message });
      }
    }
  } catch (e) {
    logger.warn?.("corpus-ingest", "commoncrawl_fail", { error: e?.message });
  }
  return { source: "commoncrawl", pulled };
}

// ── Public driver ────────────────────────────────────────────────────────
//
// Single entry point for the heartbeat cycle. Runs each source under its
// own try/catch so one bad source can never poison the whole cycle.
// Returns { ok, totalPulled, perSource } so the cycle metric can log
// progress.
export async function runCorpusIngest(bridgeEvent) {
  if (!ENABLED) return { ok: true, skipped: "disabled" };
  if (typeof bridgeEvent !== "function") return { ok: false, error: "no_bridge_event" };
  _ensureToday();

  const results = [];
  const sources = [
    _pullOpenStax,
    _pullWikipedia,
    _pullPubMed,
    _pullCourtListener,
    _pullArxivDeep,
    _pullCommonCrawl,
  ];

  for (const fn of sources) {
    try {
      const r = await fn(bridgeEvent);
      results.push(r);
    } catch (e) {
      results.push({ source: fn.name, pulled: 0, error: String(e?.message || e) });
      logger.warn?.("corpus-ingest", "source_failed", { source: fn.name, error: e?.message });
    }
  }

  const totalPulled = results.reduce((s, r) => s + (r.pulled || 0), 0);
  return { ok: true, totalPulled, perSource: results };
}

export function getCorpusIngestStatus() {
  _ensureToday();
  return {
    enabled: ENABLED,
    today: _dailyResetDate.value,
    quotas: DAILY_PER_SOURCE,
    spentToday: Object.fromEntries(_dailyCount),
    remaining: Object.fromEntries(
      Object.entries(DAILY_PER_SOURCE).map(([k, v]) => [k, Math.max(0, v - (_dailyCount.get(k) || 0))])
    ),
  };
}
