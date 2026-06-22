// server/domains/literary.js
//
// Literary Resonance Lattice (LRL) — read-path macros (Phase 1).
//
// Hybrid retrieval over the ingested public-domain corpus:
//   • sparse  — BM25 over literary_chunks_fts (always available)
//   • dense   — query embedding (Ollama via embeddings.embed) vs the literary
//               chunk embeddings persisted in embedding_cache, cosine-scored
// fused with Reciprocal Rank Fusion (the 2026 high-recall pattern). Degrades to
// keyword-only when Ollama is offline (result.semantic === false), mirroring the
// substrate's "embeddings never block" rule. Every hit carries provenance
// (source title/author/era/license + the backing DTU id) so outputs are traceable.
//
// Registered from server.js: `import registerLiteraryMacros from "./domains/literary.js";
// registerLiteraryMacros(register);`

import { embed, cosineSimilarity } from "../embeddings.js";
import { getResonanceEdges } from "../lib/literary-resonance.js";
import { searchVec } from "../lib/literary-vec.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { rerankHits } from "../lib/literary-rerank.js";

const RRF_K = 60; // standard Reciprocal Rank Fusion constant
const DENSE_SCAN_CAP = Number(process.env.LRL_DENSE_SCAN_CAP || 4000); // bound the MVP full-scan; sqlite-vec is the scale path

// Turn free text into a safe FTS5 MATCH expression: alnum tokens OR'd together,
// each quoted so punctuation/operators can't break the query.
function ftsQuery(q) {
  const toks = String(q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!toks.length) return null;
  return toks.slice(0, 24).map((t) => `"${t}"`).join(" OR ");
}

function decodeVec(buf) {
  if (!buf || !buf.byteLength) return null;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function snippet(text, n = 240) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Provenance + display row for a chunk id (joins chunk → source).
function rowFor(db, chunkId) {
  return db.prepare(`
    SELECT c.id AS chunkId, c.dtu_id AS dtuId, c.chapter_num AS chapter, c.kind,
           c.heading, c.content,
           s.id AS sourceId, s.title, s.author, s.era, s.genre, s.language,
           s.license, s.gutenberg_id AS gutenbergId, s.url
    FROM literary_chunks c
    JOIN literary_sources s ON s.id = c.source_id
    WHERE c.id = ?
  `).get(chunkId);
}

// rank lists → RRF-fused id→score map
function rrf(...lists) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, i) => {
      score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1));
    });
  }
  return score;
}

