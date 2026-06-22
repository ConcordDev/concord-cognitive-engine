// server/lib/music-resonance.js
//
// Music Resonance (#43) — the second corpus on the Literary Resonance Lattice.
// Reuses the exact hybrid-retrieval shape the literary lattice uses (BM25 over
// an FTS5 index + dense cosine over DTU embeddings, fused by Reciprocal Rank
// Fusion), and bridges music → literary so a lyric can surface the public-domain
// passage it resonates with. Offline-honest: when embeddings are unavailable
// (no Ollama) the dense half is skipped and search degrades to BM25 keyword
// retrieval with `semantic:false` — never faked.
//
// LICENSE: user-authored / PD / CC content only (see migration 343).

import { createDTU } from "../economy/dtu-pipeline.js";
import { embed, cosineSimilarity } from "../embeddings.js";

const RRF_K = 60;
const DENSE_SCAN_CAP = 2000;
let _idc = 0;
function mid(p) { return `${p}_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

// free text → safe FTS5 MATCH expression (alnum tokens OR'd, each quoted).
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

function rrf(...lists) {
  const score = new Map();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1)));
  return score;
}

const VALID_KINDS = new Set(["lyric", "verse", "chorus", "bridge", "instrumental", "note"]);

/**
 * Ingest a track: create the track row, mint a DTU per section, index each in
 * FTS. `sections` is [{content, kind?, heading?}] or plain strings. Never throws
 * the caller out — returns { ok, trackId, chunks }.
 */
export function ingestTrack(db, meta = {}, sections = [], { creatorId = "system" } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!meta.title) return { ok: false, reason: "missing_title" };
  const list = (Array.isArray(sections) ? sections : [])
    .map((s) => (typeof s === "string" ? { content: s } : s))
    .filter((s) => s && s.content);
  if (!list.length) return { ok: false, reason: "no_sections" };

  const trackId = mid("mt");
  const created = [];
  try {
    const insChunk = db.prepare(`INSERT INTO music_chunks (id, track_id, dtu_id, ord, kind, heading, content, token_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insFts = db.prepare(`INSERT INTO music_chunks_fts (chunk_id, content) VALUES (?, ?)`);
    db.transaction(() => {
      db.prepare(`INSERT INTO music_tracks (id, title, artist, era, genre, mood_json, license, source_url, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(trackId, meta.title, meta.artist || null, meta.era || null, meta.genre || null,
          JSON.stringify(meta.mood || []), meta.license || "user_authored", meta.sourceUrl || null, list.length);
      list.forEach((s, i) => {
        const kind = VALID_KINDS.has(s.kind) ? s.kind : "lyric";
        const chunkId = mid("mc");
        // Mint a DTU so the chunk is a lattice citizen (embeddings/CRETI/resonance).
        let dtuId = null;
        try {
          const r = createDTU(db, {
            creatorId, title: `${meta.title}${s.heading ? " — " + s.heading : ` [${kind} ${i + 1}]`}`,
            content: s.content, contentType: "text", lensId: "music",
            citationMode: "original", tags: ["music", "lyric", kind],
            metadata: { kind: "music_chunk", trackTitle: meta.title, artist: meta.artist || null },
          });
          if (r?.ok && r.dtu?.id) dtuId = r.dtu.id;
        } catch { /* DTU mint best-effort */ }
        insChunk.run(chunkId, trackId, dtuId, i, kind, s.heading || null, s.content, estimateTokens(s.content));
        insFts.run(chunkId, s.content);
        created.push({ id: chunkId, dtuId, kind });
      });
    })();
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, trackId, chunks: created };
}

function rowFor(db, chunkId) {
  return db.prepare(`
    SELECT c.id AS chunkId, c.dtu_id AS dtuId, c.kind, c.heading, c.content,
           t.id AS trackId, t.title, t.artist, t.era, t.genre, t.license, t.source_url AS sourceUrl
    FROM music_chunks c JOIN music_tracks t ON t.id = c.track_id WHERE c.id = ?
  `).get(chunkId);
}

/**
 * Hybrid search over the music corpus. BM25 always; dense cosine when an
 * embedding is available. Returns { ok, results, semantic, count }.
 */
export async function searchMusic(db, input = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const query = String(input.query || "").trim();
  if (!query) return { ok: true, results: [], semantic: false, count: 0 };
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const candidateK = Math.min(Math.max(Number(input.candidateK) || 50, limit), 200);

  let bm25Ids = [];
  const match = ftsQuery(query);
  if (match) {
    try {
      bm25Ids = db.prepare(`SELECT chunk_id FROM music_chunks_fts WHERE music_chunks_fts MATCH ? ORDER BY bm25(music_chunks_fts) LIMIT ?`)
        .all(match, candidateK).map((r) => r.chunk_id);
    } catch { bm25Ids = []; }
  }

  let denseIds = [];
  let semantic = false;
  let qvec = null;
  try { qvec = input.keyword === true ? null : await embed(query); } catch { qvec = null; }
  if (qvec) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT c.id AS chunkId, e.embedding AS emb FROM music_chunks c JOIN embedding_cache e ON e.dtu_id = c.dtu_id LIMIT ?`).all(DENSE_SCAN_CAP);
    } catch { rows = []; }
    const scored = [];
    for (const r of rows) {
      const v = decodeVec(r.emb);
      if (v && v.length === qvec.length) scored.push([r.chunkId, cosineSimilarity(qvec, v)]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    denseIds = scored.slice(0, candidateK).map((x) => x[0]);
    semantic = scored.length > 0;
  }

  const fused = rrf(denseIds, bm25Ids);
  if (fused.size === 0) return { ok: true, results: [], semantic, count: 0 };
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const results = ranked.map(([chunkId, score]) => {
    const row = rowFor(db, chunkId);
    if (!row) return null;
    return { chunkId: row.chunkId, dtuId: row.dtuId, title: row.title, artist: row.artist, kind: row.kind, heading: row.heading, snippet: snippet(row.content), score: Math.round(score * 10000) / 10000 };
  }).filter(Boolean);
  return { ok: true, results, semantic, count: results.length };
}

function snippet(text, n = 200) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Cross-corpus bridge: given a music chunk (or free-text), find the literary
 * passages it resonates with — making the lattice genuinely cross-domain. Uses
 * the literary lattice's own hybrid search so the bridge inherits BM25+dense.
 */
export async function bridgeToLiterary(db, { chunkId = null, query = null, limit = 5, keyword } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  let q = query;
  if (!q && chunkId) {
    const row = db.prepare(`SELECT content FROM music_chunks WHERE id = ?`).get(chunkId);
    q = row?.content || null;
  }
  if (!q) return { ok: false, reason: "no_query_or_chunk" };
  try {
    const { searchLiterary } = await import("../domains/literary.js");
    const r = await searchLiterary(db, { query: q, limit, keyword });
    return { ok: true, bridges: r.results || [], semantic: !!r.semantic, sourceQuery: snippet(q, 120) };
  } catch (e) {
    return { ok: false, reason: "bridge_failed", error: String(e?.message || e) };
  }
}

/** Corpus stats. */
export function musicCorpusStats(db) {
  try {
    const t = db.prepare(`SELECT COUNT(*) AS n FROM music_tracks`).get().n;
    const c = db.prepare(`SELECT COUNT(*) AS n FROM music_chunks`).get().n;
    return { ok: true, tracks: t, chunks: c };
  } catch {
    return { ok: true, tracks: 0, chunks: 0 };
  }
}

export default { ingestTrack, searchMusic, bridgeToLiterary, musicCorpusStats };
