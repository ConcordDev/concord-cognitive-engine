// server/lib/literary-rerank.js
//
// LRL Phase 3 — final-stage rerank over the RRF-fused candidates. A true
// cross-encoder (bge-reranker-v2-m3) is the documented upgrade path; it needs a
// reranker serving endpoint that isn't part of the local Ollama stack, so the
// shipped default is a deterministic LEXICAL precision pass that re-orders the
// fused top-k by query-term coverage + exact-phrase presence. This recovers the
// "similarity ≠ relevance" gap (the failure mode rerankers exist to fix) for the
// common case of exact-term / phrase queries, with zero extra latency or deps.
//
// Kill-switch LRL_RERANK=0 (returns the fused order untouched).

function lexicalScore(query, text) {
  const terms = String(query || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!terms.length) return 0;
  const uniq = [...new Set(terms)];
  const hay = String(text || "").toLowerCase();
  let present = 0;
  for (const term of uniq) if (hay.includes(term)) present += 1;
  const coverage = present / uniq.length;            // 0..1 term coverage
  const phrase = hay.includes(String(query).toLowerCase().trim()) ? 0.4 : 0; // exact-phrase bonus
  return Math.min(1, coverage * 0.7 + phrase);
}

/**
 * Re-order fused hits by blending the RRF score with the lexical relevance score.
 * Stable, deterministic, never drops or adds hits. Adds `rerankScore` + `lex`.
 * @param {string} query
 * @param {Array<{score?:number,title?:string,snippet?:string,heading?:string}>} hits
 * @param {{weight?:number}} opts blend weight on the lexical term (default 0.25)
 */
export function rerankHits(query, hits, opts = {}) {
  if (process.env.LRL_RERANK === "0") return hits;
  if (!Array.isArray(hits) || hits.length < 2) return hits;
  const weight = opts.weight != null ? Number(opts.weight) : 0.25;
  const scored = hits.map((h, i) => {
    const lex = lexicalScore(query, `${h.title || ""} ${h.heading || ""} ${h.snippet || ""}`);
    return { hit: h, i, lex, rerankScore: (h.score || 0) * (1 + weight * lex) };
  });
  // Sort by reranked score; ties keep original fused order (stable on i).
  scored.sort((a, b) => (b.rerankScore - a.rerankScore) || (a.i - b.i));
  return scored.map((s) => ({ ...s.hit, rerankScore: Math.round(s.rerankScore * 1e4) / 1e4, lex: Math.round(s.lex * 1e3) / 1e3 }));
}

export { lexicalScore };
export default { rerankHits, lexicalScore };
