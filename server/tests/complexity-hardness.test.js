// Wave 5 #31 — computational hardness. Pins the SAT phase-transition model (the
// hardness cliff at the critical clause/variable ratio) + the monotone puzzle
// difficulty grader + the additive getPuzzle difficulty wire.
//
// Run: node --test tests/complexity-hardness.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  satHardness,
  criticalClauses,
  puzzleHardness,
  tierFromScore,
  SAT_3_CRITICAL_RATIO,
} from "../lib/complexity/hardness.js";
import { authorPuzzle, getPuzzle } from "../lib/programming-puzzle.js";

describe("satHardness — the 3-SAT phase transition", () => {
  it("peaks at the critical ratio and decays on both sides (the hardness cliff)", () => {
    const vars = 100;
    const atThreshold = satHardness(SAT_3_CRITICAL_RATIO * vars, vars);
    const underConstrained = satHardness(1.0 * vars, vars);   // α=1 → easy SAT
    const overConstrained = satHardness(8.0 * vars, vars);    // α=8 → trivially UNSAT
    assert.ok(atThreshold > 0.99, `peak ${atThreshold}`);
    assert.ok(underConstrained < 0.2, `under ${underConstrained}`);
    assert.ok(overConstrained < 0.1, `over ${overConstrained}`);
    assert.ok(atThreshold > underConstrained && atThreshold > overConstrained);
  });

  it("criticalClauses puts an instance at the threshold", () => {
    assert.equal(criticalClauses(100), Math.round(100 * SAT_3_CRITICAL_RATIO));
    assert.ok(satHardness(criticalClauses(50), 50) > 0.99);
  });

  it("degrades gracefully on zero/garbage input", () => {
    assert.equal(satHardness(0, 10), 0);
    assert.equal(satHardness(10, 0), satHardness(10, 1)); // numVars floored to 1
  });
});

describe("puzzleHardness — structural difficulty", () => {
  it("is monotone: more cases / bigger optimal / more cycles → harder tier", () => {
    const easy = puzzleHardness({ optimalCycles: 5, optimalSize: 3, testCases: 1 });
    const hard = puzzleHardness({ optimalCycles: 180, optimalSize: 28, testCases: 11 });
    assert.ok(hard.score > easy.score);
    assert.ok(hard.tier >= easy.tier);
    assert.equal(easy.regime, "gentle");
    assert.equal(hard.regime, "steep");
  });
  it("tierFromScore buckets 0..1 into 1..5", () => {
    assert.equal(tierFromScore(0), 1);
    assert.equal(tierFromScore(1), 5);
    assert.equal(tierFromScore(0.5), 3);
  });
});

describe("getPuzzle attaches a derived difficulty (additive)", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("returns a difficulty {score,tier,regime} derived from structure", () => {
    const { puzzleId } = authorPuzzle(db, {
      name: "Echo×3",
      testCases: [{ input: [1], output: [1] }, { input: [2], output: [2] }, { input: [3], output: [3] }],
      optimalCycles: 12, optimalSize: 6,
    });
    const p = getPuzzle(db, puzzleId);
    assert.ok(p.difficulty && typeof p.difficulty.tier === "number");
    assert.ok(p.difficulty.tier >= 1 && p.difficulty.tier <= 5);
    assert.ok(["gentle", "moderate", "steep"].includes(p.difficulty.regime));
  });
});
