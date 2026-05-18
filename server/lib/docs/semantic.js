// server/lib/docs/semantic.js
//
// Lightweight semantic search for the docs workspace. No external
// model — uses bigram + token-overlap scoring with TF-IDF-style
// frequency weighting. Good enough to rank "what other docs discuss
// this concept" without spinning up an embedding pipeline.
//
// Trade-off: misses synonymy ("car" ↔ "vehicle"). Acceptable for
// Sprint C's workspace search where the corpus is the user's own
// writing — they use consistent vocabulary across their notes.

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","of","in","on","at",
  "to","for","with","by","and","or","but","if","then","so","as","this","that",
  "these","those","it","its","i","you","we","they","he","she","my","your","our",
  "their","what","which","who","whom","whose","do","does","did","not","no","yes",
  "from","into","than","over","under","up","down","out","very","too","also","can",
  "could","should","would","will","just","such",
]);

function _tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function _bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

function _tfMap(arr) {
  const m = new Map();
  for (const t of arr) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function _score(queryTokens, queryBigrams, docTokens, docBigrams) {
  const qTF = _tfMap(queryTokens);
  const dTF = _tfMap(docTokens);
  let unigramScore = 0;
  for (const [tok, qf] of qTF) {
    const df = dTF.get(tok) || 0;
    if (df > 0) unigramScore += qf * Math.log(1 + df);
  }
  const qBG = _tfMap(queryBigrams);
  const dBG = _tfMap(docBigrams);
  let bigramScore = 0;
  for (const [bg, qf] of qBG) {
    const df = dBG.get(bg) || 0;
    if (df > 0) bigramScore += qf * df * 4; // bigrams weighted higher
  }
  return unigramScore + bigramScore;
}

function _stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function _snippetFor(text, queryTokens, max = 240) {
  if (!text) return "";
  const lower = text.toLowerCase();
  for (const t of queryTokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + 180);
      const slice = text.slice(start, end);
      return (start > 0 ? "…" : "") + slice + (end < text.length ? "…" : "");
    }
  }
  return text.slice(0, max);
}

/**
 * Semantic workspace search. Scans the user's docs, scores each by
 * bigram overlap with the query, returns top N with snippets pinned
 * to the matching span. Pure SQLite + JS; no model.
 */
export function semanticSearch(db, { ownerId, query, limit = 10 }) {
  if (!db || !ownerId || !query) return [];
  const qTokens = _tokens(query);
  if (qTokens.length === 0) return [];
  const qBigrams = _bigrams(qTokens);
  const rows = db.prepare(`
    SELECT id, title, content_md, content_html, icon, word_count, updated_at
    FROM documents
    WHERE owner_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1000
  `).all(ownerId);
  const scored = [];
  for (const row of rows) {
    const text = _stripHtml(row.content_html || "") + " " + (row.title || "");
    const dTokens = _tokens(text);
    if (dTokens.length === 0) continue;
    const dBigrams = _bigrams(dTokens);
    const score = _score(qTokens, qBigrams, dTokens, dBigrams);
    if (score <= 0) continue;
    scored.push({
      id: row.id,
      title: row.title,
      icon: row.icon,
      word_count: row.word_count,
      updated_at: row.updated_at,
      score: Math.round(score * 100) / 100,
      snippet: _snippetFor(text, qTokens, 240),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
