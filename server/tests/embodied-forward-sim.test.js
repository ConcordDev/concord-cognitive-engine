/**
 * Tier-2 contract tests for Layer 10: subconscious forward-sim.
 *
 * Pins:
 *   - composeDeterministicPrediction shape per subject_kind
 *   - tryPredictForUser inserts rows + respects cooldown
 *   - tryPredictForUser skips subjects with active predictions
 *   - getActivePredictions filters by realised_at + expires_at
 *   - sweepExpiredPredictions archives expired
 *   - realisePrediction stamps reality_outcome
 *   - runForwardSimCycle skips active users + composes for offline
 *
 * Run: node --test tests/embodied-forward-sim.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  tryPredictForUser,
  composeDeterministicPrediction,
  getActivePredictions,
  realisePrediction,
  sweepExpiredPredictions,
  PREDICTION_TTL_S,
  MIN_PASS_INTERVAL_S,
} from "../lib/embodied/forward-sim.js";
import { runForwardSimCycle } from "../emergent/forward-sim-cycle.js";
import { up as up109 } from "../migrations/109_pain_signals.js";
import { up as up111 } from "../migrations/111_forward_predictions.js";

function setupDb() {
  const db = new Database(":memory:");
  up109(db);
  up111(db);
  db.exec(`
    CREATE TABLE damage_events (
      id TEXT PRIMARY KEY,
      world_id TEXT, attacker_id TEXT, attacker_type TEXT,
      target_id TEXT, target_type TEXT, element TEXT,
      final_damage REAL, kill INTEGER DEFAULT 0,
      occurred_at INTEGER
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT,
      item_id TEXT, quantity INTEGER, acquired_at INTEGER
    );
    CREATE TABLE world_visits (
      world_id TEXT, user_id TEXT, entered_at INTEGER, departed_at INTEGER
    );
    CREATE TABLE quest_progress (
      user_id TEXT, world_id TEXT, quest_id TEXT, updated_at INTEGER
    );
    CREATE TABLE faction_members (
      user_id TEXT, faction_id TEXT
    );
  `);
  return db;
}

function seedActivity(db, userId, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  // Quest progress (recent)
  db.prepare(`
    INSERT INTO quest_progress (user_id, world_id, quest_id, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, 'w1', 'q-onboard', now - 600);
  // Combat against an NPC (recent)
  db.prepare(`
    INSERT INTO damage_events
      (id, world_id, attacker_id, attacker_type, target_id, target_type, final_damage, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('de1', 'w1', userId, 'player', 'npc-smith', 'npc', 25, now - 700);
  // Faction membership
  db.prepare(`INSERT INTO faction_members (user_id, faction_id) VALUES (?, ?)`)
    .run(userId, 'fac-coastguard');
  // World visit (departed)
  db.prepare(`
    INSERT INTO world_visits (world_id, user_id, entered_at, departed_at)
    VALUES (?, ?, ?, ?)
  `).run('w1', userId, now - 7200, opts.online ? null : now - 600);
}

// ───────────────────────────────────────────────────────────────────────────
// composeDeterministicPrediction
// ───────────────────────────────────────────────────────────────────────────

describe("composeDeterministicPrediction", () => {
  it("returns shape with anticipated, confidence, composer", () => {
    const r = composeDeterministicPrediction({ kind: 'quest', id: 'q1' });
    assert.ok(typeof r.anticipated === 'string' && r.anticipated.length > 0);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
    assert.equal(r.composer, 'deterministic');
  });

  it("varies confidence by subject kind", () => {
    const q = composeDeterministicPrediction({ kind: 'quest', id: 'q' });
    const f = composeDeterministicPrediction({ kind: 'faction', id: 'f' });
    assert.ok(q.confidence > f.confidence,
      "quests are more determinable than faction drift");
  });

  it("falls back for unknown kind", () => {
    const r = composeDeterministicPrediction({ kind: 'wormhole', id: 'x' });
    assert.ok(r.anticipated.length > 0);
    assert.ok(r.confidence > 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// tryPredictForUser
// ───────────────────────────────────────────────────────────────────────────

describe("tryPredictForUser", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    seedActivity(db, "u1");
  });

  it("inserts predictions for each subject (capped)", async () => {
    const r = await tryPredictForUser(db, "u1");
    assert.equal(r.ok, true);
    assert.ok(r.predictions >= 1, `expected ≥1 prediction, got ${r.predictions}`);

    const rows = db.prepare(`SELECT subject_kind FROM forward_predictions WHERE user_id = ?`).all("u1");
    assert.ok(rows.length >= 1);
    const kinds = new Set(rows.map(r => r.subject_kind));
    assert.ok(kinds.has('quest') || kinds.has('npc') || kinds.has('faction'),
      `expected at least one canonical kind, got ${[...kinds].join(',')}`);
  });

  it("respects MIN_PASS_INTERVAL_S cooldown", async () => {
    await tryPredictForUser(db, "u1");
    const r = await tryPredictForUser(db, "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'cooldown');
  });

  it("skips subjects that already have an active prediction (after cooldown)", async () => {
    await tryPredictForUser(db, "u1");
    // Pretend cooldown elapsed
    const old = Math.floor(Date.now() / 1000) - 5 * 3600;
    db.prepare(`UPDATE forward_predictions SET composed_at = ? WHERE user_id = ?`).run(old, "u1");

    const r = await tryPredictForUser(db, "u1");
    assert.equal(r.ok, true);
    // All existing subjects still have active predictions, so 0 new.
    assert.equal(r.predictions ?? 0, 0);
  });

  it("rejects on missing predictions table", async () => {
    const db2 = new Database(":memory:");
    const r = await tryPredictForUser(db2, "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'predictions_table_missing');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getActivePredictions + realisePrediction + sweepExpiredPredictions
// ───────────────────────────────────────────────────────────────────────────

describe("active prediction lifecycle", () => {
  it("getActivePredictions filters by realised + expires", async () => {
    const db = setupDb();
    seedActivity(db, "u1");
    await tryPredictForUser(db, "u1");
    const list = getActivePredictions(db, "u1");
    assert.ok(list.length >= 1);
    for (const p of list) {
      assert.ok(p.expires_at > Math.floor(Date.now() / 1000));
    }
  });

  it("realisePrediction stamps reality_outcome", async () => {
    const db = setupDb();
    seedActivity(db, "u1");
    await tryPredictForUser(db, "u1");
    const list = getActivePredictions(db, "u1");
    const target = list[0];
    realisePrediction(db, target.id, { matched: true, note: "you were right" });

    const after = db.prepare(`SELECT realised_at, reality_outcome FROM forward_predictions WHERE id = ?`).get(target.id);
    assert.ok(after.realised_at > 0);
    assert.ok(after.reality_outcome.includes("matched"));

    // No longer in active list
    const stillActive = getActivePredictions(db, "u1").find(p => p.id === target.id);
    assert.equal(stillActive, undefined);
  });

  it("sweepExpiredPredictions archives past TTL", async () => {
    const db = setupDb();
    seedActivity(db, "u1");
    await tryPredictForUser(db, "u1");
    // Backdate expires_at to past
    db.prepare(`UPDATE forward_predictions SET expires_at = expires_at - ? WHERE user_id = ?`)
      .run(PREDICTION_TTL_S + 100, "u1");
    const swept = sweepExpiredPredictions(db);
    assert.ok(swept >= 1);

    const active = getActivePredictions(db, "u1");
    assert.equal(active.length, 0);
  });

  it("constants are exported and stable", () => {
    assert.ok(PREDICTION_TTL_S >= 3600);
    assert.ok(MIN_PASS_INTERVAL_S >= 600);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runForwardSimCycle
// ───────────────────────────────────────────────────────────────────────────

describe("runForwardSimCycle", () => {
  it("skips currently-active users", async () => {
    const db = setupDb();
    seedActivity(db, "u-online", { online: true });
    const r = await runForwardSimCycle({ db });
    assert.equal(r.predictions ?? 0, 0);
  });

  it("composes for offline users", async () => {
    const db = setupDb();
    seedActivity(db, "u-offline");
    const r = await runForwardSimCycle({ db });
    assert.ok(r.candidates >= 1);
    assert.ok(r.predictions >= 1);
  });

  it("idempotent across passes (cooldown)", async () => {
    const db = setupDb();
    seedActivity(db, "u-offline");
    await runForwardSimCycle({ db });
    const r2 = await runForwardSimCycle({ db });
    assert.equal(r2.predictions ?? 0, 0);
    assert.ok(r2.cooldown >= 1);
  });

  it("returns ok even when no candidates", async () => {
    const db = setupDb();
    const r = await runForwardSimCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.candidates, 0);
  });
});
