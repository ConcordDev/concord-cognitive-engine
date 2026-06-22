// server/lib/literary-ingest.js
//
// Literary Resonance Lattice (LRL) — ingestion library (Phase 1).
//
// Turns a cleaned public-domain work into structure-aware chunks, mints each as
// a first-class DTU (economy/dtu-pipeline#createDTU — CRETI + ownership +
// consolidation-eligible), indexes it for BM25 (literary_chunks_fts) and dense
// retrieval (embeddings.embed → embedding_cache, best-effort), and records the
// work in literary_sources. Idempotent per (gutenberg_id | title+author).
//
// Reuse-first: chunking ladder modelled on scripts/ingest-openstax.js#chunkContent;
// DTU mint via createDTU; embeddings via the already-wired Ollama path. Embedding
// generation NEVER blocks ingestion — if Ollama is offline, embed() returns null
// and the chunk is still keyword-searchable (the existing substrate rule).

import { createDTU } from "../economy/dtu-pipeline.js";
import { upsertVec } from "./literary-vec.js";

// embeddings.js is import-side-effectful (opens its own state); import lazily so
// a pure chunkText() caller (e.g. unit tests) doesn't pull the whole stack.
let _embed = null;
let _storeEmbedding = null;
async function loadEmbedder() {
  if (_embed !== null) return;
  try {
    const m = await import("../embeddings.js");
    _embed = m.embed || (() => null);
    _storeEmbedding = m.storeEmbedding || (() => {});
  } catch {
    _embed = () => null;
    _storeEmbedding = () => {};
  }
}

// ── Chunking ────────────────────────────────────────────────────────────────

// ~4 chars/token is the standard English heuristic; target ~450 tokens/chunk
// (within the 400–512 best-practice band) with ~15% overlap.
const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 450;
const OVERLAP_RATIO = 0.15;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = Math.round(TARGET_CHARS * OVERLAP_RATIO);

