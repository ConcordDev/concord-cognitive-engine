// Audit fix sweep (PR #2356) — FIX-goddess-002: the dispatch feed was
// stale and uniform (100 identical "I observe: the cycle continues."
// dispatches, ecosystem 0.00) because composeAndRecord read the
// ecosystem score from STATE.worlds — in the real server that map is
// the sub-worlds store keyed by userId, so the lookup never hit and
// the score was always 0. The canonical score lives in
// player_world_metrics; the broadcaster now reads the world mean via
// score-engine's worldEcosystemPercent and maps it onto the tone
// scale, so a world with real ecosystem activity dispatches in its
// real tone with its real score.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { composeAndRecord } from "../lib/goddess-broadcaster.js";

function freshDb({ withMetrics = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goddess_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      tone TEXT NOT NULL,
      ecosystem_score REAL,
      refusal_strength REAL,
      drift_kind TEXT,
      body TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  if (withMetrics) {
    db.exec(`
      CREATE TABLE player_world_metrics (
        user_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        ecosystem_score REAL
      );
    `);
  }
  return db;
}

describe("goddess broadcaster — ecosystem signal comes from the metrics table", () => {
  it("a world averaging +80 dispatches exalted with score 0.8 recorded", async () => {
    const db = freshDb();
    const ins = db.prepare(
      "INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)",
    );
    ins.run("u1", "concordia-hub", 100);
    ins.run("u2", "concordia-hub", 60);

    const r = await composeAndRecord(db, { worlds: new Map() }, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.dispatch.tone, "exalted");
    assert.match(r.dispatch.body, /^I see brightness:/);

    const row = db.prepare(
      "SELECT tone, ecosystem_score FROM goddess_dispatches WHERE world_id = ?",
    ).get("concordia-hub");
    assert.equal(row.tone, "exalted");
    assert.ok(Math.abs(row.ecosystem_score - 0.8) < 1e-9, `score ${row.ecosystem_score}`);
  });

  it("a world averaging -80 dispatches mourning, not the canned neutral line", async () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)",
    ).run("u1", "concordia-hub", -80);

    const r = await composeAndRecord(db, { worlds: new Map() }, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.dispatch.tone, "mourning");
    assert.doesNotMatch(r.dispatch.body, /the cycle continues/);
  });

  it("no metrics sample falls back to an in-memory world score, else neutral 0", async () => {
    const db = freshDb();
    const withState = await composeAndRecord(
      db, { worlds: new Map([["concordia-hub", { ecosystem_score: 0.5 }]]) }, "concordia-hub",
    );
    assert.equal(withState.dispatch.tone, "warm");

    const bare = await composeAndRecord(db, { worlds: new Map() }, "concordia-hub");
    assert.equal(bare.dispatch.tone, "neutral");
  });
});
