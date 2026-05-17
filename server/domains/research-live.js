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
    entries.push({ arxivId, title, summary, published, updated, authors, abstractUrl: id, pdfUrl });
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

function buildArxivMacro(register, domain) {
  const category = CATEGORY_FOR_DOMAIN[domain];
  register(domain, "live_arxiv", async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 30);
    const query = input.query
      ? encodeURIComponent(String(input.query).slice(0, 200))
      : null;
    const searchQuery = query
      ? `search_query=cat:${category}+AND+all:${query}`
      : `search_query=cat:${category}`;
    const url = `${ARXIV_BASE}?${searchQuery}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
    try {
      const xml = await fetchTextWithTimeout(url);
      const entries = parseArxivAtom(xml);
      return {
        ok: true,
        source: "arXiv",
        category,
        fetchedAt: Math.floor(Date.now() / 1000),
        query: input.query || null,
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

export { CATEGORY_FOR_DOMAIN, parseArxivAtom };
