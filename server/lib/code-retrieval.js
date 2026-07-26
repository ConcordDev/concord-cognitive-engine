// server/lib/code-retrieval.js
//
// GH-3a — real ranked code retrieval for the coding-assist macros
// (code.codebase-chat, code.multi-file-plan). Mirrors chat/substrate-retrieval.js's
// fetch → score → limit SHAPE (an explicit, inspectable score per candidate, a
// real cap, never a silent black-box selection) but is a NEW, code-specific
// module — it does NOT reuse or reimplement substrate-retrieval.js's logic,
// because DTUs (locker-encrypted shadow payloads) and source files (plain-text,
// path-addressed, from a virtual project or a live GitHub tree) are a different
// data shape entirely.
//
// ── RANKING APPROACH (read this before changing the default) ───────────────
// Default = honest keyword/TF-IDF term-frequency ranking, NOT semantic
// embedding. This is a deliberate, documented choice, not a shortcut:
//
//   1. This function runs INLINE in a live chat/plan request, not a background
//      indexing job. `server/embeddings.js#embed` is a real Ollama call
//      (nomic-embed-text) with its own 5s per-call timeout; ranking N
//      candidate files by embedding would mean N extra round-trips to the SAME
//      embedding brain slot every other embedding-consuming feature on the box
//      already shares (DTU backfill, cross-lens-discovery, agent-action-log).
//      That is an acceptable cost for one shadow-DTU lookup; it is not an
//      acceptable cost, by default, for ranking dozens of source files under a
//      user-facing request deadline.
//   2. Code retrieval is also a case where lexical matching is a legitimately
//      strong, not merely "good enough," technique: developers reference
//      exact identifiers, filenames, and error strings. TF-IDF finds an exact
//      `computeDamageCap` or `useLensCommand` reference directly; a semantic
//      embedding can blur distinct-but-related identifiers together.
//
// Embedding re-ranking IS available, but strictly opt-in (`useEmbeddings:
// true`) and strictly bounded: it only re-scores the already-small keyword
// shortlist (top ~10), never the full candidate pool, and only runs when
// `embeddings.js#isEmbeddingAvailable()` reports the brain is actually up.
// Every returned candidate carries a `matchedBy` field naming exactly which
// method scored it ("keyword-tfidf" or "keyword-tfidf+embedding") — never a
// generic "AI-ranked" label dressing up a heuristic as something it isn't.
//
// ── TWO-PHASE COST CONTROL ───────────────────────────────────────────────
// Phase 1 (cheap): score every candidate by PATH alone (filename/directory
// token overlap with the query) — no content fetch. This is what bounds the
// number of `getContent()` calls for a GitHub tree, where each call is a real
// network request to the Contents API.
// Phase 2 (real ranking): fetch content for only the phase-1 shortlist, then
// score by real term-frequency × inverse-document-frequency (computed over
// the fetched shortlist — that's the honest scope; this is not corpus-wide
// IDF over the whole repo, which would need fetching every file to compute).
//
// ── HONEST CAPS ──────────────────────────────────────────────────────────
// `limit` (file count) and `maxTotalChars` (character budget) are both real
// and enforced — retrieval stops filling slots the moment either is hit, it
// never silently returns "everything." Every selected file reports why it was
// chosen (`matchedBy` + a human `reason` string with the actual matched terms)
// so a caller/UI can show its work instead of trusting a black box.

const DAY_MS = 86400000;
const DEFAULT_SKIP_RE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor|\.turbo)(\/|$)/i;
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|tar|gz|7z|woff2?|ttf|eot|mp3|mp4|mov|avi|bin|exe|dll|so|dylib|lock)$/i;

// Small stopword set so common English/code filler doesn't dilute term-frequency
// scoring. Deliberately short — this is lexical matching, not an NLP pipeline.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has", "was",
  "this", "that", "with", "from", "into", "your", "our", "then", "than", "when",
  "what", "how", "why", "please", "will", "would", "should", "could",
]);

