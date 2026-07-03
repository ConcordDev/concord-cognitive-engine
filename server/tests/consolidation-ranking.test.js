// Consolidation candidate ranking — CITATION-COUNT-WEIGHTED (v1).
//
// Pins `rankConsolidationCandidates` (server/economy/dtu-pipeline.js), an
// optional pre-filter a caller of compressToDMega/compressToHyper MAY use to
// order a candidate pool by real citation count (most-cited-as-parent
// first). This is deliberately a flat citation-count sort, NOT flow-weighted
// / PageRank-style graph diffusion (that is a separate, future, larger
// unit) — the tests below only assert count-based ordering.
//
// Uses a real migrated better-sqlite3 DB (per achievement-engine-realdb.test.js
// convention) so the citation-count query runs against the actual
// `royalty_lineage` schema, not a hand-rolled mock.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { rankConsolidationCandidates } from "../economy/dtu-pipeline.js";

// Seed N royalty_lineage rows citing `parentId` as parent (each with a
// distinct child so the UNIQUE(child_id, parent_id) constraint is happy).
function seedCitations(db, parentId, count, { creatorId = "u_creator", parentCreator = "u_owner" } = {}) {
  const stmt = db.prepare(`
    INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`lin_${parentId}_${i}`, `child_${parentId}_${i}`, parentId, creatorId, parentCreator);
  }
}

describe("rankConsolidationCandidates (citation-count-weighted)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("sorts candidates descending by real citation count read from royalty_lineage", () => {
    // dtu_c: 5 citations, dtu_a: 1 citation, dtu_b: 3 citations
    seedCitations(db, "dtu_c", 5);
    seedCitations(db, "dtu_a", 1);
    seedCitations(db, "dtu_b", 3);

    const ranked = rankConsolidationCandidates(db, ["dtu_a", "dtu_b", "dtu_c"]);
    assert.deepEqual(ranked, ["dtu_c", "dtu_b", "dtu_a"], "most-cited parent sorts first");
  });

  it("handles an empty pool without throwing, returns []", () => {
    assert.deepEqual(rankConsolidationCandidates(db, []), []);
    assert.deepEqual(rankConsolidationCandidates(db, null), []);
    assert.deepEqual(rankConsolidationCandidates(db, undefined), []);
  });

  it("all-zero-citations pool: stable, deterministic original order, no crash", () => {
    // None of these have any royalty_lineage rows citing them.
    const pool = ["dtu_x", "dtu_y", "dtu_z"];
    const ranked1 = rankConsolidationCandidates(db, pool);
    const ranked2 = rankConsolidationCandidates(db, pool);
    assert.deepEqual(ranked1, pool, "ties fall back to original pool order");
    assert.deepEqual(ranked2, pool, "repeated calls are deterministic");
  });

  it("mixed pool: cited candidates float above zero-citation candidates, zero-tier keeps original order", () => {
    seedCitations(db, "dtu_hot", 2);
    // dtu_cold1 and dtu_cold2 both have 0 citations — tie broken by original order.
    const ranked = rankConsolidationCandidates(db, ["dtu_cold1", "dtu_hot", "dtu_cold2"]);
    assert.deepEqual(ranked, ["dtu_hot", "dtu_cold1", "dtu_cold2"]);
  });

  it("read-only: never writes to royalty_lineage or dtus", () => {
    seedCitations(db, "dtu_a", 2);
    const before = db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n;
    rankConsolidationCandidates(db, ["dtu_a", "dtu_b"]);
    const after = db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n;
    assert.equal(after, before, "ranking must not mutate royalty_lineage");
  });
});
