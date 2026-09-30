// csl-quad-retrieval.js — 4-track hybrid retrieval for the CSL turn.
//
// Sprint 33 Phase 3 deliverable (oc-pickle). Composes four retrieval paths:
// three are MATCH-reuse from the risk register (docs/SPRINT-33-ARCH-RISK-REGISTER.md
// Q2) and one — the lattice pre-filter — is genuinely new and is built
// recall-redundant only, NEVER authoritative.
//
// Anchors (each track cites its source file:line):
//   - dense:  server/lib/cross-lens-discovery.js:231 semanticSearchDtus()
//             wraps server/embeddings.js:293 semanticSearch() — keyword
//             prefilter + embedding re-rank + honest `semantic` fallback flag
//   - bm25:   dtus_fts FTS5 virtual table over dtus(rowid,title,body_json,
//             tags_json,lens_id), server/migrations/024_connective_tissue.js:231
//   - graph:  server/lib/causal-edges.js:147 causalEdgesFor() / :242
//             traceCausalPath() (batched BFS internals :203-217 already handle
//             the N+1 fix inside the lib — we call the public API only)
//   - lattice: server/lib/csl-embedding-bridge.js (oc-embed's Sprint-33
//             deliverable — SOFT-IMPORT: degrades to [] until it lands)
//   - merge:  RRF ported verbatim from server/domains/literary.js:71-78
//             (RRF_K = 60, literary.js:23) — same formula, same constant,
//             no silent drift between the two fusion sites.

const RRF_K = 60; // standard Reciprocal Rank Fusion constant (literary.js:23)

// rank lists -> RRF-fused id->score map
// Ported verbatim from server/domains/literary.js:71-78 per the sprint's
// "don't build an abstraction that already exists" discipline. A different
// RRF_K here would make the same conceptual fusion behave differently in two
// places for no reason — this constant is what oc-qa's RRF test hardcodes.
function rrf(...lists) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, i) => {
      score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1));
    });
  }
  return score;
}

// FTS5 MATCH sanitizer: keep only alnum tokens, quote each, OR-join.
// Mirrors server/domains/literary.js:41-45. Quoting neutralizes the
// characters FTS5 treats as operators (" * - ( ) etc.) — a raw user string
// with a leading "-" would otherwise throw a syntax error.
function ftsMatch(q) {
  const toks = String(q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!toks.length) return null;
  return toks.slice(0, 24).map((t) => `"${t}"`).join(" OR ");
}

