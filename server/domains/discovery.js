// server/domains/discovery.js
//
// Phase 6c — macros for cross-lens discovery.

import {
  searchDtus,
  getKindFacets,
  getTrending,
} from "../lib/cross-lens-discovery.js";

export default function registerDiscoveryMacros(register) {
  register("discovery", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return searchDtus(db, input.query, {
      kind: input.kind,
      creatorId: input.creatorId,
      limit: input.limit,
      requesterId: ctx?.actor?.userId || null,
    });
  }, { note: "search DTUs across all lenses" });

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
