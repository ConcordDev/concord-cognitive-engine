// SM-2-inspired DTU review-scheduling layer (migration 353,
// server/emergent/forgetting-engine.js). This is a spaced-repetition
// SCHEDULING wrapper around the engine's real retentionScore decay math —
// it decides WHEN a DTU is next re-scored, not what the score is. Pins:
//   - ensureReviewScheduled is idempotent (a second call never resets an
//     existing row)
//   - a successful review (score clears the forgetting threshold) grows the
//     interval via SM-2's real interval *= easeFactor rule
//   - a failed review (score below threshold) resets the interval back down
//     to the short relearn interval
//   - dueDtuIds filters strictly by next_review_due <= now
//   - reviewDtu's score is the SAME value retentionScore itself produces for
//     the identical input — proof the scheduler reuses the real math instead
//     of reimplementing a duplicate decay formula
//
// Run: node --test tests/dtu-review-schedule.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  retentionScore,
  ensureReviewScheduled,
  dueDtuIds,
  reviewDtu,
} from "../emergent/forgetting-engine.js";

// A DTU whose retentionScore is unambiguously ABOVE the default 0.15
// forgetting threshold: tier "mega" alone contributes 0.15 * 999 to the
// weighted sum, dwarfing every other term.
function strongDtu(id) {
  return {
    id,
    tier: "mega",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    authority: { score: 1 },
    lineage: { parents: [], children: [] },
  };
}

// A DTU whose retentionScore is unambiguously BELOW the default threshold:
// ancient (age decay -> ~0), never accessed since (recency -> ~0), lowest
// tier weight (shadow = 0.2), zero authority, no lineage/tag bonuses.
function weakDtu(id) {
  return {
    id,
    tier: "shadow",
    createdAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    tags: [],
    authority: { score: 0 },
    lineage: { parents: [], children: [] },
  };
}