// Core hybrid search, shared by the `search` and `semantic_graph` macros.
async function searchLiterary(db, input = {}) {
  const query = String(input.query || "").trim();
  if (!query) return { ok: true, results: [], semantic: false, count: 0 };
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const candidateK = Math.min(Math.max(Number(input.candidateK) || 50, limit), 200);

  // Sparse (BM25) — always.
  let bm25Ids = [];
  const match = ftsQuery(query);
  if (match) {
    try {
      bm25Ids = db.prepare(`
        SELECT chunk_id FROM literary_chunks_fts
        WHERE literary_chunks_fts MATCH ?
        ORDER BY bm25(literary_chunks_fts) LIMIT ?
      `).all(match, candidateK).map((r) => r.chunk_id);
    } catch { bm25Ids = []; }
  }

  // Dense — best-effort. Embed the query; cosine vs literary chunk embeddings.
  let denseIds = [];
  let semantic = false;
  let qvec = null;
  try { qvec = input.keyword === true ? null : await embed(query); } catch { qvec = null; }
  if (qvec) {
    // Prefer the sqlite-vec ANN index (corpus scale); it returns DTU ids, which
    // we map back to chunk ids for fusion. Fall back to the in-memory cosine
    // scan over embedding_cache when sqlite-vec is unavailable.
    const vecHits = searchVec(db, qvec, candidateK);
    if (vecHits && vecHits.length) {
      const ids = vecHits.map((h) => h.dtuId);
      const map = new Map();
      try {
        const placeholders = ids.map(() => "?").join(",");
        for (const r of db.prepare(`SELECT id, dtu_id FROM literary_chunks WHERE dtu_id IN (${placeholders})`).all(...ids)) {
          map.set(r.dtu_id, r.id);
        }
      } catch { /* fall through to whatever mapped */ }
      denseIds = vecHits.map((h) => map.get(h.dtuId)).filter(Boolean);
      semantic = denseIds.length > 0;
    } else {
      let rows = [];
      try {
        rows = db.prepare(`
          SELECT c.id AS chunkId, e.embedding AS emb
          FROM literary_chunks c
          JOIN embedding_cache e ON e.dtu_id = c.dtu_id
          LIMIT ?
        `).all(DENSE_SCAN_CAP);
      } catch { rows = []; } // embedding_cache created by embeddings.js init; absent → no dense
      const scored = [];
      for (const r of rows) {
        const v = decodeVec(r.emb);
        if (v && v.length === qvec.length) scored.push([r.chunkId, cosineSimilarity(qvec, v)]);
      }
      scored.sort((a, b) => b[1] - a[1]);
      denseIds = scored.slice(0, candidateK).map((x) => x[0]);
      semantic = scored.length > 0;
    }
  }

  // Fuse. If only one list has results, RRF degrades to that list's order.
  const fused = rrf(denseIds, bm25Ids);
  if (fused.size === 0) return { ok: true, results: [], semantic, count: 0 };
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  const results = ranked.map(([chunkId, fusedScore]) => {
    const row = rowFor(db, chunkId);
    if (!row) return null;
    return {
      chunkId: row.chunkId,
      dtuId: row.dtuId,
      title: row.title,
      author: row.author,
      era: row.era,
      chapter: row.chapter,
      kind: row.kind,
      heading: row.heading,
      snippet: snippet(row.content),
      score: Math.round(fusedScore * 1e4) / 1e4,
      provenance: {
        sourceId: row.sourceId, dtuId: row.dtuId, title: row.title,
        author: row.author, license: row.license, gutenbergId: row.gutenbergId, url: row.url,
      },
    };
  }).filter(Boolean);

  // Final precision pass — lexical rerank over the fused candidates.
  const reranked = rerankHits(query, results);
  return { ok: true, results: reranked, count: reranked.length, semantic, fusion: "rrf+lexrerank" };
}

