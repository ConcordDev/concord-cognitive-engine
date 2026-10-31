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

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embeddingSearch, _resetEmbeddingSearchLimiter } from "../lib/mcp-tools.js";
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
    return { iterate: (n) => ROWS.slice(0, n)[Symbol.iterator]() };
  },
};
const dbOf = (rows, sqls = []) => ({
  prepare(sql) { sqls.push(sql); return { iterate: (n) => rows.slice(0, n)[Symbol.iterator]() }; },
});
const here = path.dirname(fileURLToPath(import.meta.url));

const fakeEmbed = async (text, type) => {
  assert.equal(type, "query");
  assert.equal(text, "find me the identical one");
  return new Float32Array([1, 0, 0, 0]);
};

describe("embeddingSearch tool wiring (Q34)", () => {
  beforeEach(() => _resetEmbeddingSearchLimiter());

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

describe("embedding_search: auth + bounded cost", () => {
  beforeEach(() => _resetEmbeddingSearchLimiter());

  it("anonymous callers are refused: embedding_search is in MCP_TOOLS_REQUIRE_REAL_AUTH, which /mcp/call 403s", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    const set = src.slice(src.indexOf("const MCP_TOOLS_REQUIRE_REAL_AUTH = new Set(["));
    assert.ok(set.slice(0, set.indexOf("]);")).includes('"embedding_search"'));
    assert.match(src, /MCP_TOOLS_REQUIRE_REAL_AUTH\.has\(tool\) && \(!req\.user \|\| req\.authMethod === "mcp-bypass"\)\) \{\s*return res\.status\(403\)/);
  });

  it("the scan is over the most recent rows, newest first, and the candidate cap is respected", async () => {
    const sqls = [];
    const many = Array.from({ length: 50 }, (_, i) => ({ dtu_id: `d${i}`, vector: vec([1, 0, 0, 0]), dim: 4, model: "m", source: "s", created_at: `2026-10-${String(50 - i).padStart(2, "0")}` }));
    const r = await embeddingSearch(dbOf(many, sqls), { query: "q", limit: 5 }, { embed: async () => new Float32Array([1, 0, 0, 0]), cosineSimilarity, maxScan: 20 });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 20, "only maxScan rows are scored");
    assert.equal(r.truncated, true);
    assert.equal(r.scan_cap, 20);
    assert.equal(r.scan_scope, "most_recent");
    assert.match(sqls[0], /ORDER BY created_at DESC LIMIT \?/);
  });

  it("max k is 50", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ dtu_id: `d${i}`, vector: vec([1, 0, 0, 0]), dim: 4, model: "m", source: "s", created_at: "2026-10-01" }));
    const r = await embeddingSearch(dbOf(many), { query: "q", limit: 9999 }, { embed: async () => new Float32Array([1, 0, 0, 0]), cosineSimilarity });
    assert.equal(r.count, 50);
  });

  it("yields to the event loop while scanning", async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ dtu_id: `d${i}`, vector: vec([1, 0, 0, 0]), dim: 4, model: "m", source: "s", created_at: "2026-10-01" }));
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    await embeddingSearch(dbOf(many), { query: "q" }, { embed: async () => new Float32Array([1, 0, 0, 0]), cosineSimilarity });
    clearInterval(timer);
    assert.ok(ticks >= 1, "timers ran while the scan was in progress");
  });

  it("per-minute rate limit: the (N+1)th call in a minute is shed with busy_retry, and frees after the window", async () => {
    let t = 1_000_000;
    const deps = { embed: async () => new Float32Array([1, 0, 0, 0]), cosineSimilarity, perMin: 3, now: () => t };
    for (let i = 0; i < 3; i++) assert.equal((await embeddingSearch(fakeDb, { query: "q" }, deps)).ok, true);
    const shed = await embeddingSearch(fakeDb, { query: "q" }, deps);
    assert.equal(shed.ok, false);
    assert.equal(shed.reason, "busy_retry");
    t += 61000;
    assert.equal((await embeddingSearch(fakeDb, { query: "q" }, deps)).ok, true);
  });

  it("concurrency cap: a third simultaneous scan is shed; slots free after completion", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const slowEmbed = async () => { await gate; return new Float32Array([1, 0, 0, 0]); };
    const deps = { embed: slowEmbed, cosineSimilarity };
    const a = embeddingSearch(fakeDb, { query: "q" }, deps);
    const b = embeddingSearch(fakeDb, { query: "q" }, deps);
    const c = await embeddingSearch(fakeDb, { query: "q" }, deps);
    assert.equal(c.reason, "busy_retry");
    release(); await Promise.all([a, b]);
    assert.equal((await embeddingSearch(fakeDb, { query: "q" }, { embed: async () => new Float32Array([1, 0, 0, 0]), cosineSimilarity })).ok, true);
  });
});

