// EMBEDDING-SEARCH TOOL regression test (FIX-ALL Q34, audit row B#22).
//
// Pins the fix for: the embedding_search MCP tool (lib/mcp-tools.js
// embeddingSearch) ignored its query entirely and returned the most
// RECENT embeddings_e5 rows with a note saying semantic search
// "requires the embedding model loaded in-process" — while its own
// registry description promised "DTU ids ranked by cosine similarity
// to query". The tool now embeds the query via server/embeddings.js
// (the same mxbai-embed-large layer whose embed() populated
// embeddings_e5, so the spaces match) and ranks stored vectors by
// cosine. When the model is unavailable it returns an honest error —
// never unranked recent rows.
//
// The embedder is injected (deps seam, the codebase's proof-gate
// convention) so no live model is called; cosineSimilarity is the
// real one from server/embeddings.js. Toy 4-dim vectors keep the
// expected ranking hand-computable.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { embeddingSearch } from "../lib/mcp-tools.js";
import { cosineSimilarity } from "../embeddings.js";

const vec = (xs) => Buffer.from(new Float32Array(xs).buffer);

// Scrambled insertion order on purpose: ranking must come from
// cosine, never from recency/insertion order.
const ROWS = [
  { dtu_id: "dtu_orthogonal", vector: vec([0, 1, 0, 0]), dim: 4, model: "mxbai-embed-large", source: "dtu.creti", created_at: "2026-10-03T00:00:00.000Z" },
  { dtu_id: "dtu_identical", vector: vec([1, 0, 0, 0]), dim: 4, model: "mxbai-embed-large", source: "dtu.creti", created_at: "2026-10-01T00:00:00.000Z" },
  { dtu_id: "dtu_missing", vector: null, dim: 4, model: "mxbai-embed-large", source: "dtu.creti", created_at: "2026-10-05T00:00:00.000Z" },
  { dtu_id: "dtu_diagonal", vector: vec([Math.SQRT1_2, Math.SQRT1_2, 0, 0]), dim: 4, model: "mxbai-embed-large", source: "dtu.creti", created_at: "2026-10-02T00:00:00.000Z" },
  { dtu_id: "dtu_wrong_dim", vector: vec([1, 0, 0]), dim: 3, model: "all-minilm", source: "dtu.creti", created_at: "2026-10-04T00:00:00.000Z" },
];

const fakeDb = {
  prepare(sql) {
    assert.match(sql, /FROM embeddings_e5/);
    return { all: (n) => ROWS.slice(0, n) };
  },
};

const fakeEmbed = async (text, type) => {
  assert.equal(type, "query");
  assert.equal(text, "find me the identical one");
  return new Float32Array([1, 0, 0, 0]);
};

describe("embeddingSearch tool wiring (Q34)", () => {
  it("ranks by cosine similarity to the query — not by recency", async () => {
    const r = await embeddingSearch(fakeDb, { query: "find me the identical one", limit: 10 }, { embed: fakeEmbed, cosineSimilarity });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.results.map((x) => x.dtu_id), ["dtu_identical", "dtu_diagonal", "dtu_orthogonal"]);
    assert.ok(Math.abs(r.results[0].score - 1) < 1e-6);
    assert.ok(Math.abs(r.results[1].score - Math.SQRT1_2) < 1e-6);
    assert.ok(Math.abs(r.results[2].score - 0) < 1e-6);
    assert.equal(r.count, 3);
  });

  it("accounts for skipped rows instead of silently dropping them", async () => {
    const r = await embeddingSearch(fakeDb, { query: "find me the identical one", limit: 10 }, { embed: fakeEmbed, cosineSimilarity });
    assert.equal(r.scanned, 5);
    assert.equal(r.skipped_dim_mismatch, 1);
    assert.equal(r.skipped_missing_vector, 1);
  });

  it("respects the limit after ranking", async () => {
    const r = await embeddingSearch(fakeDb, { query: "find me the identical one", limit: 2 }, { embed: fakeEmbed, cosineSimilarity });
    assert.deepEqual(r.results.map((x) => x.dtu_id), ["dtu_identical", "dtu_diagonal"]);
    assert.equal(r.count, 2);
  });

  it("model unavailable is an honest error — no recent-rows fallback", async () => {
    const r = await embeddingSearch(fakeDb, { query: "anything" }, { embed: async () => null, cosineSimilarity });
    assert.equal(r.ok, false);
    assert.match(r.error, /embedding model unavailable/);
    assert.equal(r.results, undefined);
  });

  it("requires a query", async () => {
    const r = await embeddingSearch(fakeDb, {}, { embed: fakeEmbed, cosineSimilarity });
    assert.equal(r.ok, false);
    assert.match(r.error, /query is required/);
  });
});
