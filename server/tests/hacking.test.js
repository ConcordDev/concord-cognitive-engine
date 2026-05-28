// Phase CC2 — hacking puzzle tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  authorPuzzle, attemptCommand, listPuzzles, getPuzzle, getAttemptStatus,
} from "../lib/hacking.js";
import { up as upHack } from "../migrations/252_hacking_puzzles.js";

function freshDb() { const db = new Database(":memory:"); upHack(db); return db; }

describe("Phase CC2 — hacking puzzles", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("authorPuzzle stores tree + solution path", () => {
    const r = authorPuzzle(db, {
      name: "Cyber mainframe",
      difficulty: 2,
      terminalTree: { root: { type: "dir", children: ["sys", "etc"] } },
      solutionPath: ["ls /", "cd sys", "cat config", "connect cyber-mainframe"],
      rewardCc: 100,
    });
    assert.equal(r.ok, true);
  });

  it("invalid command rejected", () => {
    const r = authorPuzzle(db, {
      name: "x", terminalTree: {}, solutionPath: ["ls"],
    });
    const a = attemptCommand(db, r.puzzleId, "u1", "rm -rf /");
    assert.equal(a.ok, false);
    assert.equal(a.error, "invalid_command");
  });

  it("correct sequential commands advance progress", () => {
    const r = authorPuzzle(db, {
      name: "x", terminalTree: {},
      solutionPath: ["ls", "cd sys", "connect mainframe"],
    });
    const s1 = attemptCommand(db, r.puzzleId, "u1", "ls");
    assert.equal(s1.matched, true);
    assert.equal(s1.step, 1);
    const s2 = attemptCommand(db, r.puzzleId, "u1", "cd sys");
    assert.equal(s2.matched, true);
    assert.equal(s2.step, 2);
  });

  it("wrong step resets progress", () => {
    const r = authorPuzzle(db, {
      name: "x", terminalTree: {},
      solutionPath: ["ls", "cd sys", "connect mainframe"],
    });
    attemptCommand(db, r.puzzleId, "u1", "ls");
    const wrong = attemptCommand(db, r.puzzleId, "u1", "ls"); // wrong (expected cd sys)
    assert.equal(wrong.matched, false);
    assert.equal(wrong.progressReset, true);
    const status = getAttemptStatus(db, "u1", r.puzzleId);
    assert.equal(JSON.parse(status.commands_log).length, 0);
  });

  it("completing all steps marks completed + returns reward", () => {
    const r = authorPuzzle(db, {
      name: "x", terminalTree: {}, solutionPath: ["ls", "exec"],
      rewardCc: 25,
    });
    attemptCommand(db, r.puzzleId, "u1", "ls");
    const done = attemptCommand(db, r.puzzleId, "u1", "exec");
    assert.equal(done.completed, true);
    assert.equal(done.rewardCc, 25);
  });

  it("re-attempt on completed returns alreadyComplete", () => {
    const r = authorPuzzle(db, { name: "x", terminalTree: {}, solutionPath: ["ls"] });
    attemptCommand(db, r.puzzleId, "u1", "ls");
    const a = attemptCommand(db, r.puzzleId, "u1", "ls");
    assert.equal(a.alreadyComplete, true);
  });

  it("getPuzzle does NOT leak solution_path", () => {
    const r = authorPuzzle(db, {
      name: "x", terminalTree: { root: "secret" }, solutionPath: ["ls", "exec"],
    });
    const p = getPuzzle(db, r.puzzleId);
    assert.ok(p);
    assert.equal(p.solution_path_json, undefined,
      "solution_path_json should not be returned");
  });
});
