// server/tests/literary-domain.test.js
//
// LRL Phase 1 — literary domain read-path, offline. With Ollama down, embed()
// returns null so the dense list is empty and RRF degrades to BM25 (semantic:
// false) — this pins the always-available keyword path + provenance + the
// detail/provenance/semantic_graph/stats macros.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { ingestWork } from "../lib/literary-ingest.js";
import registerLiteraryMacros, { searchLiterary } from "../domains/literary.js";

const SAMPLE = `
CHAPTER I. The Question

To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer.
${"The slings and arrows of outrageous fortune press hard upon the heart. ".repeat(40)}

CHAPTER II. The Resolve

And by opposing end them. To die, to sleep, no more.
${"Thus conscience does make cowards of us all and resolve is sicklied o'er. ".repeat(40)}
`;

function buildMacros() {
  const handlers = new Map();
  registerLiteraryMacros((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
  return handlers;
}

describe("LRL — literary domain read path (offline)", () => {
  let db, ctx, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    await ingestWork(
      db,
      { gutenbergId: "1524", title: "Hamlet", author: "William Shakespeare", era: "renaissance", genre: "drama", pdVerified: 1 },
      SAMPLE,
      { doEmbed: false },
    );
    ctx = { db };
    macros = buildMacros();
  });

  it("search (BM25 fallback) returns ranked hits with provenance + DTU id", async () => {
    const r = await searchLiterary(db, { query: "question conscience", limit: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.semantic, false, "no Ollama → keyword path");
    assert.ok(r.results.length >= 1, "found at least one hit");
    const hit = r.results[0];
    assert.ok(hit.dtuId, "hit carries the backing DTU id");
    assert.equal(hit.provenance.title, "Hamlet");
    assert.equal(hit.provenance.author, "William Shakespeare");
    assert.equal(hit.provenance.license, "public_domain");
  });

  it("empty query returns an empty result set, not an error", async () => {
    const r = await searchLiterary(db, { query: "  " });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
  });

  it("registers the 5 macros", () => {
    for (const m of ["search", "detail", "provenance", "semantic_graph", "stats"]) {
      assert.ok(macros.has(`literary.${m}`), `literary.${m} registered`);
    }
  });

  it("detail returns the chunk + neighbours", async () => {
    const search = await searchLiterary(db, { query: "question" });
    const chunkId = search.results[0].chunkId;
    const r = await macros.get("literary.detail")(ctx, { chunkId });
    assert.equal(r.ok, true);
    assert.equal(r.chunk.chunkId, chunkId);
    assert.ok(Array.isArray(r.neighbors));
  });

  it("provenance resolves by dtuId with the PD license", async () => {
    const search = await searchLiterary(db, { query: "question" });
    const dtuId = search.results[0].dtuId;
    const r = await macros.get("literary.provenance")(ctx, { dtuId });
    assert.equal(r.ok, true);
    assert.equal(r.provenance.license, "public_domain");
    assert.equal(r.provenance.pdVerified, true);
    assert.equal(r.provenance.gutenbergId, "1524");
  });

  it("semantic_graph yields nodes for GraphView", async () => {
    const r = await macros.get("literary.semantic_graph")(ctx, { query: "question resolve", limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.nodes.length >= 1);
    assert.ok(Array.isArray(r.edges));
  });

  it("stats reports corpus counts", async () => {
    const r = await macros.get("literary.stats")(ctx);
    assert.equal(r.ok, true);
    assert.equal(r.sources, 1);
    assert.ok(r.chunks >= 2);
    assert.equal(r.embedded, 0, "no embeddings written in offline ingest");
  });
});