/**
 * Tokenize a string into lowercase, identifier-aware tokens. Splits on
 * camelCase boundaries and snake_case/kebab-case separators FIRST (so
 * `authLogin`, `auth_login`, and `auth-login` all yield the same
 * ["auth","login"] a human would actually type in a query) — plain
 * lowercase-and-split-on-non-alnum would leave code identifiers as single
 * opaque tokens and miss most real matches.
 */
function tokenize(s) {
  const str = String(s || "");
  const withBoundaries = str.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return withBoundaries
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Cheap, content-free relevance signal: how much do the query's tokens overlap the file's path? */
function pathScore(queryTokens, path) {
  if (!queryTokens.length) return 0;
  const cleaned = String(path || "").replace(/[\\/]/g, " ").replace(/\.[a-z0-9]+$/i, "");
  const pathTokens = tokenize(cleaned);
  if (!pathTokens.length) return 0;
  let hits = 0;
  for (const t of pathTokens) if (queryTokens.includes(t)) hits++;
  const base = String(path || "").split("/").pop() || "";
  const baseNoExt = base.replace(/\.[^.]+$/, "").toLowerCase();
  const exactBaseBonus = queryTokens.includes(baseNoExt) ? 1.5 : 0;
  return Math.min(2, hits / Math.max(1, queryTokens.length) + exactBaseBonus);
}

/** Recency decay 1.0 → 0.1 with a ~21-day half-life. Optional signal — only used when a caller supplies timestamps. */
function recencyScore(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 0;
  const ageDays = (Date.now() - timestampMs) / DAY_MS;
  return 0.1 + 0.9 * Math.exp(-ageDays / 30);
}

/** Human-readable explanation of why a file matched, naming the actual overlapping terms — never a vague "relevant." */
function matchReason(queryTokens, path, contentTokens) {
  const pathHits = [...new Set(tokenize(path).filter((t) => queryTokens.includes(t)))];
  const contentSet = new Set(contentTokens);
  const contentHits = queryTokens.filter((t) => contentSet.has(t));
  const parts = [];
  if (pathHits.length) parts.push(`path matches: ${pathHits.join(", ")}`);
  if (contentHits.length) parts.push(`content matches: ${[...new Set(contentHits)].slice(0, 8).join(", ")}`);
  return parts.length ? parts.join("; ") : "weak/no term overlap (included only to fill the budget)";
}

/**
 * Build retrieval candidates from Concord's own virtual-project file store
 * (the `code` domain's `ensureFiles()` result: Map<path, {content, modifiedAt}>).
 * @param {Map<string, {content:string, modifiedAt?:string}>} filesMap
 * @returns {Array<{path:string, getContent:Function, size:number, modifiedAtMs:number|null}>}
 */
export function candidatesFromLocalFiles(filesMap) {
  const out = [];
  if (!filesMap || typeof filesMap.entries !== "function") return out;
  for (const [path, blob] of filesMap) {
    const content = blob?.content || "";
    const modifiedAtMs = blob?.modifiedAt ? Date.parse(blob.modifiedAt) : NaN;
    out.push({
      path,
      getContent: () => content,
      size: content.length,
      modifiedAtMs: Number.isFinite(modifiedAtMs) ? modifiedAtMs : null,
    });
  }
  return out;
}

/**
 * Build retrieval candidates from a GitHub repo-tree listing (the shape
 * `github.repo-tree` returns as `result.tree`: `[{path, type, sha, size}]`).
 * Content is fetched LAZILY via `fetchFile(path)` and only for files that
 * survive the phase-1 path prefilter — fetching every blob up front would be
 * an unbounded number of GitHub API calls for a large repo on every request.
 * @param {Array<{path:string, type:string, size?:number}>} tree
 * @param {(path:string) => Promise<string>} fetchFile
 */
export function candidatesFromGitHubTree(tree, fetchFile) {
  const out = [];
  for (const t of tree || []) {
    if (!t || t.type !== "blob") continue; // skip subtrees/submodules — not fetchable as file content
    out.push({
      path: t.path,
      size: Number.isFinite(t.size) ? t.size : null,
      modifiedAtMs: null, // GitHub tree listing carries no per-file mtime; recency signal is not available here
      getContent: () => fetchFile(t.path),
    });
  }
  return out;
}

/**
 * Rank candidate files against a natural-language task query and return a
 * budget-capped, explained selection.
 *
 * @param {object} opts
 * @param {string} opts.query - the task/question driving retrieval
 * @param {Array<{path:string, getContent:Function, size?:number, modifiedAtMs?:number|null}>} opts.candidates
 * @param {string[]} [opts.explicitPaths] - paths the CALLER already resolved as an explicit
 *        override (e.g. an @-mention). Always included first, verbatim, never scored out —
 *        an explicit reference is a stronger signal than any ranking guess.
 * @param {number} [opts.limit=8] - max file count in the final selection
 * @param {number} [opts.maxCharsPerFile=6000] - per-file content cap
 * @param {number} [opts.maxTotalChars] - total content-character budget across the whole
 *        selection; defaults to `limit * maxCharsPerFile`
 * @param {number} [opts.prefilterCap=40] - how many path-scored candidates advance to the
 *        (content-fetching) phase 2 — bounds GitHub API calls / large-tree cost
 * @param {boolean} [opts.useEmbeddings=false] - opt in to a bounded embedding re-rank of the
 *        keyword shortlist when `embeddings.js` reports the brain is available
 * @returns {Promise<{
 *   selected: Array<{path, content, truncated, score, matchedBy, reason}>,
 *   candidatesConsidered: number,
 *   candidatesShortlisted: number,
 *   totalChars: number,
 *   budget: {limit:number, maxCharsPerFile:number, maxTotalChars:number},
 *   rankingMethod: string,
 * }>}
 */
export async function retrieveRelevantFiles({
  query = "",
  candidates = [],
  explicitPaths = [],
  limit = 8,
  maxCharsPerFile = 6000,
  maxTotalChars = null,
  prefilterCap = 40,
  useEmbeddings = false,
} = {}) {
  const cappedLimit = Math.max(1, Math.min(50, Number(limit) || 8));
  const cappedPerFile = Math.max(200, Math.min(50000, Number(maxCharsPerFile) || 6000));
  // An explicit maxTotalChars is honored even when it's SMALLER than a single
  // file's per-file cap (a caller asking for a tight total budget is a real
  // constraint, not a mistake to silently widen) — only fall back to
  // limit*maxCharsPerFile when the caller didn't specify a total budget at all.
  const totalBudget = maxTotalChars != null && Number.isFinite(Number(maxTotalChars))
    ? Math.max(1, Number(maxTotalChars))
    : cappedLimit * cappedPerFile;
  const queryTokens = tokenize(query);

  const byPath = new Map();
  for (const c of candidates || []) { if (c?.path) byPath.set(c.path, c); }

  // Resolve explicit paths the same way the existing @-mention logic did:
  // exact match, or a path ending in "/<given>" (a bare filename reference).
  const resolvedExplicit = [];
  for (const p of explicitPaths || []) {
    if (!p) continue;
    const hit = byPath.has(p) ? p : [...byPath.keys()].find((k) => k === p || k.endsWith("/" + p));
    if (hit && !resolvedExplicit.includes(hit)) resolvedExplicit.push(hit);
  }
  const explicitSet = new Set(resolvedExplicit);

  const filtered = (candidates || []).filter(
    (c) => c?.path && !DEFAULT_SKIP_RE.test(c.path) && !BINARY_EXT_RE.test(c.path),
  );

  // Phase 1 — cheap path-only prefilter (no content fetch), bounds phase 2 cost.
  const prescored = filtered
    .filter((c) => !explicitSet.has(c.path))
    .map((c) => ({ c, pScore: pathScore(queryTokens, c.path) }))
    .sort((a, b) => b.pScore - a.pScore)
    .slice(0, Math.max(0, prefilterCap));

  // Phase 2 — fetch content only for the shortlist.
  const shortlisted = await Promise.all(
    prescored.map(async ({ c, pScore }) => {
      let content = "";
      try { content = String((await c.getContent()) ?? ""); } catch { content = ""; }
      return { c, pathScore: pScore, content };
    }),
  );

  // Real TF-IDF over the fetched shortlist. IDF's document-frequency denominator
  // is computed over THIS shortlist (what was actually fetched), not the whole
  // corpus — stated honestly rather than implying a full-repo index that was
  // never built.
  const docsTokens = shortlisted.map((s) => tokenize(s.content.slice(0, 20000)));
  const df = new Map();
  for (const toks of docsTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docsTokens.length || 1;
  function tfidfScore(toks) {
    if (!queryTokens.length || !toks.length) return 0;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const qt of queryTokens) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      const idf = Math.log((N + 1) / ((df.get(qt) || 0) + 1)) + 1;
      score += (f / toks.length) * idf;
    }
    return score;
  }

  let ranked = shortlisted.map((s, i) => {
    const kw = tfidfScore(docsTokens[i]);
    const rec = recencyScore(s.c.modifiedAtMs);
    const combined = kw * 0.6 + s.pathScore * 0.25 + rec * 0.15;
    return {
      path: s.c.path,
      content: s.content,
      score: combined,
      matchedBy: "keyword-tfidf",
      reason: matchReason(queryTokens, s.c.path, docsTokens[i]),
    };
  });

  // Optional, bounded embedding re-rank of the top of the keyword shortlist only.
  let rankingMethod = "keyword-tfidf";
  if (useEmbeddings && ranked.length) {
    try {
      const { embed, isEmbeddingAvailable, cosineSimilarity } = await import("../embeddings.js");
      if (isEmbeddingAvailable()) {
        const top = [...ranked].sort((a, b) => b.score - a.score).slice(0, Math.min(10, ranked.length));
        const qVec = await embed(query);
        if (qVec && qVec.length) {
          let appliedAny = false;
          for (const r of top) {
            try {
              const cVec = await embed(r.content.slice(0, 4000));
              if (cVec && cVec.length === qVec.length) {
                const cos = cosineSimilarity(qVec, cVec);
                r.score = r.score * 0.5 + cos * 0.5;
                r.matchedBy = "keyword-tfidf+embedding";
                appliedAny = true;
              }
            } catch { /* per-file embed failure — keep this file's keyword score */ }
          }
          if (appliedAny) rankingMethod = "keyword-tfidf+embedding-rerank";
        }
      }
    } catch { /* embeddings module unavailable/offline — stay on keyword ranking, honestly */ }
  }
  ranked = ranked.sort((a, b) => b.score - a.score);

  // Assemble the final, budget-capped selection: explicit mentions always win a
  // slot first, then ranked fill until `limit` files or `maxTotalChars` is hit.
  const selected = [];
  let totalChars = 0;

  for (const path of resolvedExplicit) {
    const c = byPath.get(path);
    if (!c) continue;
    let content = "";
    try { content = String((await c.getContent()) ?? ""); } catch { content = ""; }
    const trimmed = content.slice(0, cappedPerFile);
    selected.push({
      path,
      content: trimmed,
      truncated: content.length > trimmed.length,
      score: null,
      matchedBy: "explicit-mention",
      reason: "explicitly referenced by the caller (e.g. an @-mention) — honored ahead of any ranking",
    });
    totalChars += trimmed.length;
  }

  for (const r of ranked) {
    if (selected.length >= cappedLimit) break;
    if (explicitSet.has(r.path)) continue;
    const remaining = totalBudget - totalChars;
    if (remaining <= 0) break;
    const cap = Math.min(cappedPerFile, remaining);
    const trimmed = r.content.slice(0, cap);
    selected.push({
      path: r.path,
      content: trimmed,
      truncated: r.content.length > trimmed.length,
      score: Number(r.score.toFixed(4)),
      matchedBy: r.matchedBy,
      reason: r.reason,
    });
    totalChars += trimmed.length;
  }

  return {
    selected,
    candidatesConsidered: filtered.length,
    candidatesShortlisted: shortlisted.length,
    totalChars,
    budget: { limit: cappedLimit, maxCharsPerFile: cappedPerFile, maxTotalChars: totalBudget },
    rankingMethod,
  };
}
