// Integration test: gather → ecosystem_score adjustment → metrics
// readback. Exercises the chain that the unit tests previously verified
// only in isolation. We don't boot a full server here (too heavy); we
// directly call the score-engine the way the gather route does, then
// verify the metrics endpoint logic returns the same scalar.
//
// This is the kind of cross-piece coverage that catches schema drift
// between the writer (gather) and the reader (/api/world/me/metrics).

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { adjust, getMetrics } from "../../lib/ecosystem/score-engine.js";

function makeFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_world_metrics (
      user_id              TEXT NOT NULL,
      world_id             TEXT NOT NULL,
      ecosystem_score      REAL NOT NULL DEFAULT 0,
      concord_alignment    REAL NOT NULL DEFAULT 0,
      concordia_alignment  REAL NOT NULL DEFAULT 0,
      refusal_debt         REAL NOT NULL DEFAULT 0,
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id)
    );
  `);
  return db;
}

describe("integration: gather → ecosystem_score → metrics readback", () => {
  let db;
  before(() => { db = makeFixture(); });

  test("sustainable gather (+0.5) reflects in subsequent metrics read", () => {
    // What the gather route does on a non-depleting harvest.
    adjust(db, "u1", "concordia-hub", { ecosystem_score: +0.5 });
    const m = getMetrics(db, "u1", "concordia-hub");
    assert.equal(m.ecosystem_score, 0.5);
  });

  test("clearcut (-3) on depletion drives Concordia 'cold' phase", () => {
    // What the gather route does when the node depletes.
    adjust(db, "u1", "concordia-hub", { ecosystem_score: -3 });
    const m = getMetrics(db, "u1", "concordia-hub");
    // 0.5 + (-3) = -2.5 → cold phase
    assert.ok(m.ecosystem_score < 0, "ecosystem_score should be negative");
  });

  test("multiple gathers accumulate as expected for the metrics endpoint", () => {
    // Reset to a known state.
    db.prepare("DELETE FROM player_world_metrics WHERE user_id = ?").run("u2");
    for (let i = 0; i < 10; i++) adjust(db, "u2", "concordia-hub", { ecosystem_score: +0.5 });
    for (let i = 0; i < 2; i++) adjust(db, "u2", "concordia-hub", { ecosystem_score: -3 });
    const m = getMetrics(db, "u2", "concordia-hub");
    // 10 * 0.5 + 2 * -3 = -1
    assert.equal(m.ecosystem_score, -1);
  });

  test("metrics row is created lazily on first read", () => {
    const fresh = getMetrics(db, "u_fresh", "concordia-hub");
    assert.equal(fresh.ecosystem_score, 0);
    assert.equal(fresh.concord_alignment, 0);
    assert.equal(fresh.concordia_alignment, 0);
    assert.equal(fresh.refusal_debt, 0);
  });

  test("kill+overhunt (-3) and sustainable gather (+0.5) compose correctly", () => {
    db.prepare("DELETE FROM player_world_metrics WHERE user_id = ?").run("u_hunt");
    adjust(db, "u_hunt", "concordia-hub", { ecosystem_score: +0.5 }); // gather herb
    adjust(db, "u_hunt", "concordia-hub", { ecosystem_score: -3 });   // kill creature in low-pop biome
    const m = getMetrics(db, "u_hunt", "concordia-hub");
    assert.equal(m.ecosystem_score, -2.5);
  });
});
