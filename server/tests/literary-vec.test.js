// server/tests/literary-vec.test.js
//
// LRL Phase 3 — sqlite-vec ANN backend. Deterministic vectors (dim 4) pin the
// KNN ordering, idempotent upsert, and removal. The domain-search integration
// needs a live Ollama query embedding, so it's covered structurally (the dense
// block prefers searchVec, falls back to cosine); this file pins the backend.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureVec, upsertVec, searchVec, removeVec, isVecAvailable } from "../lib/literary-vec.js";

describe("LRL — sqlite-vec backend", () => {
  it("loads + indexes + returns nearest-first KNN with dtu ids", () => {
    const db = new Database(":memory:");
    const ok = ensureVec(db, 4);
    if (!ok) { // sqlite-vec not loadable in this env → backend correctly degrades
      assert.equal(searchVec(db, [1, 0, 0, 0], 2, 4), null);
      return;
    }
    assert.equal(isVecAvailable(db), true);
    upsertVec(db, "dtu_lit", [1, 0, 0, 0], 4);
    upsertVec(db, "dtu_code", [0.95, 0.05, 0, 0], 4);
    upsertVec(db, "dtu_far", [0, 0, 1, 0], 4);

    const hits = searchVec(db, [1, 0, 0, 0], 2, 4);
    assert.ok(Array.isArray(hits));
    assert.equal(hits.length, 2, "k=2 limits results");
    assert.equal(hits[0].dtuId, "dtu_lit", "identical vector is nearest");
    assert.equal(hits[1].dtuId, "dtu_code", "near vector is second");
    assert.ok(hits[0].distance <= hits[1].distance, "ordered by ascending distance");
  });

  it("upsert is idempotent (delete-then-insert, no duplicate rows)", () => {
    const db = new Database(":memory:");
    if (!ensureVec(db, 4)) return;
    upsertVec(db, "dtu_x", [1, 0, 0, 0], 4);
    upsertVec(db, "dtu_x", [0, 1, 0, 0], 4); // re-index same id
    const n = db.prepare("SELECT COUNT(*) AS n FROM literary_vec WHERE dtu_id = 'dtu_x'").get().n;
    assert.equal(n, 1, "one row per dtu_id");
    // and the vector was updated
    const hit = searchVec(db, [0, 1, 0, 0], 1, 4);
    assert.equal(hit[0].dtuId, "dtu_x");
    assert.ok(hit[0].distance < 0.01);
  });

  it("removeVec drops a vector", () => {
    const db = new Database(":memory:");
    if (!ensureVec(db, 4)) return;
    upsertVec(db, "dtu_y", [1, 0, 0, 0], 4);
    removeVec(db, "dtu_y");
    const n = db.prepare("SELECT COUNT(*) AS n FROM literary_vec WHERE dtu_id = 'dtu_y'").get().n;
    assert.equal(n, 0);
  });
});