describe("dtu_review_schedule — SM-2-inspired scheduling wrapper", () => {
  let db;
  let STATE;

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    STATE = { dtus: new Map() };
    globalThis._concordSTATE = STATE;
  });

  afterEach(() => {
    delete globalThis._concordSTATE;
    try { db.close(); } catch { /* noop */ }
  });

  it("migration 353 creates the table with SM-2 canonical defaults", () => {
    const cols = db.prepare("PRAGMA table_info(dtu_review_schedule)").all();
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    assert.ok(byName.dtu_id, "dtu_id column exists");
    assert.equal(byName.ease_factor.dflt_value, "2.5");
    assert.equal(byName.interval_days.dflt_value, "1");
  });

  it("ensureReviewScheduled is idempotent — a second call never resets an existing row", () => {
    const dtu = strongDtu("d-idempotent");
    STATE.dtus.set(dtu.id, dtu);

    const first = ensureReviewScheduled(db, dtu.id);
    assert.equal(first.ok, true);

    // Mutate the row so a reset would be observable.
    db.prepare(`UPDATE dtu_review_schedule SET ease_factor = 2.8, interval_days = 12, review_count = 5 WHERE dtu_id = ?`)
      .run(dtu.id);

    const second = ensureReviewScheduled(db, dtu.id);
    assert.equal(second.ok, true);

    const row = db.prepare(`SELECT * FROM dtu_review_schedule WHERE dtu_id = ?`).get(dtu.id);
    assert.equal(row.ease_factor, 2.8, "ease_factor was not reset by the second call");
    assert.equal(row.interval_days, 12, "interval_days was not reset by the second call");
    assert.equal(row.review_count, 5, "review_count was not reset by the second call");

    const count = db.prepare(`SELECT COUNT(*) AS n FROM dtu_review_schedule WHERE dtu_id = ?`).get(dtu.id);
    assert.equal(count.n, 1, "exactly one row exists for this dtu_id");
  });

  it("a successful review grows the interval via SM-2's interval *= easeFactor rule", () => {
    const dtu = strongDtu("d-success");
    STATE.dtus.set(dtu.id, dtu);
    const now = Date.now();

    const outcome = reviewDtu(db, dtu.id, now);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.success, true, "the strong DTU clears the forgetting threshold");

    // SM-2 canonical starting values: ease 2.5, interval 1 day.
    // Success: interval' = interval * ease = 1 * 2.5 = 2.5; ease' = 2.5 + 0.1 = 2.6.
    assert.equal(outcome.intervalDays, 2.5);
    assert.ok(Math.abs(outcome.easeFactor - 2.6) < 1e-9);
    assert.equal(outcome.reviewCount, 1);
    assert.equal(outcome.nextReviewDue, now + 2.5 * 86400000);

    const row = db.prepare(`SELECT * FROM dtu_review_schedule WHERE dtu_id = ?`).get(dtu.id);
    assert.equal(row.interval_days, 2.5);
    assert.equal(row.last_reviewed_at, now);
    assert.equal(row.review_count, 1);
  });

  it("a failed review resets the interval back down to the relearn interval", () => {
    const dtu = weakDtu("d-fail");
    STATE.dtus.set(dtu.id, dtu);
    const now = Date.now();

    // Seed a schedule row that has already grown from prior successful
    // reviews, so a reset is observable.
    ensureReviewScheduled(db, dtu.id);
    db.prepare(`UPDATE dtu_review_schedule SET ease_factor = 2.7, interval_days = 10 WHERE dtu_id = ?`)
      .run(dtu.id);

    const outcome = reviewDtu(db, dtu.id, now);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.success, false, "the ancient, untouched DTU falls below the forgetting threshold");

    // Failure: interval resets to the canonical 1-day relearn interval;
    // ease drops by 0.2 (2.7 - 0.2 = 2.5), floored at 1.3.
    assert.equal(outcome.intervalDays, 1);
    assert.ok(Math.abs(outcome.easeFactor - 2.5) < 1e-9);
    assert.equal(outcome.nextReviewDue, now + 1 * 86400000);

    const row = db.prepare(`SELECT * FROM dtu_review_schedule WHERE dtu_id = ?`).get(dtu.id);
    assert.equal(row.interval_days, 1);
  });

  it("ease_factor never drops below SM-2's canonical floor of 1.3", () => {
    const dtu = weakDtu("d-floor");
    STATE.dtus.set(dtu.id, dtu);
    ensureReviewScheduled(db, dtu.id);
    db.prepare(`UPDATE dtu_review_schedule SET ease_factor = 1.35 WHERE dtu_id = ?`).run(dtu.id);

    const outcome = reviewDtu(db, dtu.id, Date.now());
    assert.equal(outcome.success, false);
    assert.ok(outcome.easeFactor >= 1.3, `ease_factor (${outcome.easeFactor}) floors at 1.3`);
  });

  it("dueDtuIds filters strictly by next_review_due <= now", () => {
    const past = strongDtu("d-past");
    const future = strongDtu("d-future");
    STATE.dtus.set(past.id, past);
    STATE.dtus.set(future.id, future);

    const now = Date.now();
    ensureReviewScheduled(db, past.id);
    ensureReviewScheduled(db, future.id);

    // Push the "future" row's due date well past `now`.
    db.prepare(`UPDATE dtu_review_schedule SET next_review_due = ? WHERE dtu_id = ?`)
      .run(now + 30 * 86400000, future.id);

    const due = dueDtuIds(db, now);
    assert.ok(due.includes(past.id), "the DTU due now is returned");
    assert.ok(!due.includes(future.id), "the DTU due 30 days from now is excluded");
  });

  it("reviewDtu's score is the same value retentionScore itself produces (real reuse, not a duplicate formula)", () => {
    const dtu = strongDtu("d-reuse");
    STATE.dtus.set(dtu.id, dtu);

    const directScore = retentionScore(dtu, STATE);
    const outcome = reviewDtu(db, dtu.id, Date.now());

    assert.equal(outcome.ok, true);
    // Tolerance covers only the sub-millisecond wall-clock gap between the
    // two Date.now() reads (retentionScore's exponential terms move by
    // ~1e-10 per millisecond of age/recency drift) — not a looser formula.
    assert.ok(
      Math.abs(outcome.score - directScore) < 1e-6,
      `reviewDtu's score (${outcome.score}) should match a direct retentionScore call (${directScore})`
    );
  });

  it("reviewDtu returns an honest failure for a DTU that isn't in STATE", () => {
    const outcome = reviewDtu(db, "does-not-exist", Date.now());
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "DTU not found");
  });
});
