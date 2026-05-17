// server/domains/scholarly-apis.js
//
// Phase 4 (third wave) — more REAL free academic / language APIs.
// All sources are public, no key required, real data end-to-end.
//
// Domains covered:
//   paper.live_crossref            CrossRef REST — DOI metadata search
//   research.live_crossref         CrossRef REST — shared handler
//   paper.live_openalex            OpenAlex — full academic graph (works + authors)
//   research.live_openalex         OpenAlex — shared handler
//   linguistics.live_datamuse      Datamuse — rhymes/synonyms/triggers/follows
//   creative-writing.live_datamuse Datamuse — shared handler
//   poetry.live_datamuse           Datamuse — shared handler
//   linguistics.live_dictionary    Free Dictionary API — definitions + phonetics
//   education.live_dictionary      Free Dictionary API — shared handler

const FETCH_TIMEOUT_MS = 8000;

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

export default function registerScholarlyApiMacros(register) {
  // ───────────────────────────────────────────────────────────────────
  // CROSSREF — DOI metadata search (free, polite User-Agent recommended)
  // ───────────────────────────────────────────────────────────────────
  const crossrefSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 300) return { ok: false, reason: "query_too_long" };
    const rows = Math.min(Math.max(Number(input.limit) || 12, 1), 25);
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${rows}&sort=relevance&select=DOI,title,author,published-print,published-online,container-title,publisher,abstract,type,subject,is-referenced-by-count,URL`;
    try {
      const data = await fetchJsonWithTimeout(url, {
        headers: { "User-Agent": "ConcordOS/5.0 (+https://concord-os.org; mailto:hello@concord-os.org)" },
      });
      const items = (data.message?.items || []).map(w => ({
        doi: w.DOI,
        title: (w.title || [])[0] || null,
        authors: (w.author || []).slice(0, 8).map(a => ({
          name: [a.given, a.family].filter(Boolean).join(" ") || a.name || "Unknown",
          orcid: a.ORCID || null,
        })),
        publishedYear:
          w["published-print"]?.["date-parts"]?.[0]?.[0] ||
          w["published-online"]?.["date-parts"]?.[0]?.[0] || null,
        containerTitle: (w["container-title"] || [])[0] || null,
        publisher: w.publisher || null,
        type: w.type || null,
        subjects: (w.subject || []).slice(0, 6),
        citationCount: w["is-referenced-by-count"] ?? null,
        url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : null),
      }));
      return {
        ok: true,
        source: "CrossRef",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.message?.["total-results"] || items.length,
        works: items,
      };
    } catch (e) {
      return { ok: false, reason: "crossref_unreachable", error: String(e?.message || e) };
    }
  };
  register("paper", "live_crossref", crossrefSearch, { note: "live CrossRef DOI search" });
  register("research", "live_crossref", crossrefSearch, { note: "live CrossRef DOI search" });

  // ───────────────────────────────────────────────────────────────────
  // OPENALEX — full academic graph (free, polite mailto recommended)
  // ───────────────────────────────────────────────────────────────────
  const openalexSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 300) return { ok: false, reason: "query_too_long" };
    const perPage = Math.min(Math.max(Number(input.limit) || 12, 1), 25);
    const mailto = process.env.OPENALEX_MAILTO || "hello@concord-os.org";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${perPage}&mailto=${encodeURIComponent(mailto)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const works = (data.results || []).map(w => ({
        id: w.id,
        doi: w.doi,
        title: w.title || w.display_name || null,
        publicationYear: w.publication_year || null,
        publicationDate: w.publication_date || null,
        type: w.type || null,
        citedByCount: w.cited_by_count ?? 0,
        openAccess: !!w.open_access?.is_oa,
        openAccessUrl: w.open_access?.oa_url || null,
        primaryLocation: w.primary_location?.source?.display_name || null,
        authors: (w.authorships || []).slice(0, 8).map(a => ({
          name: a.author?.display_name || "Unknown",
          orcid: a.author?.orcid || null,
          institutions: (a.institutions || []).slice(0, 2).map(i => i.display_name).filter(Boolean),
        })),
        concepts: (w.concepts || []).slice(0, 5).map(c => ({ name: c.display_name, score: c.score })),
        landingPage: w.id ? w.id.replace("https://openalex.org/", "https://api.openalex.org/works/") : null,
      }));
      return {
        ok: true,
        source: "OpenAlex",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.meta?.count || works.length,
        works,
      };
    } catch (e) {
      return { ok: false, reason: "openalex_unreachable", error: String(e?.message || e) };
    }
  };
  register("paper", "live_openalex", openalexSearch, { note: "live OpenAlex academic graph search" });
  register("research", "live_openalex", openalexSearch, { note: "live OpenAlex academic graph search" });

  // ───────────────────────────────────────────────────────────────────
  // DATAMUSE — word relationships (free, no key)
  // ───────────────────────────────────────────────────────────────────
  const datamuseQuery = async (_ctx, input = {}) => {
    const word = String(input.word || "").trim();
    if (!word) return { ok: false, reason: "missing_word" };
    if (word.length > 60) return { ok: false, reason: "word_too_long" };
    const max = Math.min(Math.max(Number(input.max) || 15, 1), 50);
    const kind = String(input.kind || "rhymes").toLowerCase();
    const KIND_MAP = {
      rhymes:      "rel_rhy",
      near_rhymes: "rel_nry",
      synonyms:    "rel_syn",
      antonyms:    "rel_ant",
      triggers:    "rel_trg",      // semantically associated
      follows:     "lc",           // words that follow
      precedes:    "rc",           // words that precede
      means:       "ml",           // means-like
      sounds_like: "sl",
      spelled_like:"sp",
    };
    const param = KIND_MAP[kind] || "rel_rhy";
    const url = `https://api.datamuse.com/words?${param}=${encodeURIComponent(word)}&max=${max}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const words = (Array.isArray(data) ? data : []).map(d => ({
        word: d.word,
        score: d.score ?? null,
        numSyllables: d.numSyllables ?? null,
        tags: d.tags || [],
      }));
      return {
        ok: true,
        source: "Datamuse",
        fetchedAt: Math.floor(Date.now() / 1000),
        word, kind, total: words.length, words,
      };
    } catch (e) {
      return { ok: false, reason: "datamuse_unreachable", error: String(e?.message || e) };
    }
  };
  register("linguistics", "live_datamuse", datamuseQuery, { note: "live Datamuse word-relationship lookup" });
  register("creative-writing", "live_datamuse", datamuseQuery, { note: "live Datamuse word-relationship lookup" });
  register("poetry", "live_datamuse", datamuseQuery, { note: "live Datamuse word-relationship lookup" });

  // ───────────────────────────────────────────────────────────────────
  // FREE DICTIONARY — definitions + phonetics (free, no key)
  // ───────────────────────────────────────────────────────────────────
  const dictionaryLookup = async (_ctx, input = {}) => {
    const word = String(input.word || "").trim();
    if (!word) return { ok: false, reason: "missing_word" };
    if (word.length > 60) return { ok: false, reason: "word_too_long" };
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: true, source: "Free Dictionary API", fetchedAt: Math.floor(Date.now() / 1000), word, entries: [] };
      }
      const entries = data.slice(0, 3).map(e => ({
        word: e.word,
        phonetic: e.phonetic || (e.phonetics || []).find(p => p.text)?.text || null,
        audio: (e.phonetics || []).find(p => p.audio)?.audio || null,
        origin: e.origin || null,
        meanings: (e.meanings || []).slice(0, 4).map(m => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions || []).slice(0, 3).map(d => ({
            definition: d.definition,
            example: d.example || null,
            synonyms: (d.synonyms || []).slice(0, 5),
            antonyms: (d.antonyms || []).slice(0, 5),
          })),
        })),
      }));
      return {
        ok: true,
        source: "Free Dictionary API",
        fetchedAt: Math.floor(Date.now() / 1000),
        word, entries,
      };
    } catch (e) {
      return { ok: false, reason: "dictionary_unreachable", error: String(e?.message || e) };
    }
  };
  register("linguistics", "live_dictionary", dictionaryLookup, { note: "live Free Dictionary lookup" });
  register("education", "live_dictionary", dictionaryLookup, { note: "live Free Dictionary lookup" });
}
