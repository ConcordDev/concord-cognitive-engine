/**
 * T1.5 — the hacking terminal now GUIDES the player along the solution trail
 * (hintForStep / getHint / nextHint on each step) instead of requiring them to
 * memorize an exact command sequence. The solution path stays server-private;
 * hints describe the lead (the intent), never the literal command.
 *
 * Run: node --test tests/hacking-hints.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { authorPuzzle, attemptCommand, getHint, hintForStep } from "../lib/hacking.js";
import { up as upHack } from "../migrations/252_hacking_puzzles.js";

function freshDb() { const db = new Database(":memory:"); upHack(db); return db; }

const TREE = { type: "dir", contents: { "logs": { type: "dir", contents: { "auth.log": { type: "file", text: "ref: db-prime" } } } } };
const SOLUTION = ["ls", "cd logs", "cat auth.log", "connect db-prime"];

function seed(db) {
  return authorPuzzle(db, { name: "trail", difficulty: 2, terminalTree: TREE, solutionPath: SOLUTION, rewardCc: 100 }).puzzleId;
}

describe("T1.5 — hintForStep describes the lead, not the command", () => {
  it("connect → names the host as a lead", () => {
    const h = hintForStep("connect db-prime");
    assert.ok(/db-prime/.test(h));
    assert.ok(!/^connect/.test(h)); // not the literal command
  });
  it("cat/cd/decrypt/exec each produce guidance", () => {
    assert.ok(/auth\.log/.test(hintForStep("cat auth.log")));
    assert.ok(/logs/.test(hintForStep("cd logs")));
    assert.ok(hintForStep("decrypt vault").length > 0);
    assert.ok(hintForStep("exec payload").length > 0);
  });
});

describe("T1.5 — getHint points at the current step", () => {
  it("initial hint points at the first solution step", () => {
    const db = freshDb();
    const id = seed(db);
    const h = getHint(db, id, "u1");
    assert.equal(h.ok, true);
    assert.equal(h.step, 0);
    assert.equal(h.hint, hintForStep(SOLUTION[0]));
  });

  it("after one correct step, the hint advances", () => {
    const db = freshDb();
    const id = seed(db);
    attemptCommand(db, id, "u1", "ls");
    const h = getHint(db, id, "u1");
    assert.equal(h.step, 1);
    assert.equal(h.hint, hintForStep(SOLUTION[1]));
  });
});

describe("T1.5 — attemptCommand returns nextHint", () => {
  it("a correct step yields the next lead", () => {
    const db = freshDb();
    const id = seed(db);
    const r = attemptCommand(db, id, "u1", "ls");
    assert.equal(r.matched, true);
    assert.ok(/logs/.test(r.nextHint));
  });

  it("a wrong step resets AND re-points at the first lead", () => {
    const db = freshDb();
    const id = seed(db);
    const r = attemptCommand(db, id, "u1", "cat wrong.txt");
    assert.equal(r.matched, false);
    assert.equal(r.progressReset, true);
    assert.equal(r.nextHint, hintForStep(SOLUTION[0]));
  });

  it("following the trail to the end completes the puzzle", () => {
    const db = freshDb();
    const id = seed(db);
    let last;
    for (const cmd of SOLUTION) last = attemptCommand(db, id, "u1", cmd);
    assert.equal(last.completed, true);
    assert.equal(last.rewardCc, 100);
    // a completed attempt reports no further hint
    assert.equal(getHint(db, id, "u1").completed, true);
  });
});
