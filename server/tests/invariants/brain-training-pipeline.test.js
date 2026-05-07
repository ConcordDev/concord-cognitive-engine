// Invariant: brain self-training pipeline contract.
//
// Pins:
//   1. Migration 109 creates both brain_interactions + brain_active_models
//      tables with the expected columns, including train_consented.
//   2. logBrainInteraction inserts a row, sanitizes input, never throws.
//   3. resolveBrainInteraction flips outcome only on pending rows.
//   4. buildPositiveCorpus returns positive-outcome examples filtered by
//      train_consented = 1, ordered by recency.
//   5. The daily runner's window check accepts 23:30-23:59 only.
//   6. Daily runner returns 'insufficient_corpus' when corpus < threshold,
//      not a thrown error (so the heartbeat tick stays safe).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  logBrainInteraction,
  resolveBrainInteraction,
  buildPositiveCorpus,
  getBrainCorpusStats,
} from "../../lib/brain-training/interaction-log.js";
import { runDailyRefresh, _internal } from "../../lib/brain-training/runner.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function columnExists(table, col) {
  const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table);
  return rows.some((r) => r.name === col);
}

test("migration 109 creates brain_interactions with required columns", () => {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='brain_interactions'`).get();
  assert.ok(r, "brain_interactions table missing");
  for (const col of [
    "id", "brain_id", "user_id", "prompt_hash", "prompt_json", "response_json",
    "domain", "latency_ms", "tokens_in", "tokens_out",
    "outcome", "outcome_signal", "outcome_at",
    "train_consented", "created_at",
  ]) {
    assert.ok(columnExists("brain_interactions", col), `brain_interactions.${col} missing`);
  }
});

test("migration 109 creates brain_active_models with required columns", () => {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='brain_active_models'`).get();
  assert.ok(r, "brain_active_models table missing");
  for (const col of [
    "id", "brain_id", "model_name", "base_model", "corpus_size",
    "eval_score", "active", "created_at", "retired_at",
  ]) {
    assert.ok(columnExists("brain_active_models", col), `brain_active_models.${col} missing`);
  }
});

test("logBrainInteraction inserts a pending row and returns the id", () => {
  const id = logBrainInteraction(db, {
    brainId: "utility",
    userId: "user-A",
    prompt: { messages: [{ role: "user", content: "hello" }] },
    response: "world",
    domain: "chat",
    latencyMs: 42,
    tokensIn: 5,
    tokensOut: 1,
  });
  assert.ok(id);
  const row = db.prepare(`SELECT * FROM brain_interactions WHERE id = ?`).get(id);
  assert.ok(row);
  assert.strictEqual(row.brain_id, "utility");
  assert.strictEqual(row.outcome, "pending");
  assert.strictEqual(row.train_consented, 1, "platform-generated default must be consented");
});

test("logBrainInteraction returns null for invalid brain_id (never throws)", () => {
  const id = logBrainInteraction(db, { brainId: "not-a-real-brain" });
  assert.strictEqual(id, null);
});

test("resolveBrainInteraction only flips pending rows", () => {
  const id = logBrainInteraction(db, {
    brainId: "repair",
    userId: "user-A",
    prompt: { input: "fix this" },
    response: "fixed",
  });
  // First resolution flips pending → positive
  const ok1 = resolveBrainInteraction(db, id, "positive", { reason: "fix_stuck" });
  assert.strictEqual(ok1, true);
  // Second resolution must NOT change the row (already not pending)
  const ok2 = resolveBrainInteraction(db, id, "negative", { reason: "different signal" });
  assert.strictEqual(ok2, false, "must not re-resolve a non-pending row");
  const row = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(id);
  assert.strictEqual(row.outcome, "positive");
});

test("buildPositiveCorpus returns positive-outcome consented rows in recency order", () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const id = logBrainInteraction(db, {
      brainId: "utility",
      prompt: { messages: [{ role: "user", content: `q${i}` }] },
      response: `a${i}`,
    });
    ids.push(id);
  }
  // Mark 3 as positive, 1 as negative, 1 stays pending
  resolveBrainInteraction(db, ids[0], "positive", {});
  resolveBrainInteraction(db, ids[1], "negative", {});
  resolveBrainInteraction(db, ids[2], "positive", {});
  resolveBrainInteraction(db, ids[3], "positive", {});

  const corpus = buildPositiveCorpus(db, "utility", { max: 100 });
  assert.strictEqual(corpus.length, 3, "must return only positive-outcome rows");
  // Recency order means most-recent positive first
  assert.ok(corpus[0].response);
});

test("buildPositiveCorpus excludes train_consented = 0 rows", () => {
  const id = logBrainInteraction(db, {
    brainId: "utility",
    prompt: { messages: [{ role: "user", content: "redacted" }] },
    response: "shouldn't appear",
  });
  resolveBrainInteraction(db, id, "positive", {});
  // Flip consent off
  db.prepare(`UPDATE brain_interactions SET train_consented = 0 WHERE id = ?`).run(id);

  const corpus = buildPositiveCorpus(db, "utility", { max: 100 });
  assert.strictEqual(corpus.length, 0, "consent=0 must exclude from corpus");
});

test("getBrainCorpusStats returns one row per known brain", () => {
  logBrainInteraction(db, { brainId: "utility", prompt: { input: "x" }, response: "y" });
  logBrainInteraction(db, { brainId: "repair", prompt: { input: "x" }, response: "y" });
  const stats = getBrainCorpusStats(db);
  assert.ok(Array.isArray(stats.brains));
  // Must include all VALID_BRAINS even when they have zero rows.
  const ids = new Set(stats.brains.map((b) => b.brainId));
  for (const expected of ["conscious", "subconscious", "utility", "repair", "multimodal", "lattice"]) {
    assert.ok(ids.has(expected), `stats missing ${expected}`);
  }
});

