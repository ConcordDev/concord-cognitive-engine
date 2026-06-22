// server/tests/literary-ingest.test.js
//
// LRL Phase 1 — chunking + ingestion round-trip, fully offline (no network, no
// Ollama). Embeddings are disabled (doEmbed:false); the keyword/BM25 + DTU-mint
// path is what's pinned here. Dense retrieval degrades gracefully and is covered
// behaviorally once a live embedder is available.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { chunkText, estimateTokens, ingestWork } from "../lib/literary-ingest.js";

const SAMPLE = `
The Tragedy of Hamlet

CHAPTER I. The Platform

Who's there? Nay, answer me. Stand and unfold yourself.
Long live the King! Bernardo? He. You come most carefully upon your hour.
'Tis now struck twelve. Get thee to bed, Francisco. For this relief much thanks.
${"The night is bitter cold and I am sick at heart. ".repeat(60)}

CHAPTER II. A Room of State

To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune,
Or to take arms against a sea of troubles,
And by opposing end them. To die, to sleep,
No more; and by a sleep to say we end
The heart-ache and the thousand natural shocks
That flesh is heir to.
${"Thus conscience does make cowards of us all. ".repeat(60)}
`;

describe("LRL — chunkText (structure-aware)", () => {
  it("splits on chapter headings and tags chunks with chapter numbers", () => {
    const chunks = chunkText(SAMPLE);
    assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
    const chapters = new Set(chunks.map((c) => c.chapterNum).filter(Boolean));
    assert.ok(chapters.size >= 2, "should detect at least two chapters");
    // Headings carried onto chunks
    assert.ok(chunks.some((c) => /Platform/i.test(c.heading || "")), "carries chapter heading");
  });

  it("respects the ~450-token target with overlap (no runaway chunks)", () => {
    const chunks = chunkText(SAMPLE);
    for (const c of chunks) {
      assert.ok(c.tokenCount <= 600, `chunk too large: ${c.tokenCount} tokens`);
      assert.equal(c.tokenCount, estimateTokens(c.content));
    }
  });

  it("returns [] on empty input", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText(null), []);
  });
});

describe("LRL — ingestWork round-trip (offline, no embeddings)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("ingests a work into sources + chunks + FTS, minting a DTU per chunk", async () => {
    const res = await ingestWork(
      db,
      { gutenbergId: "1524", title: "Hamlet", author: "William Shakespeare", era: "renaissance", genre: "drama", themes: ["mortality", "revenge"], pdVerified: 1 },
      SAMPLE,
      { doEmbed: false },
    );
    assert.equal(res.ok, true);
    assert.ok(res.chunks >= 2, "ingested multiple chunks");

    const src = db.prepare("SELECT * FROM literary_sources WHERE id = ?").get("gut_1524");
    assert.ok(src, "source row exists");
    assert.equal(src.license, "public_domain");
    assert.equal(src.pd_verified, 1);
    assert.equal(src.chunk_count, res.chunks);

    const chunkRows = db.prepare("SELECT * FROM literary_chunks WHERE source_id = ?").all("gut_1524");
    assert.equal(chunkRows.length, res.chunks);
    // Every chunk linked to a real minted DTU
    for (const c of chunkRows) {
      assert.ok(c.dtu_id, "chunk has a dtu_id");
      const dtu = db.prepare("SELECT id, lens_id, content FROM dtus WHERE id = ?").get(c.dtu_id);
      assert.ok(dtu, "the linked DTU exists");
      assert.equal(dtu.lens_id, "literary");
      assert.ok(dtu.content && dtu.content.length > 0, "DTU carries the chunk text");
    }
  });

  it("BM25 keyword retrieval finds a known phrase and joins back to a DTU", () => {
    const hit = db
      .prepare(`
        SELECT f.chunk_id, c.dtu_id, bm25(literary_chunks_fts) AS rank
        FROM literary_chunks_fts f
        JOIN literary_chunks c ON c.id = f.chunk_id
        WHERE literary_chunks_fts MATCH ?
        ORDER BY rank
        LIMIT 1
      `)
      .get("question");
    assert.ok(hit, "found a chunk matching 'question'");
    assert.ok(hit.dtu_id, "the FTS hit joins to a DTU");
  });

  it("is idempotent — re-ingesting the same work is a no-op", async () => {
    const again = await ingestWork(
      db,
      { gutenbergId: "1524", title: "Hamlet", author: "William Shakespeare" },
      SAMPLE,
      { doEmbed: false },
    );
    assert.equal(again.ok, true);
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already_ingested");
    const n = db.prepare("SELECT COUNT(*) AS n FROM literary_chunks WHERE source_id = ?").get("gut_1524").n;
    assert.equal(n, again.chunks, "no duplicate chunks created");
  });
});
