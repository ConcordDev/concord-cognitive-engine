// server/domains/wikipedia-search.js
//
// Phase 4 (fourth wave) — Wikipedia full-text search REAL_FREE wire.
//
// Wikimedia REST API is free, polite User-Agent recommended, no key.
// Powers two macros that any lens can register against:
//
//   <domain>.live_wiki_search  → SearchResults page-summary, with
//                                page intro extracts + thumbnails.
//   <domain>.live_wiki_summary → single page summary (intro extract,
//                                description, image) by page title.
//
// We register against the most-likely-helpful lenses:
//   - history (already has live_wiki_otd; this adds general search)
//   - encyclopedia (general knowledge)
//   - philosophy (concept lookup)
//   - linguistics (term lookup)
//   - education (curriculum reference)
//   - desert / ocean / neuro (domain reference, alongside their bespoke wires)

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "ConcordOS/5.0 (+https://concord-os.org; mailto:hello@concord-os.org)";

async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default function registerWikipediaSearchMacros(register) {
  // ─────────────────────────────────────────────────────────────────────
  // live_wiki_search — opensearch + page-summary join
  // ─────────────────────────────────────────────────────────────────────
  const wikiSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 200) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 20);
    const lang = String(input.lang || "en").toLowerCase().slice(0, 8);
    try {
      // 1. Use the opensearch endpoint to get titles + descriptions + URLs.
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${limit}&search=${encodeURIComponent(q)}`;
      const data = await fetchJsonWithTimeout(searchUrl, { headers: { "User-Agent": USER_AGENT } });
      // opensearch returns [query, [titles], [descriptions], [urls]]
      if (!Array.isArray(data) || data.length < 4) {
        return { ok: true, source: "Wikipedia", fetchedAt: Math.floor(Date.now() / 1000), query: q, results: [] };
      }
      const titles = data[1] || [];
      const descriptions = data[2] || [];
      const urls = data[3] || [];

      // 2. Fan out: fetch page-summary for each title (parallel, capped).
      const summaries = await Promise.all(titles.slice(0, limit).map(async (title) => {
        try {
          const sumUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
          const sum = await fetchJsonWithTimeout(sumUrl, { headers: { "User-Agent": USER_AGENT } });
          return {
            title: sum.title || title,
            description: sum.description || null,
            extract: sum.extract || null,
            thumbnail: sum.thumbnail?.source || null,
            url: sum.content_urls?.desktop?.page || null,
            mobileUrl: sum.content_urls?.mobile?.page || null,
            wikibaseItem: sum.wikibase_item || null,
            type: sum.type || null,
            lang,
          };
        } catch {
          return null;
        }
      }));

      const results = summaries.map((s, i) => s || {
        title: titles[i],
        description: descriptions[i] || null,
        extract: null,
        thumbnail: null,
        url: urls[i] || null,
        mobileUrl: null,
        wikibaseItem: null,
        type: null,
        lang,
      });

      return {
        ok: true,
        source: "Wikipedia",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        lang,
        total: results.length,
        results,
      };
    } catch (e) {
      return { ok: false, reason: "wikipedia_unreachable", error: String(e?.message || e) };
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // live_wiki_summary — single page summary by title
  // ─────────────────────────────────────────────────────────────────────
  const wikiSummary = async (_ctx, input = {}) => {
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, reason: "missing_title" };
    if (title.length > 200) return { ok: false, reason: "title_too_long" };
    const lang = String(input.lang || "en").toLowerCase().slice(0, 8);
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const sum = await fetchJsonWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
      return {
        ok: true,
        source: "Wikipedia",
        fetchedAt: Math.floor(Date.now() / 1000),
        title: sum.title || title,
        description: sum.description || null,
        extract: sum.extract || null,
        extractHtml: sum.extract_html || null,
        thumbnail: sum.thumbnail?.source || null,
        url: sum.content_urls?.desktop?.page || null,
        lang,
        type: sum.type || null,
      };
    } catch (e) {
      return { ok: false, reason: "wikipedia_unreachable", error: String(e?.message || e) };
    }
  };

  // Register against a curated set of lenses where a Wikipedia surface
  // is immediately helpful.
  const SEARCH_LENSES = [
    "history", "philosophy", "linguistics", "education",
    "desert", "ocean", "neuro", "geology", "space", "global",
  ];
  for (const lens of SEARCH_LENSES) {
    register(lens, "live_wiki_search", wikiSearch, { note: `live Wikipedia search for ${lens}` });
    register(lens, "live_wiki_summary", wikiSummary, { note: `live Wikipedia summary for ${lens}` });
  }
}
