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
 *   - LC1: realisePrediction closes the DTU-confidence loop (see the
 *     "LC1 — prediction → dtu_confidence loop closure" describe block below)
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
import { up as up109 } from "../migrations/114_pain_signals.js";
import { up as up111 } from "../migrations/116_forward_predictions.js";
import { up as up354 } from "../migrations/354_dtu_confidence.js";

function setupDb() {
  const db = new Database(":memory:");
  up109(db);
  up111(db);
  up354(db);
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
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, home_dtu_id TEXT
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

// ───────────────────────────────────────────────────────────────────────────
// LC1 — prediction → dtu_confidence loop closure
//
// forward_predictions has carried a `prediction_dtu_id` column since
// migration 116, but until LC1 nothing ever wrote to it and realisePrediction
// never touched dtu_confidence. These tests pin the honest wiring:
//   - a prediction only ever carries a real, already-wired subject→DTU
//     reference (currently: NPC subjects via world_npcs.home_dtu_id; quest
//     and faction subjects are always NULL — see forward-sim.js's LC1 audit
//     comment for why no genuine link exists for those two kinds today).
//   - realising/rejecting a DTU-linked prediction nudges dtu_confidence by
//     the REAL updateConfidence heuristic (not a guessed number).
//   - a NULL-ref prediction is a genuine, silent no-op — never a throw and
//     never a dtu_confidence write.
// ───────────────────────────────────────────────────────────────────────────

describe("LC1 — prediction → dtu_confidence loop closure", () => {
  function seedNpcWithDtu(db, npcId, dtuId) {
    db.prepare(`INSERT INTO world_npcs (id, world_id, home_dtu_id) VALUES (?, ?, ?)`)
      .run(npcId, "w1", dtuId);
  }

  it("resolves prediction_dtu_id for an NPC subject via world_npcs.home_dtu_id, and leaves it NULL for quest/faction subjects", async () => {
    const db = setupDb();
    seedNpcWithDtu(db, "npc-smith", "dtu-npc-smith-lore");
    seedActivity(db, "u1"); // damage_events targets 'npc-smith', quest 'q-onboard', faction 'fac-coastguard'

    await tryPredictForUser(db, "u1");
    const rows = db.prepare(`SELECT subject_kind, subject_id, prediction_dtu_id FROM forward_predictions WHERE user_id = ?`).all("u1");

    const npcRow = rows.find(r => r.subject_kind === "npc");
    const questRow = rows.find(r => r.subject_kind === "quest");
    const factionRow = rows.find(r => r.subject_kind === "faction");

    assert.ok(npcRow, "expected an npc-subject prediction");
    assert.equal(npcRow.prediction_dtu_id, "dtu-npc-smith-lore",
      "npc subject should resolve the genuine world_npcs.home_dtu_id link");

    if (questRow) assert.equal(questRow.prediction_dtu_id, null, "quest subjects have no genuine DTU link — must stay NULL");
    if (factionRow) assert.equal(factionRow.prediction_dtu_id, null, "faction subjects have no genuine DTU link — must stay NULL");
  });

  it("a realised prediction with a resolved DTU ref moves dtu_confidence UP with reason prediction_verified", async () => {
    const db = setupDb();
    seedNpcWithDtu(db, "npc-smith", "dtu-verify-me");
    seedActivity(db, "u1");

    await tryPredictForUser(db, "u1");
    const npcPred = db.prepare(`
      SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'npc'
    `).get("u1");
    assert.ok(npcPred, "expected an npc prediction to realise");

    // Precondition: no dtu_confidence row exists yet (honest-unknown).
    assert.equal(db.prepare(`SELECT * FROM dtu_confidence WHERE dtu_id = ?`).get("dtu-verify-me"), undefined);

    const result = realisePrediction(db, npcPred.id, { outcome: "realised", beatId: "beat-1" });
    assert.deepEqual(result, { ok: true });

    // Trace the REAL updateConfidence math (server/lib/dtu-confidence.js):
    // row is created fresh at score=0.5, evidenceCount=0; influence =
    // 1/(evidenceCount+1) = 1/(0+1) = 1; newScore = clamp(0.5 + 0.05*1, 0, 1)
    // = 0.55; evidence_count becomes 1.
    const row = db.prepare(`SELECT score, evidence_count FROM dtu_confidence WHERE dtu_id = ?`).get("dtu-verify-me");
    assert.ok(row, "expected updateConfidence to create the dtu_confidence row");
    assert.equal(row.score, 0.55);
    assert.equal(row.evidence_count, 1);
  });

  it("a rejected prediction with a resolved DTU ref moves dtu_confidence DOWN with reason prediction_violated", async () => {
    const db = setupDb();
    seedNpcWithDtu(db, "npc-smith", "dtu-violate-me");
    seedActivity(db, "u1");

    await tryPredictForUser(db, "u1");
    const npcPred = db.prepare(`
      SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'npc'
    `).get("u1");
    assert.ok(npcPred);

    realisePrediction(db, npcPred.id, { outcome: "rejected", beatId: "beat-2" });

    // Same math as the "realised" case but delta = -0.05:
    // newScore = clamp(0.5 - 0.05*1, 0, 1) = 0.45; evidence_count = 1.
    const row = db.prepare(`SELECT score, evidence_count FROM dtu_confidence WHERE dtu_id = ?`).get("dtu-violate-me");
    assert.ok(row);
    assert.equal(row.score, 0.45);
    assert.equal(row.evidence_count, 1);
  });

  it("a NULL-ref prediction (quest subject) realising does NOT throw and does NOT touch dtu_confidence", async () => {
    const db = setupDb();
    seedActivity(db, "u1"); // no npc DTU seeded — but exercising the quest subject specifically

    await tryPredictForUser(db, "u1");
    const questPred = db.prepare(`
      SELECT id, prediction_dtu_id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'quest'
    `).get("u1");
    assert.ok(questPred, "expected a quest prediction");
    assert.equal(questPred.prediction_dtu_id, null);

    assert.doesNotThrow(() => {
      const r1 = realisePrediction(db, questPred.id, { outcome: "realised", beatId: "beat-3" });
      assert.deepEqual(r1, { ok: true });
    });

    // Honest no-op: dtu_confidence must remain completely empty — no row
    // was ever created for anything, because there was never a genuine
    // DTU reference to act on.
    const count = db.prepare(`SELECT COUNT(*) AS n FROM dtu_confidence`).get().n;
    assert.equal(count, 0);
  });

  it("a NULL-ref prediction (quest subject) rejecting also does NOT throw and does NOT touch dtu_confidence", async () => {
    const db = setupDb();
    seedActivity(db, "u1");

    await tryPredictForUser(db, "u1");
    const questPred = db.prepare(`
      SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'quest'
    `).get("u1");
    assert.ok(questPred);

    assert.doesNotThrow(() => {
      realisePrediction(db, questPred.id, { outcome: "rejected", beatId: "beat-4" });
    });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM dtu_confidence`).get().n;
    assert.equal(count, 0);
  });

  it("an 'expired' outcome (even on a DTU-linked prediction) is a no-op — a TTL lapse is not evidence", async () => {
    const db = setupDb();
    seedNpcWithDtu(db, "npc-smith", "dtu-expired-noop");
    seedActivity(db, "u1");

    await tryPredictForUser(db, "u1");
    const npcPred = db.prepare(`
      SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'npc'
    `).get("u1");
    assert.ok(npcPred);

    realisePrediction(db, npcPred.id, { outcome: "expired" });
    const row = db.prepare(`SELECT * FROM dtu_confidence WHERE dtu_id = ?`).get("dtu-expired-noop");
    assert.equal(row, undefined, "expired must never create/touch a dtu_confidence row");
  });

  it("an ambiguous outcome payload with no `.outcome` string (direct-caller shape) is a no-op, even with a DTU-linked prediction", async () => {
    const db = setupDb();
    seedNpcWithDtu(db, "npc-smith", "dtu-ambiguous-noop");
    seedActivity(db, "u1");

    await tryPredictForUser(db, "u1");
    const npcPred = db.prepare(`
      SELECT id FROM forward_predictions WHERE user_id = ? AND subject_kind = 'npc'
    `).get("u1");
    assert.ok(npcPred);

    // This is the exact shape the existing "stamps reality_outcome" test
    // above uses for a direct (non-beat-scheduler) caller.
    realisePrediction(db, npcPred.id, { matched: true, note: "you were right" });

    const row = db.prepare(`SELECT * FROM dtu_confidence WHERE dtu_id = ?`).get("dtu-ambiguous-noop");
    assert.equal(row, undefined, "an unlabelled outcome payload must never guess intent and touch confidence");
  });
});
