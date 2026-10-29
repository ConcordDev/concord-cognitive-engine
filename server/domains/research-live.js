// server/domains/research-live.js
//
// Phase 4 of the 10-dimension UX completeness sprint — arXiv +
// PubMed wire-ups for the science / physics / quantum / robotics /
// neuro / bio lenses.
//
// All free, no API key. arXiv returns Atom XML which we parse to JSON.

const ARXIV_BASE = "http://export.arxiv.org/api/query";
const FETCH_TIMEOUT_MS = 10000;

async function fetchTextWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// Minimal Atom-XML parser sufficient for arXiv entries.
function parseArxivAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const entryXml = m[1];
    const get = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const mm = entryXml.match(re);
      return mm ? mm[1].trim() : null;
    };
    const id = get("id");
    const title = get("title")?.replace(/\s+/g, " ").trim();
    const summary = get("summary")?.replace(/\s+/g, " ").trim();
    const published = get("published");
    const updated = get("updated");
    const authors = [];
    const authorRe = /<author>\s*<name>([^<]+)<\/name>/g;
    let am;
    while ((am = authorRe.exec(entryXml)) !== null) authors.push(am[1].trim());
    const arxivIdMatch = id?.match(/arxiv\.org\/abs\/(.+)$/);
    const arxivId = arxivIdMatch ? arxivIdMatch[1] : null;
    const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;
    const catMatch = entryXml.match(/<category[^>]*\sterm="([^"]+)"/);
    const category = catMatch ? catMatch[1] : null;
    entries.push({ arxivId, title, summary, published, updated, authors, abstractUrl: id, pdfUrl, category });
  }
  return entries;
}

const CATEGORY_FOR_DOMAIN = {
  physics: "physics",
  quantum: "quant-ph",
  robotics: "cs.RO",
  neuro: "q-bio.NC",
  bio: "q-bio",
  chem: "physics.chem-ph",
  math: "math",
  ml: "cs.LG",
  ai: "cs.AI",
};

const CATEGORY_RE = /^[a-z-]+(\.[A-Za-z-]+)?$/;
const ARXIV_FIELDS = new Set(["all", "abs", "ti", "cat-only"]);

// Validates live_arxiv input and builds the fixed-host arXiv query URL.
// Returns { ok:true, url, category, query } or { ok:false, error, reason }.
function buildArxivRequest(defaultCategory, input = {}) {
  const bad = (reason) => ({ ok: false, error: "invalid_input", reason });
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 30);
  let category = defaultCategory;
  if (input.category !== undefined && input.category !== null && input.category !== "") {
    const c = input.category;
    if (typeof c !== "string" || c.length > 32 || !CATEGORY_RE.test(c)) {
      return bad("category must match /^[a-z-]+(\\.[A-Za-z-]+)?$/ and be at most 32 chars");
    }
    category = c;
  }
  let field = "all";
  if (input.field !== undefined && input.field !== null && input.field !== "") {
    if (typeof input.field !== "string" || !ARXIV_FIELDS.has(input.field)) {
      return bad('field must be one of "all", "abs", "ti", "cat-only"');
    }
    field = input.field;
  }
  if (input.anyCategory !== undefined && typeof input.anyCategory !== "boolean") {
    return bad("anyCategory must be a boolean");
  }
  const anyCategory = input.anyCategory === true;
  const rawQuery = input.query ? String(input.query).slice(0, 200).trim() : "";
  // S8 (F9) — the query is built as one field clause PER TERM, AND-joined.
  // The previous construction encoded the whole string as a single field
  // value (`all:large%20language%20models`); arXiv's parser reads an
  // unquoted multi-word value as an OR of its words — verified live:
  // that URL's own feed title reads "all:large OR all:language OR
  // all:models" with totalResults 1,562,512, so sorted by submission
  // date the surface showed the newest papers in the corpus whatever
  // was typed — a feed wearing a search box. Term-wise AND returns the
  // conjunctive set (106,663 for the same words), and a nonsense query
  // honestly returns nothing instead of every paper containing "the".
  // Quotes/parens are stripped per term: they are arXiv syntax, not
  // search text, and a pasted phrase must not break the query grammar.
  const queryTerms = rawQuery.split(/\s+/)
    .map((t) => t.replace(/["()]/g, ""))
    .filter(Boolean)
    .slice(0, 10);
  const usesQuery = field !== "cat-only" && queryTerms.length > 0;
  if (anyCategory) {
    if (field === "cat-only") return bad("anyCategory cannot be combined with field cat-only");
    if (!usesQuery) return bad("query is required when anyCategory is true");
  }
  const clauses = [];
  if (!anyCategory) clauses.push(`cat:${category}`);
  if (usesQuery) {
    for (const t of queryTerms) clauses.push(`${field}:${encodeURIComponent(t)}`);
  }
  // A query is a search: rank by relevance (Discover/OpenAlex sets the
  // in-lens standard). The bare category listing stays a newest-first
  // feed, which is what a feed is for.
  const sortBy = usesQuery ? "relevance" : "submittedDate";
  const url = `${ARXIV_BASE}?search_query=${clauses.join("+AND+")}&start=0&max_results=${limit}&sortBy=${sortBy}&sortOrder=descending`;
  return { ok: true, url, category: anyCategory ? null : category, query: usesQuery ? rawQuery : null };
}

function buildArxivMacro(register, domain) {
  const category = CATEGORY_FOR_DOMAIN[domain];
  register(domain, "live_arxiv", async (_ctx, input = {}) => {
    const req = buildArxivRequest(category, input || {});
    if (!req.ok) return req;
    try {
      const xml = await fetchTextWithTimeout(req.url);
      const entries = parseArxivAtom(xml);
      return {
        ok: true,
        source: "arXiv",
        category: req.category,
        fetchedAt: Math.floor(Date.now() / 1000),
        query: req.query,
        total: entries.length,
        papers: entries,
      };
    } catch (e) {
      return { ok: false, reason: "arxiv_unreachable", error: String(e?.message || e) };
    }
  }, { note: `live arXiv ${category} papers` });
}

export default function registerResearchLiveMacros(register) {
  for (const domain of Object.keys(CATEGORY_FOR_DOMAIN)) {
    buildArxivMacro(register, domain);
  }
}

export { CATEGORY_FOR_DOMAIN, parseArxivAtom, buildArxivRequest };
