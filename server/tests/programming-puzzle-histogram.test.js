/**
 * D7 (depth plan) — Zachtronics percentile histograms for programming puzzles.
 *
 * Pins the pure scoring helpers + the DB-backed distribution: a player sees
 * where their solution lands on the cycles + size axes ("better than N% of
 * solvers"), turning pass/fail into an optimisation endgame.
 *
 * Run: node --test tests/programming-puzzle-histogram.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  percentileBeating,
  histogramBins,
  solutionHistogram,
} from "../lib/programming-puzzle.js";

describe("D7 — percentileBeating (pure)", () => {
  it("ranks a fast solution above a slow one", () => {
    const sorted = [10, 20, 30, 40, 50];
    // 12 beats the 4 entries > 12 (20,30,40,50) → 80th percentile.
    assert.equal(percentileBeating(sorted, 12), 80);
    // 60 beats nobody.
    assert.equal(percentileBeating(sorted, 60), 0);
    // the best possible beats all-but-itself-or-ties.
    assert.equal(percentileBeating(sorted, 10), 80);
  });
  it("is null-safe", () => {
    assert.equal(percentileBeating([], 5), null);
    assert.equal(percentileBeating([1, 2], NaN), null);
  });
});

describe("D7 — histogramBins (pure)", () => {
  it("buckets values into equal-width bins summing to the count", () => {
    const bins = histogramBins([1, 2, 3, 4, 5, 6, 7, 8], 4);
    assert.equal(bins.length, 4);
    assert.equal(bins.reduce((s, b) => s + b.count, 0), 8);
  });
  it("collapses to one bin when all values equal", () => {
    const bins = histogramBins([5, 5, 5], 8);
    assert.equal(bins.length, 1);
    assert.equal(bins[0].count, 3);
  });
  it("returns [] for empty input", () => {
    assert.deepEqual(histogramBins([], 8), []);
  });
});

describe("D7 — solutionHistogram (DB-backed)", () => {
  let db;
  before(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE programming_puzzles (id TEXT PRIMARY KEY, optimal_cycles INTEGER, optimal_size INTEGER);
      CREATE TABLE programming_solutions (
        user_id TEXT, puzzle_id TEXT, cycles INTEGER, size INTEGER,
        PRIMARY KEY (user_id, puzzle_id)
      );
    `);
    db.prepare(`INSERT INTO programming_puzzles VALUES ('p1', 12, 4)`).run();
    const ins = db.prepare(`INSERT INTO programming_solutions (user_id, puzzle_id, cycles, size) VALUES (?,?,?,?)`);
    ins.run("u1", "p1", 40, 8);  // the player — slow
    ins.run("u2", "p1", 20, 5);
    ins.run("u3", "p1", 30, 6);
    ins.run("u4", "p1", 15, 4);  // fastest
  });

  it("reports the distribution + the player's percentile", () => {
    const stats = solutionHistogram(db, "p1", { userId: "u1" });
    assert.equal(stats.solutionCount, 4);
    assert.equal(stats.optimal.cycles, 12);
    assert.equal(stats.cycles.best, 15);
    assert.equal(stats.cycles.mine, 40);
    // u1 at 40 cycles is the slowest → beats nobody → 0th percentile.
    assert.equal(stats.cycles.percentile, 0);
    assert.ok(stats.cycles.histogram.length >= 1);
  });

  it("ranks the fastest solver at the top", () => {
    const stats = solutionHistogram(db, "p1", { userId: "u4" });
    // u4 at 15 beats 20/30/40 → 75th percentile.
    assert.equal(stats.cycles.percentile, 75);
  });

  it("returns null percentile when the user has no solution", () => {
    const stats = solutionHistogram(db, "p1", { userId: "nobody" });
    assert.equal(stats.cycles.percentile, null);
    assert.equal(stats.solutionCount, 4);
  });
});
