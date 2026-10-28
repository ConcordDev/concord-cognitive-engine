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
//   daily.live_quote                  Quotable → ZenQuotes → DummyJSON → local list
//                                     (per-source 4 s timeout, 30 min breaker, 10 min cache)
//   reflection.live_quote             Quotable chain (shared)
//   pets.live_catfact                 Cat Facts API (real cat facts)
//
// Each handler attributes its source explicitly and returns
// { ok:false, reason } on upstream failure — never fakes. The quote chain
// is the one exception: it always returns ok:true, labels the provider it
// actually used, and sets degraded/degradedReason when it fell back.

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

// ─────────────────────────────────────────────────────────────────────
// QUOTE HELPERS — shared by the Quotable fallback chain
// ─────────────────────────────────────────────────────────────────────

// Short, human-readable reason for a failed upstream call. Node's fetch
// wraps TLS failures as TypeError("fetch failed") with the real code on
// `cause`, so surface that code (e.g. CERT_HAS_EXPIRED).
function describeFetchError(e) {
  const code = e?.cause?.code || e?.code;
  const msg = String(e?.message || e).slice(0, 120);
  return code ? `${msg} (${code})` : msg;
}

// Normalise any upstream quote to the Quotable shape. Returns null when
// there is no usable text, so a malformed record is dropped, not invented.
function toQuote({ id = null, content, author, tags = [] }) {
  const text = String(content || "").trim();
  if (!text) return null;
  const who = String(author || "Unknown").trim() || "Unknown";
  return {
    id,
    content: text,
    author: who,
    tags,
    length: text.length,
    authorSlug: who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  };
}

const asList = (v) => (Array.isArray(v) ? v : []);
const dayOfYear = (d) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);

// n items from a list starting at `start`, wrapping around the end.
function takeWrapped(list, start, n) {
  if (!list.length) return [];
  return Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
}

const ZENQUOTES_OPTS = { headers: { "User-Agent": USER_AGENT } };
const DUMMYJSON_OPTS = { headers: { "User-Agent": USER_AGENT } };

// Quote chain tuning. A source that failed is skipped for the cooldown rather
// than re-tried on every open; a successful answer is reused for the TTL.
const QUOTE_TIMEOUT_MS = 4000;
const QUOTE_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const quoteBreaker = new Map(); // source name -> { until, reason }
const quoteCache = new Map();   // limit|author|tag -> { expiresAt, value }

// Test hook: forget breaker and cache state between cases.
export function __resetQuoteStateForTests() {
  quoteBreaker.clear();
  quoteCache.clear();
}

// Returns a skip note while `name` is cooling down, otherwise null.
function quoteSkipNote(name, now) {
  const b = quoteBreaker.get(name);
  return b && b.until > now ? `skipped: cooling down after ${b.reason}` : null;
}

// Fallback sources, tried in order after Quotable. Each returns normalised
// quotes (possibly empty) or throws. Free, no key. Both ignore author/tag
// filters, which the caller reports via `filtersIgnored`.
const QUOTE_FALLBACK_SOURCES = [
  {
    name: "ZenQuotes",
    // /api/random returns one quote per call; /api/quotes returns ~50, of
    // which a day-of-year window is taken so the daily pick is stable.
    async fetch(limit, now) {
      if (limit === 1) {
        const data = await fetchJsonWithTimeout("https://zenquotes.io/api/random", ZENQUOTES_OPTS, QUOTE_TIMEOUT_MS);
        return asList(data).map(q => toQuote({ content: q.q, author: q.a })).filter(Boolean);
      }
      const data = await fetchJsonWithTimeout("https://zenquotes.io/api/quotes", ZENQUOTES_OPTS, QUOTE_TIMEOUT_MS);
      const all = asList(data).map(q => toQuote({ content: q.q, author: q.a })).filter(Boolean);
      return takeWrapped(all, dayOfYear(now), limit);
    },
  },
  {
    name: "DummyJSON",
    async fetch(limit, now) {
      if (limit === 1) {
        const q = await fetchJsonWithTimeout("https://dummyjson.com/quotes/random", DUMMYJSON_OPTS, QUOTE_TIMEOUT_MS);
        const quote = toQuote({ id: `dummyjson:${q?.id}`, content: q?.quote, author: q?.author });
        return quote ? [quote] : [];
      }
      const skip = dayOfYear(now) % 90;
      const data = await fetchJsonWithTimeout(`https://dummyjson.com/quotes?limit=${limit}&skip=${skip}`, DUMMYJSON_OPTS, QUOTE_TIMEOUT_MS);
      return asList(data?.quotes)
        .map(q => toQuote({ id: `dummyjson:${q.id}`, content: q.quote, author: q.author }))
        .filter(Boolean);
    },
  },
];

