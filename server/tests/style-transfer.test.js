// server/tests/style-transfer.test.js
//
// Style Transfer (#45) — vector arithmetic over REAL stored embeddings (written
// to the real embedding_cache via storeEmbedding). The linear-representation
// hypothesis makes the analogy an exact oracle. No mock data: the cache holds
// real float vectors; offline (no embedding for a DTU) degrades honestly.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { initEmbeddings, storeEmbedding } from "../embeddings.js";
import { meanVec, styleVector, applyStyle, transferStyle } from "../lib/style-transfer.js";
import registerStyletxMacros from "../domains/styletx.js";

describe("Style Transfer (#45)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    await initEmbeddings({ db, ollamaUrls: [] });
    // Real stored embeddings (4-dim): dim0 = formal axis, dim1 = casual axis, dim2 = topic.
    storeEmbedding("formalA", [1, 0, 0, 0]);
    storeEmbedding("formalB", [0.9, 0.1, 0, 0]);
    storeEmbedding("casualA", [0, 1, 0, 0]);
    storeEmbedding("casualB", [0.1, 0.9, 0, 0]);
    storeEmbedding("src_casual_topic", [0, 1, 1, 0]);   // a casual doc about the topic
    storeEmbedding("cand_formal_topic", [1, 0, 1, 0]);  // the formal analogue
    storeEmbedding("cand_casual_topic", [0, 1, 1, 0]);
    storeEmbedding("cand_unrelated", [0, 0, 0, 1]);
    macros = new Map();
    registerStyletxMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("pure vector arithmetic is exact (mean / styleVector / applyStyle)", () => {
    assert.deepEqual([...meanVec([[2, 0], [0, 2]])], [1, 1]);
    assert.deepEqual([...styleVector([[1, 0]], [[0, 1]])], [1, -1]);
    assert.deepEqual([...applyStyle(new Float32Array([0, 1]), new Float32Array([1, -1]), 1)], [1, 0]);
  });

  it("transfers casual→formal: the restyled source lands on the formal analogue", () => {
    const r = transferStyle(db, {
      sourceDtuId: "src_casual_topic",
      styleAIds: ["formalA", "formalB"],
      styleBIds: ["casualA", "casualB"],
      candidateIds: ["cand_formal_topic", "cand_casual_topic", "cand_unrelated"],
      alpha: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.semantic, true, "real embeddings present");
    assert.equal(r.neighbors[0].dtuId, "cand_formal_topic", "style direction moved it to the formal cluster");
    assert.ok(r.neighbors[0].score > r.neighbors[1].score);
  });

  it("degrades honestly when the source isn't embedded (no fabrication)", () => {
    const r = transferStyle(db, {
      sourceDtuId: "never_embedded",
      styleAIds: ["formalA"], styleBIds: ["casualA"], candidateIds: ["cand_formal_topic"],
    });
    assert.equal(r.semantic, false);
    assert.equal(r.reason, "source_not_embedded");
    assert.deepEqual(r.neighbors, []);
  });

  it("degrades honestly when style exemplars aren't embedded", () => {
    const r = transferStyle(db, { sourceDtuId: "src_casual_topic", styleAIds: ["ghost"], styleBIds: ["ghost2"], candidateIds: ["cand_formal_topic"] });
    assert.equal(r.semantic, false);
    assert.equal(r.reason, "no_style_embeddings");
  });

  it("styletx.transfer macro round-trips", async () => {
    const r = await macros.get("styletx.transfer")({ db }, {
      sourceDtuId: "src_casual_topic", styleAIds: ["formalA"], styleBIds: ["casualA"],
      candidateIds: ["cand_formal_topic", "cand_casual_topic"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.neighbors[0].dtuId, "cand_formal_topic");
  });
});
