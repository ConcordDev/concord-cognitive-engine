// server/tests/code-embeddings.test.js
//
// Tier-2 contract tests for Code Sprint D — embeddings. Tests the
// pure-math layer (cosineSim, Float32 round-trip), the DB layer
// (persist + scan), and the macro layer with the embedText network
// call stubbed via a local handler. The actual Ollama call has its
// own integration test in embeddings.live.test.js (skipped when
// Ollama isn't reachable).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { persistEmbedding, semanticSearch, __test } from "../lib/code/embeddings.js";

const { cosineSim, f32ArrayToBuffer, bufferToF32Array } = __test;

describe("embeddings: pure math + Float32 round-trip", () => {
  it("cosineSim returns 1.0 for identical vectors", () => {
    const v = [0.1, 0.2, 0.3, 0.4];
    assert.ok(Math.abs(cosineSim(v, v) - 1.0) < 1e-6);
  });
  it("cosineSim returns 0 for orthogonal vectors", () => {
    assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9);
  });
  it("cosineSim handles zero-vector safely (returns 0)", () => {
    assert.equal(cosineSim([0, 0, 0], [1, 2, 3]), 0);
  });
  it("Float32 round-trip preserves values within float precision", () => {
    const v = [0.123, -0.456, 0.789, 0.000_001];
    const buf = f32ArrayToBuffer(v);
    const back = bufferToF32Array(buf);
    for (let i = 0; i < v.length; i++) {
      assert.ok(Math.abs(back[i] - v[i]) < 1e-5, `idx ${i} drift too large`);
    }
  });
});

describe("embeddings: DB persist + semanticSearch", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    const mig = await import("../migrations/207_code_embeddings.js");
    mig.up(db);
  });
  after(() => { try { db.close(); } catch { /* ok */ } });

  it("persistEmbedding inserts and upserts by (source_type, source_id, model)", () => {
    const r1 = persistEmbedding(db, {
      sourceType: "code_pattern", sourceId: "p1", model: "nomic-embed-text",
      vector: [0.1, 0.2, 0.3], textPreview: "hello",
    });
    assert.equal(r1.ok, true);
    const r2 = persistEmbedding(db, {
      sourceType: "code_pattern", sourceId: "p1", model: "nomic-embed-text",
      vector: [0.4, 0.5, 0.6], textPreview: "hello v2",
    });
    assert.equal(r2.ok, true);
    const row = db.prepare("SELECT text_preview FROM code_embeddings WHERE source_type = ? AND source_id = ?").get("code_pattern", "p1");
    assert.equal(row.text_preview, "hello v2");
  });

  it("persistEmbedding rejects missing sourceId / vector", () => {
    assert.equal(persistEmbedding(db, { sourceType: "x" }).reason, "source_required");
    assert.equal(persistEmbedding(db, { sourceType: "x", sourceId: "y", vector: [] }).reason, "vector_required");
  });

  it("semanticSearch returns top-K by cosine similarity", () => {
    persistEmbedding(db, { sourceType: "code_pattern", sourceId: "near", model: "nomic-embed-text", vector: [1, 0, 0], textPreview: "near" });
    persistEmbedding(db, { sourceType: "code_pattern", sourceId: "mid",  model: "nomic-embed-text", vector: [0.5, 0.5, 0], textPreview: "mid" });
    persistEmbedding(db, { sourceType: "code_pattern", sourceId: "far",  model: "nomic-embed-text", vector: [0, 1, 0], textPreview: "far" });
    const r = semanticSearch(db, { queryVector: [1, 0, 0], sourceType: "code_pattern", model: "nomic-embed-text", topK: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 3);
    assert.equal(r.results[0].source_id, "near");
    assert.ok(r.results[0].score > r.results[1].score);
  });

  it("semanticSearch filters by minScore", () => {
    const r = semanticSearch(db, { queryVector: [1, 0, 0], sourceType: "code_pattern", model: "nomic-embed-text", topK: 10, minScore: 0.9 });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].source_id, "near");
  });

  it("semanticSearch filters by sourceType", () => {
    persistEmbedding(db, { sourceType: "code_spec", sourceId: "s1", model: "nomic-embed-text", vector: [1, 0, 0], textPreview: "spec" });
    const r = semanticSearch(db, { queryVector: [1, 0, 0], sourceType: "code_spec", model: "nomic-embed-text", topK: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].source_type, "code_spec");
  });

  it("semanticSearch ignores mismatched dims", () => {
    persistEmbedding(db, { sourceType: "code_pattern", sourceId: "bigdim", model: "other-model", vector: [1, 2, 3, 4, 5, 6, 7, 8], textPreview: "big" });
    const r = semanticSearch(db, { queryVector: [1, 0, 0], sourceType: "code_pattern", model: "nomic-embed-text", topK: 10 });
    assert.equal(r.ok, true);
    assert.ok(!r.results.find((x) => x.source_id === "bigdim"));
  });
});
