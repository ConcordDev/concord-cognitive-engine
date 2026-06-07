/**
 * semanticSearchDtus — fallback contract.
 *
 * The semantic re-rank uses embeddings.js (nomic-embed-text over Ollama), which
 * isn't available in CI. This pins the load-bearing guarantee: when embeddings
 * are unavailable, semanticSearchDtus NEVER breaks and NEVER regresses below the
 * keyword+recency behaviour — it returns the same recall set with semantic:false.
 * (The embedding-ranked path is exercised in a live-Ollama environment; here we
 * prove the offline floor.)
 *
 * Run: node --test server/tests/semantic-search-fallback.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { searchDtus, semanticSearchDtus } from "../lib/cross-lens-discovery.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT,
      data TEXT, lens_id TEXT, created_at TEXT
    );
  `);
  const ins = db.prepare(
    `INSERT INTO dtus (id, type, title, creator_id, data, lens_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run("d1", "note", "Quarterly tax filing notes", "u1", "{}", "accounting", "2026-01-01");
  ins.run("d2", "note", "Guitar practice log", "u1", "{}", "music", "2026-02-01");
  ins.run("d3", "note", "Tax deductions for creators", "u1", "{}", "accounting", "2026-03-01");
  ins.run("d4", "note", "Private diary", "u1", '{"scope":"personal"}', "journal", "2026-04-01");
  return db;
}

describe("semanticSearchDtus — offline fallback", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("falls back to keyword+recency (semantic:false) when embeddings are unavailable", async () => {
    const r = await semanticSearchDtus(db, "tax", { requesterId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(r.semantic, false, "embeddings are not initialised in CI → must report semantic:false");
    const ids = r.results.map((x) => x.id).sort();
    assert.deepEqual(ids, ["d1", "d3"], "keyword recall must still find both tax DTUs");
  });

  it("never returns fewer results than the keyword path for the same query", async () => {
    const kw = searchDtus(db, "tax", { requesterId: "u1" });
    const sem = await semanticSearchDtus(db, "tax", { requesterId: "u1" });
    assert.equal(sem.results.length, kw.results.length);
  });

  it("respects the personal-scope privacy gate (offline path)", async () => {
    // d4 is personal; a different requester must not see it.
    const r = await semanticSearchDtus(db, "diary", { requesterId: "someone-else" });
    assert.equal(r.ok, true);
    assert.equal(r.results.find((x) => x.id === "d4"), undefined);
  });

  it("short/empty queries fail safe", async () => {
    const r = await semanticSearchDtus(db, "x", { requesterId: "u1" });
    assert.equal(r.ok, false);
    assert.equal(r.semantic, false);
  });
});