export default function registerLiteraryMacros(register) {
  register("literary", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return searchLiterary(db, input);
  }, { note: "hybrid BM25+dense (RRF) literary search; keyword:true forces sparse-only; every hit carries provenance" });

  register("literary", "detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const row = rowFor(db, String(input.chunkId || ""));
    if (!row) return { ok: false, reason: "not_found" };
    const neighbors = db.prepare(`
      SELECT c.id AS chunkId, c.ord, c.heading, substr(c.content,1,120) AS preview
      FROM literary_chunks c
      WHERE c.source_id = ? AND c.id != ?
      ORDER BY abs(c.ord - (SELECT ord FROM literary_chunks WHERE id = ?))
      LIMIT 4
    `).all(row.sourceId, row.chunkId, row.chunkId);
    return { ok: true, chunk: row, neighbors };
  }, { note: "full chunk + source + neighbouring chunks for reading context" });

  register("literary", "provenance", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    let src = null;
    if (input.chunkId) {
      src = db.prepare(`
        SELECT s.* FROM literary_sources s
        JOIN literary_chunks c ON c.source_id = s.id WHERE c.id = ?
      `).get(String(input.chunkId));
    } else if (input.dtuId) {
      src = db.prepare(`
        SELECT s.* FROM literary_sources s
        JOIN literary_chunks c ON c.source_id = s.id WHERE c.dtu_id = ?
      `).get(String(input.dtuId));
    } else if (input.sourceId) {
      src = db.prepare("SELECT * FROM literary_sources WHERE id = ?").get(String(input.sourceId));
    }
    if (!src) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      provenance: {
        sourceId: src.id, title: src.title, author: src.author, era: src.era,
        genre: src.genre, language: src.language, license: src.license,
        pdVerified: !!src.pd_verified, gutenbergId: src.gutenberg_id, url: src.url,
        chunkCount: src.chunk_count,
      },
    };
  }, { note: "source-of-truth provenance for a chunk/dtu/source — title, author, license, gutenberg id" });

  // Resonance graph for the frontend GraphView (nodes:{id,label,group,weight},
  // edges:{source,target,kind}). Top hits as nodes; edges by shared work/author.
  register("literary", "semantic_graph", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 24, 2), 60);
    const res = await searchLiterary(db, { query: input.query, limit });
    const hits = (res && res.results) || [];
    const nodes = hits.map((h) => ({
      id: h.chunkId,
      label: h.title + (h.chapter ? ` · ${h.chapter}` : ""),
      group: h.author || h.era || "literary",
      weight: Math.min(1, (h.score || 0) * 20),
    }));
    const edges = [];
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        if (hits[i].provenance.sourceId === hits[j].provenance.sourceId) {
          edges.push({ source: hits[i].chunkId, target: hits[j].chunkId, kind: "sibling" });
        } else if (hits[i].author && hits[i].author === hits[j].author) {
          edges.push({ source: hits[i].chunkId, target: hits[j].chunkId, kind: "author" });
        }
      }
    }
    return { ok: true, nodes, edges, semantic: res?.semantic ?? false };
  }, { note: "resonance graph for GraphView — nodes = top hits, edges by shared work/author" });

  // Cross-domain resonance edges for a literary chunk/DTU (Phase 2). Resolves a
  // chunkId → its DTU, then returns the recorded bridges into other lenses.
  register("literary", "resonance", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    let dtuId = input.dtuId || null;
    if (!dtuId && input.chunkId) {
      const row = db.prepare("SELECT dtu_id FROM literary_chunks WHERE id = ?").get(String(input.chunkId));
      dtuId = row?.dtu_id || null;
    }
    if (!dtuId) return { ok: false, reason: "not_found" };
    return { ok: true, dtuId, edges: getResonanceEdges(db, dtuId, input.limit) };
  }, { note: "cross-domain resonance edges (literary → other lenses) for a chunk/dtu" });

  // Phase 4 — annotation crystallization. A reader's highlight + note becomes a
  // NEW derivative DTU that cites the source passage, so the lattice self-grows
  // from human engagement (and the royalty cascade tracks the lineage).
  register("literary", "annotate", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const chunkId = String(input.chunkId || "");
    const note = String(input.note || "").trim();
    const quote = String(input.quote || "").trim();
    if (!chunkId || !note) return { ok: false, reason: "missing_input" };
    const chunk = db.prepare(`
      SELECT c.dtu_id AS dtuId, s.title, s.author
      FROM literary_chunks c JOIN literary_sources s ON s.id = c.source_id
      WHERE c.id = ?
    `).get(chunkId);
    if (!chunk || !chunk.dtuId) return { ok: false, reason: "not_found" };
    const userId = ctx?.actor?.userId || "anon";
    const content = `Annotation on "${chunk.title}"${chunk.author ? ` by ${chunk.author}` : ""}:\n\n${quote ? `> ${quote}\n\n` : ""}${note}`;
    try {
      const res = createDTU(db, {
        creatorId: userId,
        title: `Note: ${chunk.title}`.slice(0, 160),
        content,
        contentType: "text",
        lensId: "literary",
        tier: "REGULAR",
        tags: ["literary", "annotation", chunk.author].filter(Boolean).map((t) => String(t).toLowerCase()),
        citationMode: "derivative",
        citations: [{ parentId: chunk.dtuId, parentCreatorId: "system", generation: 1 }],
        metadata: { via: "literary-annotation", sourceChunkId: chunkId, sourceTitle: chunk.title },
      });
      if (!res || !res.ok) return { ok: false, reason: res?.error || "create_failed" };
      return { ok: true, dtuId: res.dtu?.id, citedChunkId: chunkId };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  }, { note: "reader annotation → derivative DTU citing the source passage (self-growing lattice)" });

  // Phase 4 — crystallization candidates: the passages bridging the most other
  // domains (highest resonance edge count). These are what a consolidation pass
  // would promote toward MEGA/HYPER tiers.
  register("literary", "crystallize", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
    let crystals = [];
    try {
      crystals = db.prepare(`
        SELECT c.id AS chunkId, c.dtu_id AS dtuId, c.heading, s.title, s.author,
               COUNT(r.id) AS edgeCount, ROUND(AVG(r.score), 4) AS avgScore
        FROM literary_resonance_edges r
        JOIN literary_chunks c ON c.dtu_id = r.literary_dtu_id
        JOIN literary_sources s ON s.id = c.source_id
        GROUP BY r.literary_dtu_id
        ORDER BY edgeCount DESC, avgScore DESC
        LIMIT ?
      `).all(limit);
    } catch { crystals = []; }
    return { ok: true, crystals };
  }, { note: "most-bridged passages — crystallization candidates for tier promotion" });

  // Tier-1 LRL-as-hub: unified resonance + citation force-graph for GraphView
  // (#46 generative art / #35 royalty viz). Composes cross-domain resonance edges
  // (literary_resonance_edges) ∪ citation ancestry (royalty_lineage). N+1-free:
  // edges first, then one batched IN-query for node titles.
  register("literary", "resonance_graph", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 120, 10), 500);
    const focus = input.dtuId ? String(input.dtuId) : null;
    const edges = [];
    const ids = new Set();

    if (input.includeResonance !== false) {
      try {
        const rows = focus
          ? db.prepare("SELECT literary_dtu_id AS src, target_dtu_id AS tgt, score FROM literary_resonance_edges WHERE literary_dtu_id = ? OR target_dtu_id = ? ORDER BY score DESC LIMIT ?").all(focus, focus, limit)
          : db.prepare("SELECT literary_dtu_id AS src, target_dtu_id AS tgt, score FROM literary_resonance_edges ORDER BY score DESC LIMIT ?").all(limit);
        for (const r of rows) { edges.push({ source: r.src, target: r.tgt, kind: "resonance", weight: Math.round((r.score || 0) * 1e3) / 1e3 }); ids.add(r.src); ids.add(r.tgt); }
      } catch { /* table absent → skip */ }
    }
    if (input.includeCitations !== false) {
      try {
        const rows = focus
          ? db.prepare("SELECT parent_id AS src, child_id AS tgt, generation FROM royalty_lineage WHERE parent_id = ? OR child_id = ? ORDER BY created_at DESC LIMIT ?").all(focus, focus, limit)
          : db.prepare("SELECT parent_id AS src, child_id AS tgt, generation FROM royalty_lineage ORDER BY created_at DESC LIMIT ?").all(limit);
        for (const r of rows) { edges.push({ source: r.src, target: r.tgt, kind: "citation", weight: 1 / (1 + (r.generation || 0)) }); ids.add(r.src); ids.add(r.tgt); }
      } catch { /* table absent → skip */ }
    }

    const nodes = [];
    if (ids.size) {
      const arr = [...ids];
      const meta = new Map();
      try {
        const ph = arr.map(() => "?").join(",");
        for (const row of db.prepare(`SELECT id, title, lens_id FROM dtus WHERE id IN (${ph})`).all(...arr)) meta.set(row.id, row);
      } catch { /* dtus present, stay safe */ }
      for (const id of arr) {
        const m = meta.get(id);
        nodes.push({ id, label: String(m?.title || id).slice(0, 60), group: m?.lens_id || "dtu", weight: id === focus ? 1 : 0.4 });
      }
    }
    return { ok: true, nodes, edges, focus, counts: { nodes: nodes.length, edges: edges.length } };
  }, { note: "unified resonance + citation force-graph (GraphView shape)" });

  register("literary", "resonance_stats", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    let resonance = 0, citations = 0;
    try { resonance = db.prepare("SELECT COUNT(*) n FROM literary_resonance_edges").get().n; } catch { /* absent */ }
    try { citations = db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n; } catch { /* absent */ }
    return { ok: true, resonance, citations };
  }, { note: "edge counts: resonance bridges + citation lineage" });

  register("literary", "stats", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sources = db.prepare("SELECT COUNT(*) AS n FROM literary_sources").get().n;
    const chunks = db.prepare("SELECT COUNT(*) AS n FROM literary_chunks").get().n;
    let embedded = 0;
    try {
      embedded = db.prepare(`
        SELECT COUNT(*) AS n FROM literary_chunks c JOIN embedding_cache e ON e.dtu_id = c.dtu_id
      `).get().n;
    } catch { embedded = 0; } // embedding_cache created lazily by embeddings.js init
    return { ok: true, sources, chunks, embedded };
  }, { note: "corpus counts: works, chunks, embedded chunks" });
}

export { searchLiterary };