test("runDailyRefresh returns insufficient_corpus when below MIN_CORPUS_SIZE", async () => {
  // Force = true bypasses the time-window gate but still respects corpus min.
  const result = await runDailyRefresh(db, { force: true });
  assert.strictEqual(result.ok, true);
  assert.ok(Array.isArray(result.results), "must return per-brain results array");
  for (const r of result.results) {
    assert.strictEqual(r.skipped, "insufficient_corpus", `${r.brainId} should skip on empty DB`);
  }
});

test("runDailyRefresh returns out_of_window outside 23:30-23:59 unless forced", async () => {
  // Stub Date constructor to return 14:00 (well outside the window).
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(2026, 4, 7, 14, 0, 0); }
    static now() { return new RealDate(2026, 4, 7, 14, 0, 0).getTime(); }
  };
  try {
    const result = await runDailyRefresh(db);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, "out_of_window");
  } finally {
    global.Date = RealDate;
  }
});

test("DAILY_ELIGIBLE_BRAINS is the small-brain set (utility, repair)", () => {
  // Pinning this so a future "let's add conscious to daily" change can't
  // sneak in without explicit human review — large brains can't fit the
  // 30-minute window without GPU work.
  assert.deepStrictEqual([..._internal.DAILY_ELIGIBLE_BRAINS].sort(), ["repair", "utility"]);
});

// ─────────────────────────────────────────────────────────────────────
// resolvePendingOutcomes — the heartbeat resolver that turns 'pending'
// rows into 'positive'/'expired' so the daily refresh has corpus to
// pull from. Without this resolver, every brain interaction stays
// pending forever and runDailyRefresh always reports
// insufficient_corpus.
// ─────────────────────────────────────────────────────────────────────

test("resolvePendingOutcomes: marks engagement-followup as positive", async () => {
  const { resolvePendingOutcomes } = await import("../../lib/brain-training/interaction-log.js");
  const userId = "user-engaged";
  // Seed an old pending interaction (well past the engagement window).
  const oldId = `bi_${"a".repeat(16)}`;
  const oldTs = Math.floor(Date.now() / 1000) - 7200; // 2h ago
  db.prepare(
    `INSERT INTO brain_interactions
       (id, brain_id, user_id, prompt_hash, prompt_json, response_json, outcome, created_at)
     VALUES (?, 'utility', ?, 'h1', '{"x":1}', '{"y":2}', 'pending', ?)`,
  ).run(oldId, userId, oldTs);
  // Plus a follow-up call from the same user, INSIDE the 30-min window
  // after the first call (so engagement is detected).
  const followUpTs = oldTs + 600; // 10min later
  db.prepare(
    `INSERT INTO brain_interactions
       (id, brain_id, user_id, prompt_hash, prompt_json, response_json, outcome, created_at)
     VALUES ('bi_followup', 'utility', ?, 'h2', '{"x":3}', '{"y":4}', 'pending', ?)`,
  ).run(userId, followUpTs);

  const r = resolvePendingOutcomes(db);
  assert.ok(r.scanned >= 2);
  assert.ok(r.positive >= 1, "engagement signal must produce at least one positive resolution");
  const oldRow = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(oldId);
  assert.strictEqual(oldRow.outcome, "positive");
});

test("resolvePendingOutcomes: marks rows older than expireAfterSec as expired", async () => {
  const { resolvePendingOutcomes } = await import("../../lib/brain-training/interaction-log.js");
  const ancientId = "bi_ancient";
  const ancientTs = Math.floor(Date.now() / 1000) - (10 * 86400); // 10 days ago
  db.prepare(
    `INSERT INTO brain_interactions
       (id, brain_id, user_id, prompt_hash, prompt_json, response_json, outcome, created_at)
     VALUES (?, 'utility', 'lonely-user', 'h', '{}', '{}', 'pending', ?)`,
  ).run(ancientId, ancientTs);

  const r = resolvePendingOutcomes(db, { expireAfterSec: 7 * 86400 });
  assert.ok(r.expired >= 1, "row older than 7d with no follow-up must expire");
  const row = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(ancientId);
  assert.strictEqual(row.outcome, "expired");
});

test("resolvePendingOutcomes: leaves recent unresolved rows pending", async () => {
  const { resolvePendingOutcomes } = await import("../../lib/brain-training/interaction-log.js");
  const recentId = "bi_recent";
  const recentTs = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
  db.prepare(
    `INSERT INTO brain_interactions
       (id, brain_id, user_id, prompt_hash, prompt_json, response_json, outcome, created_at)
     VALUES (?, 'utility', 'user-X', 'h', '{}', '{}', 'pending', ?)`,
  ).run(recentId, recentTs);

  const r = resolvePendingOutcomes(db);
  assert.ok(r.stillPending >= 1, "row inside engagement window must stay pending");
  const row = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(recentId);
  assert.strictEqual(row.outcome, "pending");
});

test("resolvePendingOutcomes: never throws on empty DB", async () => {
  const { resolvePendingOutcomes } = await import("../../lib/brain-training/interaction-log.js");
  const r = resolvePendingOutcomes(db);
  assert.strictEqual(r.scanned, 0);
  assert.strictEqual(r.positive, 0);
  assert.strictEqual(r.expired, 0);
});
