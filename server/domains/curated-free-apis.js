// server/domains/curated-free-apis.js
//
// Phase 4 (fifth wave) — curated REAL free-API wires for hero lens
// surfaces that benefit from genuine real-world content.
//
// All sources are public, no API key, no signup. Real data end-to-end.
//
// Wires:
//   astronomy.live_spaceflight_news   Spaceflight News API v4
//   space.live_spaceflight_news       Spaceflight News API v4 (shared)
//   astronomy.live_launches_upcoming  Launch Library 2 (upcoming launches)
//   space.live_launches_upcoming      Launch Library 2 (shared)
//   poetry.live_poetrydb              PoetryDB (titles, authors, lines)
//   game.live_trivia                  Open Trivia DB
//   daily.live_quote                  Quotable (random famous quotes)
//   reflection.live_quote             Quotable (shared)
//   pets.live_catfact                 Cat Facts API (real cat facts)
//
// Each handler attributes its source explicitly and returns
// { ok:false, reason } on upstream failure — never fakes.

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

export default function registerCuratedFreeApiMacros(register) {
  // ─────────────────────────────────────────────────────────────────────
  // SPACEFLIGHT NEWS API v4 — real space news, free, no key
  // ─────────────────────────────────────────────────────────────────────
  const spaceflightNews = async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 30);
    const q = String(input.query || "").trim();
    let url = `https://api.spaceflightnewsapi.net/v4/articles/?limit=${limit}`;
    if (q) {
      if (q.length > 100) return { ok: false, reason: "query_too_long" };
      url += `&search=${encodeURIComponent(q)}`;
    }
    try {
      const data = await fetchJsonWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
      const articles = (data.results || []).map(a => ({
        id: a.id,
        title: a.title,
        url: a.url,
        imageUrl: a.image_url || null,
        newsSite: a.news_site || null,
        summary: a.summary || null,
        publishedAt: a.published_at || null,
        updatedAt: a.updated_at || null,
        featured: !!a.featured,
      }));
      return {
        ok: true,
        source: "Spaceflight News API v4",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: data.count || articles.length,
        query: q || null,
        articles,
      };
    } catch (e) {
      return { ok: false, reason: "spaceflight_news_unreachable", error: String(e?.message || e) };
    }
  };
  register("astronomy", "live_spaceflight_news", spaceflightNews, { note: "live Spaceflight News articles" });
  register("space", "live_spaceflight_news", spaceflightNews, { note: "live Spaceflight News articles" });

  // ─────────────────────────────────────────────────────────────────────
  // LAUNCH LIBRARY 2 — upcoming launches (free, light rate limit)
  // ─────────────────────────────────────────────────────────────────────
  const upcomingLaunches = async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 20);
    const url = `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=${limit}&mode=normal`;
    try {
      const data = await fetchJsonWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
      const launches = (data.results || []).map(l => ({
        id: l.id,
        name: l.name,
        statusName: l.status?.name || null,
        statusAbbrev: l.status?.abbrev || null,
        net: l.net || null,
        windowStart: l.window_start || null,
        windowEnd: l.window_end || null,
        launchProvider: l.launch_service_provider?.name || null,
        rocket: l.rocket?.configuration?.full_name || null,
        missionDescription: l.mission?.description || null,
        missionType: l.mission?.type || null,
        padName: l.pad?.name || null,
        padLocation: l.pad?.location?.name || null,
        imageUrl: l.image || null,
        webcastLive: !!l.webcast_live,
      }));
      return {
        ok: true,
        source: "Launch Library 2 (theSpaceDevs)",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: data.count || launches.length,
        launches,
      };
    } catch (e) {
      return { ok: false, reason: "launchlib_unreachable", error: String(e?.message || e) };
    }
  };
  register("astronomy", "live_launches_upcoming", upcomingLaunches, { note: "live upcoming launches" });
  register("space", "live_launches_upcoming", upcomingLaunches, { note: "live upcoming launches" });

  // ─────────────────────────────────────────────────────────────────────
  // POETRYDB — public domain poems, free, no key
  // ─────────────────────────────────────────────────────────────────────
  register("poetry", "live_poetrydb", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    const queryKind = String(input.kind || "title").toLowerCase();
    const ALLOWED_KINDS = ["title", "author", "lines"];
    if (!ALLOWED_KINDS.includes(queryKind)) return { ok: false, reason: "invalid_kind" };
    if (q && q.length > 100) return { ok: false, reason: "query_too_long" };
    let url;
    if (q) {
      url = `https://poetrydb.org/${queryKind}/${encodeURIComponent(q)}`;
    } else {
      url = `https://poetrydb.org/random/12`;
    }
    try {
      const data = await fetchJsonWithTimeout(url);
      // PoetryDB returns either an array of poems OR { status, reason } on miss.
      const poems = Array.isArray(data) ? data.slice(0, 25).map(p => ({
        title: p.title,
        author: p.author,
        lineCount: parseInt(p.linecount, 10) || (p.lines?.length ?? 0),
        lines: p.lines || [],
      })) : [];
      return {
        ok: true,
        source: "PoetryDB",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q || null,
        kind: queryKind,
        total: poems.length,
        poems,
      };
    } catch (e) {
      return { ok: false, reason: "poetrydb_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live PoetryDB public-domain poem search" });

  // ─────────────────────────────────────────────────────────────────────
  // OPEN TRIVIA DB — real trivia questions, free, no key
  // ─────────────────────────────────────────────────────────────────────
  register("game", "live_trivia", async (_ctx, input = {}) => {
    const amount = Math.min(Math.max(Number(input.amount) || 10, 1), 30);
    const category = input.category ? Number(input.category) : null; // 9-32 valid
    const difficulty = String(input.difficulty || "").toLowerCase();
    const type = String(input.type || "").toLowerCase(); // multiple|boolean
    let url = `https://opentdb.com/api.php?amount=${amount}&encode=url3986`;
    if (category && category >= 9 && category <= 32) url += `&category=${category}`;
    if (["easy", "medium", "hard"].includes(difficulty)) url += `&difficulty=${difficulty}`;
    if (["multiple", "boolean"].includes(type)) url += `&type=${type}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      // response_code: 0=success, 1=no results, 5=rate limit
      if (data.response_code !== 0) {
        const codes = { 1: "no_results", 2: "invalid_param", 3: "token_not_found", 4: "token_empty", 5: "rate_limited" };
        return { ok: false, reason: codes[data.response_code] || `code_${data.response_code}` };
      }
      const decode = (s) => decodeURIComponent(String(s || ""));
      const questions = (data.results || []).map((q, i) => ({
        index: i,
        category: decode(q.category),
        difficulty: decode(q.difficulty),
        type: decode(q.type),
        question: decode(q.question),
        correctAnswer: decode(q.correct_answer),
        incorrectAnswers: (q.incorrect_answers || []).map(decode),
      }));
      return {
        ok: true,
        source: "Open Trivia Database",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: questions.length,
        questions,
      };
    } catch (e) {
      return { ok: false, reason: "opentdb_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live Open Trivia DB question batch" });

  // ─────────────────────────────────────────────────────────────────────
  // QUOTABLE — famous quotes by author/tag, free, no key
  // ─────────────────────────────────────────────────────────────────────
  const quotable = async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 10);
    const author = input.author ? String(input.author).slice(0, 60) : null;
    const tag = input.tag ? String(input.tag).slice(0, 40) : null;
    const url = `https://api.quotable.io/quotes/random?limit=${limit}` +
      (author ? `&author=${encodeURIComponent(author)}` : "") +
      (tag ? `&tags=${encodeURIComponent(tag)}` : "");
    try {
      const data = await fetchJsonWithTimeout(url);
      const quotes = (Array.isArray(data) ? data : [data]).filter(Boolean).map(q => ({
        id: q._id,
        content: q.content,
        author: q.author,
        tags: q.tags || [],
        length: q.length || null,
        authorSlug: q.authorSlug || null,
      }));
      return {
        ok: true,
        source: "Quotable",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: quotes.length,
        quotes,
      };
    } catch (e) {
      return { ok: false, reason: "quotable_unreachable", error: String(e?.message || e) };
    }
  };
  register("daily", "live_quote", quotable, { note: "live Quotable random quotes" });
  register("reflection", "live_quote", quotable, { note: "live Quotable random quotes" });

  // ─────────────────────────────────────────────────────────────────────
  // CAT FACTS — real cat facts, free, no key
  // ─────────────────────────────────────────────────────────────────────
  register("pets", "live_catfact", async (_ctx, input = {}) => {
    const count = Math.min(Math.max(Number(input.count) || 5, 1), 20);
    const url = `https://catfact.ninja/facts?limit=${count}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const facts = (data.data || []).map(f => ({
        fact: f.fact,
        length: f.length,
      }));
      return {
        ok: true,
        source: "Cat Facts API",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: data.total || facts.length,
        facts,
      };
    } catch (e) {
      return { ok: false, reason: "catfacts_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live cat facts (catfact.ninja)" });
}
