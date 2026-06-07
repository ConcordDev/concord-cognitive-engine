// server/domains/discovery.js
//
// Phase 6c — macros for cross-lens discovery.

import {
  searchDtus,
  semanticSearchDtus,
  getKindFacets,
  getTrending,
} from "../lib/cross-lens-discovery.js";

export default function registerDiscoveryMacros(register) {
  register("discovery", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const opts = {
      kind: input.kind,
      lens: input.lens || input.lensHint || null,
      // mine:true scopes to the caller's OWN DTUs ("search my archive"); else
      // search the whole visible corpus.
      creatorId: input.mine ? (ctx?.actor?.userId || null) : input.creatorId,
      limit: input.limit,
      requesterId: ctx?.actor?.userId || null,
    };
    // Semantic (embedding) re-rank when available — ConKay's "search my archive"
    // becomes meaning-based, not keyword-only. Pass keyword:true to force the
    // legacy LIKE path. Always falls back to keyword+recency when embeddings are
    // offline; the `semantic` flag in the result reports which actually ran.
    if (input.keyword === true) return searchDtus(db, input.query, opts);
    return semanticSearchDtus(db, input.query, opts);
  }, { note: "semantic + keyword search across all lenses; lens/lensHint scopes, keyword:true forces LIKE" });

  register("discovery", "facets", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, facets: getKindFacets(db, ctx?.actor?.userId || null) };
  }, { note: "kind counts across the corpus" });

  register("discovery", "trending", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, trending: getTrending(db, { lookbackS: input.lookbackS, limit: input.limit }) };
  }, { note: "DTUs with high recent citation activity" });
}