export function estimateTokens(text) {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

// Heading detection for structure-aware splitting (chapter/act/scene/canto/book).
const HEADING_RE =
  /^\s*(chapter|act|scene|book|canto|part|letter|stave|story)\s+([ivxlcdm\d]+)\b.*$/i;

// Classify a section's prose/verse/drama shape from its line geometry.
function classifyKind(body) {
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return "prose";
  const shortLines = lines.filter((l) => l.trim().length > 0 && l.trim().length < 60).length;
  const speakerCues = lines.filter((l) => /^[A-Z][A-Z .']{2,30}\.$|^[A-Z][a-zA-Z]+\.\s/.test(l.trim())).length;
  if (speakerCues / lines.length > 0.25) return "drama";
  if (shortLines / lines.length > 0.6) return "verse";
  return "prose";
}

// Find the best break point at or before `limit` in `text`: paragraph → sentence
// → line → hard cut (the ingest-openstax ladder, extended with line breaks for verse).
function bestBreak(text, limit) {
  if (text.length <= limit) return text.length;
  const floor = Math.floor(limit * 0.4);
  for (const sep of ["\n\n", ". ", ".\n", "\n", " "]) {
    const idx = text.lastIndexOf(sep, limit);
    if (idx >= floor) return idx + sep.length;
  }
  return limit;
}

function splitSection(body) {
  const out = [];
  let remaining = body.trim();
  while (remaining.length > 0) {
    if (remaining.length <= TARGET_CHARS) {
      out.push(remaining.trim());
      break;
    }
    const cut = bestBreak(remaining, TARGET_CHARS);
    out.push(remaining.slice(0, cut).trim());
    // Step forward leaving an overlap window so context spans the boundary.
    const advance = Math.max(1, cut - OVERLAP_CHARS);
    remaining = remaining.slice(advance).trim();
  }
  return out.filter(Boolean);
}

/**
 * Structure-aware chunking. Returns ordered chunks with chapter + kind metadata.
 * @returns {Array<{ord,chapterNum,kind,heading,content,tokenCount}>}
 */
export function chunkText(fullText, { maxChunks = Infinity } = {}) {
  const normalized = String(fullText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  // Split into structural sections on heading lines.
  const lines = normalized.split("\n");
  const sections = [];
  let current = { heading: null, chapterNum: null, buf: [] };
  let chapterCounter = 0;
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current.buf.join("\n").trim()) sections.push(current);
      chapterCounter += 1;
      current = { heading: line.trim().slice(0, 200), chapterNum: chapterCounter, buf: [] };
    } else {
      current.buf.push(line);
    }
  }
  if (current.buf.join("\n").trim()) sections.push(current);
  if (sections.length === 0) sections.push({ heading: null, chapterNum: null, buf: lines });

  const chunks = [];
  let ord = 0;
  for (const sec of sections) {
    const body = sec.buf.join("\n").trim();
    if (!body) continue;
    const kind = classifyKind(body);
    for (const piece of splitSection(body)) {
      if (chunks.length >= maxChunks) return chunks;
      chunks.push({
        ord: ord++,
        chapterNum: sec.chapterNum,
        kind,
        heading: sec.heading,
        content: piece,
        tokenCount: estimateTokens(piece),
      });
    }
  }
  return chunks;
}

// ── Ingestion ───────────────────────────────────────────────────────────────

function sourceId(meta) {
  const key = meta.gutenbergId
    ? `gut_${meta.gutenbergId}`
    : `lit_${String(meta.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`;
  return key;
}

/**
 * Ingest one work. Idempotent: a source already ingested (chunk_count > 0) is skipped.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} meta { gutenbergId, title, author, era, language, genre, themes[], url, license, pdVerified }
 * @param {string} fullText cleaned plain text
 * @param {object} opts { doEmbed=true, maxChunks }
 * @returns {Promise<{ok, sourceId, chunks, skipped?, reason?}>}
 */
export async function ingestWork(db, meta, fullText, opts = {}) {
  const { doEmbed = true, maxChunks } = opts;
  if (!meta || !meta.title) return { ok: false, error: "missing_title" };
  if (!fullText || !String(fullText).trim()) return { ok: false, error: "empty_text" };

  const sid = sourceId(meta);
  const existing = db.prepare("SELECT id, chunk_count FROM literary_sources WHERE id = ?").get(sid);
  if (existing && existing.chunk_count > 0) {
    return { ok: true, sourceId: sid, chunks: existing.chunk_count, skipped: true, reason: "already_ingested" };
  }

  const chunks = chunkText(fullText, { maxChunks: maxChunks ?? Infinity });
  if (chunks.length === 0) return { ok: false, error: "no_chunks" };

  if (doEmbed) await loadEmbedder();

  const tags = ["literary", "public-domain", meta.author, meta.era, meta.genre]
    .filter(Boolean)
    .map((t) => String(t).toLowerCase());

  db.prepare(`
    INSERT INTO literary_sources (id, gutenberg_id, title, author, era, language, genre, themes_json, license, pd_verified, url, chunk_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title
  `).run(
    sid, meta.gutenbergId || null, meta.title, meta.author || null, meta.era || null,
    meta.language || "en", meta.genre || null, JSON.stringify(meta.themes || []),
    meta.license || "public_domain", meta.pdVerified ? 1 : 0, meta.url || null,
  );

  const insChunk = db.prepare(`
    INSERT INTO literary_chunks (id, source_id, dtu_id, chapter_num, section_num, ord, kind, heading, content, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insFts = db.prepare("INSERT INTO literary_chunks_fts (chunk_id, content) VALUES (?, ?)");
  // Public-domain content is public by construction (citable + discoverable).
  // Prepared once here, not per chunk, to avoid an N+1 prepare in the loop.
  const setPublic = db.prepare("UPDATE dtus SET visibility = 'public' WHERE id = ?");

  let made = 0;
  const embedJobs = [];
  for (const ch of chunks) {
    const chunkId = `${sid}_c${ch.ord}`;
    const title = `${meta.title}${ch.heading ? ` — ${ch.heading}` : ""}`.slice(0, 180);
    let dtuId = null;
    try {
      const res = createDTU(db, {
        creatorId: "system",
        title,
        content: ch.content,
        contentType: "text",
        lensId: "literary",
        tier: "REGULAR",
        tags,
        citationMode: "original",
        metadata: {
          via: "literary-ingest",
          editable: false,
          sourceId: sid,
          gutenbergId: meta.gutenbergId || null,
          author: meta.author || null,
          chapter: ch.chapterNum,
          kind: ch.kind,
          license: meta.license || "public_domain",
        },
      });
      if (res && res.ok) dtuId = res.dtu?.id || res.dtuId || null;
      // Makes the chunk DTU discoverable cross-lens and citable (Phase 4).
      if (dtuId) {
        try { setPublic.run(dtuId); } catch { /* column optional */ }
      }
    } catch {
      // Minting one chunk must never abort the whole work.
      dtuId = null;
    }

    insChunk.run(chunkId, sid, dtuId, ch.chapterNum, ch.section_num ?? null, ch.ord, ch.kind, ch.heading, ch.content, ch.tokenCount);
    insFts.run(chunkId, ch.content);
    made += 1;
    if (doEmbed && dtuId && _embed) embedJobs.push({ dtuId, content: ch.content });
  }

  db.prepare("UPDATE literary_sources SET chunk_count = ? WHERE id = ?").run(made, sid);

  // Dense embeddings — best-effort, after the synchronous DB work. Never throws.
  let embedded = 0;
  if (doEmbed && _embed) {
    for (const job of embedJobs) {
      try {
        const vec = await _embed(job.content);
        if (vec) {
          _storeEmbedding(job.dtuId, vec);
          try { upsertVec(db, job.dtuId, vec); } catch { /* sqlite-vec optional */ }
          embedded += 1;
        }
      } catch { /* graceful — keyword path still works */ }
    }
  }

  return { ok: true, sourceId: sid, chunks: made, embedded };
}

export default { chunkText, estimateTokens, ingestWork };