// Last resort when every network source is down. Public-domain, long-dead
// authors; wording is a common English rendering of each source text. Picked
// by day of year, so there is no randomness and the same day gives the same quote.
const LOCAL_QUOTES = [
  { content: "You have power over your mind, not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { content: "The best way of avenging thyself is not to become like the wrong-doer.", author: "Marcus Aurelius" },
  { content: "Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", author: "Marcus Aurelius" },
  { content: "Look within. Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.", author: "Marcus Aurelius" },
  { content: "Men are disturbed not by things, but by the views which they take of things.", author: "Epictetus" },
  { content: "While we are postponing, life speeds by.", author: "Seneca" },
  { content: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { content: "Whoso would be a man must be a nonconformist.", author: "Ralph Waldo Emerson" },
  { content: "Nothing great was ever achieved without enthusiasm.", author: "Ralph Waldo Emerson" },
  { content: "To be great is to be misunderstood.", author: "Ralph Waldo Emerson" },
  { content: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach.", author: "Henry David Thoreau" },
  { content: "If one advances confidently in the direction of his dreams, and endeavors to live the life which he has imagined, he will meet with a success unexpected in common hours.", author: "Henry David Thoreau" },
  { content: "Our life is frittered away by detail. Simplify, simplify.", author: "Henry David Thoreau" },
  { content: "Early to bed and early to rise, makes a man healthy, wealthy, and wise.", author: "Benjamin Franklin" },
  { content: "Well done is better than well said.", author: "Benjamin Franklin" },
  { content: "If there is no struggle, there is no progress.", author: "Frederick Douglass" },
].map((q, i) => toQuote({ id: `local:${i}`, content: q.content, author: q.author }));

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
        // response_code 5 is OpenTDB's own rate limit (an upstream fault, not
        // the caller's): report it as upstream_rate_limited so /api/lens/run
        // answers HTTP 200 { ok:false } and the panel shows "unavailable".
        if (data.response_code === 5) return { ok: false, reason: "upstream_rate_limited", error: "upstream_rate_limited" };
        const codes = { 1: "no_results", 2: "invalid_param", 3: "token_not_found", 4: "token_empty" };
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
      // OpenTDB answers its rate limit with HTTP 429 (fetchJsonWithTimeout
      // throws "HTTP 429"); that is an upstream rate limit, not an outage.
      if (/\bHTTP 429\b/.test(String(e?.message || ""))) {
        return { ok: false, reason: "upstream_rate_limited", error: "upstream_rate_limited" };
      }
      return { ok: false, reason: "opentdb_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live Open Trivia DB question batch" });

  // ─────────────────────────────────────────────────────────────────────
  // QUOTABLE — famous quotes by author/tag, free, no key.
  // Primary source. When it is down (its TLS cert has expired), the chain
  // falls back to ZenQuotes, then DummyJSON, then a built-in local list so
  // the daily quote never goes blank. Every fallback is labelled as such.
  // ─────────────────────────────────────────────────────────────────────
  const quotable = async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 10);
    const author = input.author ? String(input.author).slice(0, 60) : null;
    const tag = input.tag ? String(input.tag).slice(0, 40) : null;
    const requestedFilters = [author && "author", tag && "tag"].filter(Boolean);
    const now = Date.now();
    const fetchedAt = Math.floor(now / 1000);
    const cacheKey = `${limit}|${author || ""}|${tag || ""}`;
    const hit = quoteCache.get(cacheKey);
    if (hit && hit.expiresAt > now) return { ...hit.value, cached: true };
    quoteCache.delete(cacheKey);
    // Only network answers are remembered. The local list is the last resort
    // and must not hide a source that recovers.
    const remember = (value) => {
      quoteCache.set(cacheKey, { expiresAt: now + QUOTE_CACHE_TTL_MS, value });
      return value;
    };
    const url = `https://api.quotable.io/quotes/random?limit=${limit}` +
      (author ? `&author=${encodeURIComponent(author)}` : "") +
      (tag ? `&tags=${encodeURIComponent(tag)}` : "");
    const failures = [];
    const skipQuotable = quoteSkipNote("Quotable", now);
    if (skipQuotable) {
      failures.push(`Quotable: ${skipQuotable}`);
    } else {
      try {
        const data = await fetchJsonWithTimeout(url, {}, QUOTE_TIMEOUT_MS);
        const quotes = (Array.isArray(data) ? data : [data]).filter(Boolean).map(q => ({
          id: q._id,
          content: q.content,
          author: q.author,
          tags: q.tags || [],
          length: q.length || null,
          authorSlug: q.authorSlug || null,
        }));
        quoteBreaker.delete("Quotable");
        return remember({
          ok: true,
          source: "Quotable",
          fetchedAt,
          total: quotes.length,
          quotes,
          degraded: false,
          degradedReason: null,
          filtersIgnored: [],
        });
      } catch (e) {
        const reason = describeFetchError(e);
        quoteBreaker.set("Quotable", { until: now + QUOTE_BREAKER_COOLDOWN_MS, reason });
        failures.push(`Quotable: ${reason}`);
      }
    }

    for (const src of QUOTE_FALLBACK_SOURCES) {
      const skip = quoteSkipNote(src.name, now);
      if (skip) {
        failures.push(`${src.name}: ${skip}`);
        continue;
      }
      let reason;
      try {
        const quotes = await src.fetch(limit, new Date(now));
        if (quotes.length) {
          quoteBreaker.delete(src.name);
          return remember({
            ok: true,
            source: src.name,
            fetchedAt,
            total: quotes.length,
            quotes,
            degraded: true,
            degradedReason: failures.join("; "),
            filtersIgnored: requestedFilters,
          });
        }
        reason = "empty response";
      } catch (e) {
        reason = describeFetchError(e);
      }
      quoteBreaker.set(src.name, { until: now + QUOTE_BREAKER_COOLDOWN_MS, reason });
      failures.push(`${src.name}: ${reason}`);
    }

    const quotes = takeWrapped(LOCAL_QUOTES, dayOfYear(new Date(now)), limit);
    return {
      ok: true,
      source: "local",
      fetchedAt,
      total: quotes.length,
      quotes,
      degraded: true,
      degradedReason: failures.join("; "),
      filtersIgnored: requestedFilters,
    };
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
