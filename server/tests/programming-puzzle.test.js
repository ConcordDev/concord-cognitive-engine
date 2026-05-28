// Phase CC3 — programming puzzle tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  authorPuzzle, runSolution, submitSolution, leaderboardForPuzzle,
} from "../lib/programming-puzzle.js";
import { up as upProg } from "../migrations/253_programming_puzzles.js";

function freshDb() { const db = new Database(":memory:"); upProg(db); return db; }

describe("Phase CC3 — programming puzzle", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("authorPuzzle stores test cases", () => {
    const r = authorPuzzle(db, {
      name: "Echo input",
      testCases: [{ input: [3, 5], expected: [3, 5] }],
    });
    assert.equal(r.ok, true);
  });

  it("runSolution: simple OUT of input passes", () => {
    const p = authorPuzzle(db, {
      name: "echo",
      testCases: [{ input: [1, 2], expected: [1, 2] }],
    });
    // Program: OUT INP; OUT INP
    const r = runSolution(db, p.puzzleId, [
      { op: "OUT", src: "INP" },
      { op: "OUT", src: "INP" },
    ]);
    assert.equal(r.passed, true);
    assert.equal(r.cycles, 2);
  });

  it("runSolution: MOV + ADD math", () => {
    const p = authorPuzzle(db, {
      name: "add",
      testCases: [{ input: [3, 4], expected: [7] }],
    });
    // Program: MOV R0 INP; ADD R0 INP; OUT R0
    const r = runSolution(db, p.puzzleId, [
      { op: "MOV", dst: "R0", src: "INP" },
      { op: "ADD", dst: "R0", src: "INP" },
      { op: "OUT", src: "R0" },
    ]);
    assert.equal(r.passed, true);
  });

  it("invalid op rejected", () => {
    const p = authorPuzzle(db, { name: "x", testCases: [{ input: [], expected: [] }] });
    const r = runSolution(db, p.puzzleId, [{ op: "HALT" }]);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_op");
  });

  it("wrong output → passed:false", () => {
    const p = authorPuzzle(db, {
      name: "x", testCases: [{ input: [5], expected: [99] }],
    });
    const r = runSolution(db, p.puzzleId, [{ op: "OUT", src: "INP" }]);
    assert.equal(r.passed, false);
  });

  it("submitSolution stores program when passing + leaderboard sorts cycles ASC", () => {
    const p = authorPuzzle(db, {
      name: "echo", testCases: [{ input: [1], expected: [1] }],
    });
    const a = submitSolution(db, "u1", p.puzzleId, [{ op: "OUT", src: "INP" }]);
    assert.equal(a.accepted, true);
    const b = submitSolution(db, "u2", p.puzzleId, [
      { op: "MOV", dst: "R0", src: "INP" },
      { op: "OUT", src: "R0" },
    ]);
    assert.equal(b.accepted, true);
    const lb = leaderboardForPuzzle(db, p.puzzleId);
    assert.equal(lb[0].user_id, "u1");
    assert.equal(lb[0].cycles, 1);
  });

  it("submitSolution fails-tests → not stored", () => {
    const p = authorPuzzle(db, {
      name: "x", testCases: [{ input: [5], expected: [10] }],
    });
    const r = submitSolution(db, "u1", p.puzzleId, [{ op: "OUT", src: "INP" }]);
    assert.equal(r.ok, false);
    assert.equal(r.error, "tests_failed");
    assert.equal(leaderboardForPuzzle(db, p.puzzleId).length, 0);
  });
});