// ── Track A: dense vector ─────────────────────────────────────────────────
// cross-lens-discovery.js:231 semanticSearchDtus() — recall prefilter +
// embedding re-rank (embeddings.js:293). Extract the ranked DTU id list.
async function denseTrack(db, query) {
  try {
    const { semanticSearchDtus } = await import("./cross-lens-discovery.js");
    const res = await semanticSearchDtus(db, String(query || ""), { limit: 30 });
    if (!res || !Array.isArray(res.results)) return [];
    return res.results.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Track B: BM25/FTS5 ────────────────────────────────────────────────────
// Direct query of the dtus_fts virtual table (migration 024:231), content-
// linked to dtus via content_rowid='rowid'. bm25() is lower-is-better, so
// ORDER BY rank ASC — the standard FTS5 convention, do not invert it.
async function bm25Track(db, query) {
  try {
    if (!db || typeof db.prepare !== "function") return [];
    const match = ftsMatch(String(query || ""));
    if (!match) return [];
    // FTS5 returns rowid which is the content table's rowid (dtus.rowid).
    // We select from dtus_fts directly with bm25(), then fetch full DTUs by id.
    const rows = db.prepare(`
      SELECT /* @drift-ok: FTS5 external-content implicit rowid mirrors dtus.rowid. */ rowid AS id, bm25(dtus_fts) AS rank
      FROM dtus_fts
      WHERE dtus_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(match, 30);
    return rows.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Track C: graph multi-hop ──────────────────────────────────────────────
// Needs a seed DTU id, not a text query. Bounded 2-hop BFS over causal
// neighbors via causal-edges.js:147 causalEdgesFor() (honest-empty, never
// throws). Visited-set protected against cycles. Deterministic: causalEdgesFor
// returns edges ordered by created_at, so BFS order is stable across runs.
async function graphTrack(db, seedDtuId) {
  try {
    const { causalEdgesFor } = await import("./causal-edges.js");
    const visited = new Set([String(seedDtuId)]);
    const out = [];
    let frontier = [String(seedDtuId)];
    for (let hop = 0; hop < 2 && frontier.length > 0 && out.length < 30; hop++) {
      const next = [];
      for (const nodeId of frontier) {
        const { asChild, asParent } = causalEdgesFor(db, nodeId);
        for (const e of asChild) {
          if (out.length >= 30) break;
          const id = e.parent_id;
          if (id && !visited.has(id)) {
            visited.add(id);
            out.push(id);
            next.push(id);
          }
        }
        for (const e of asParent) {
          if (out.length >= 30) break;
          const id = e.child_id;
          if (id && !visited.has(id)) {
            visited.add(id);
            out.push(id);
            next.push(id);
          }
        }
      }
      frontier = next.slice(0, 24);
    }
    return out;
  } catch {
    return [];
  }
}

// ── Track D: lattice pre-filter (recall-redundant, NEVER authoritative) ───
// Soft-imports oc-embed's bridge — the module may not exist yet (Sprint-33
// cross-worker handoff), so any failure degrades to [] and never blocks the
// merge. The query is embedded through the SAME embeddings_e5 pipeline
// (server/embeddings.js:168 embed(text, type='query')) — no new embed route.
// latticeNeighbors(db, coords, radius, limit) signature per oc-embed's spec;
// confirm against their status doc if they change it.
async function latticeTrack(db, query) {
  try {
    const bridge = await import("./csl-embedding-bridge.js");
    const { embed } = await import("../embeddings.js");
    const qVec = await embed(String(query || ""), "query");
    if (!qVec) return [];
    const coords = bridge.vectorToLatticeCoords(qVec);
    const rows = bridge.latticeNeighbors(db, coords, 5, 30);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => r && r.dtu_id).filter(Boolean);
  } catch {
    return [];
  }
}

// Provenance: which of the 4 tracks contained a fused id. This is what lets
// csl-invariant-gates.js / an audit tell a "lattice-only hit" (low trust,
// recall-redundant) apart from dense+bm25 agreement (high trust).
function sourcesFor(dtuId, { dense, bm25, graph, lattice }) {
  const src = [];
  if (dense.includes(dtuId)) src.push("dense");
  if (bm25.includes(dtuId)) src.push("bm25");
  if (graph.includes(dtuId)) src.push("graph");
  if (lattice.includes(dtuId)) src.push("lattice");
  return src;
}

/**
 * 4-track hybrid retrieval for the CSL turn.
 *
 * @param {object} db - better-sqlite3 handle (read-only usage).
 * @param {string} query - raw user/session text query.
 * @param {object} [opts]
 * @param {string} [opts.seedDtuId] - graph-track anchor (the session's
 *   most-recently-referenced DTU, supplied by csl-core.js via
 *   session-context-accumulator). If absent, the graph track legitimately
 *   returns [] — a query with no graph anchor has no graph track. We do NOT
 *   guess a seed (e.g. "use the top dense hit"): that would make the graph
 *   track circular with the dense track — a real design question deliberately
 *   left for its own review.
 * @param {number} [opts.limit=20]
 * @returns {Promise<{ dtuId: string, score: number, sources: string[],
 *   lowConfidence?: boolean }[]>}
 *
 * Contract: each track returns [] on failure (try/catch inside the track AND
 * a .catch on every Promise.all arm, per docs/SPRINT-33-CSL-PLAN.md:46) — one
 * track's exception never fails the merge. When dense AND bm25 are both empty
 * but the lattice alone returns hits, the whole result set is flagged
 * lowConfidence:true so csl-core step 3 treats it as supplementary, never the
 * sole basis for a DTU citation. Ties at equal fused score resolve by rrf()'s
 * list iteration order (dense, bm25, graph, lattice) — deterministic in
 * modern V8; no extra tie-break logic is needed.
 */
export async function quadRetrieve(db, query, opts = {}) {
  const { seedDtuId } = opts;
  const [dense, bm25, graph, lattice] = await Promise.all([
    denseTrack(db, query).catch(() => []),
    bm25Track(db, query).catch(() => []),
    seedDtuId ? graphTrack(db, seedDtuId).catch(() => []) : Promise.resolve([]),
    latticeTrack(db, query).catch(() => []),
  ]);

  const fused = rrf(dense, bm25, graph, lattice);
  const ranked = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.limit || 20);

  const lowConfidence = dense.length === 0 && bm25.length === 0 && lattice.length > 0;
  return ranked.map(([dtuId, score]) => ({
    dtuId,
    score,
    sources: sourcesFor(dtuId, { dense, bm25, graph, lattice }),
    ...(lowConfidence ? { lowConfidence: true } : {}),
  }));
}
