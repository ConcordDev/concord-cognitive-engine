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
import { authorPuzzle, attemptCommand, getHint, hintForStep, applyHintPenalty } from "../lib/hacking.js";
import { up as upHack } from "../migrations/252_hacking_puzzles.js";
import { up as upHackHintCost } from "../migrations/358_hacking_hint_cost.js";

function freshDb() { const db = new Database(":memory:"); upHack(db); upHackHintCost(db); return db; }

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

describe("Wave 4 — hint requests are gated, not free/unlimited (minigames-capability-map item 1)", () => {
  it("applyHintPenalty: first hint per attempt is free", () => {
    assert.equal(applyHintPenalty(100, 0), 100);
    assert.equal(applyHintPenalty(100, 1), 100);
  });

  it("applyHintPenalty: every hint past the first shaves off the bounty", () => {
    assert.equal(applyHintPenalty(100, 2), 85);  // 1 extra hint -> -15%
    assert.equal(applyHintPenalty(100, 3), 70);  // 2 extra hints -> -30%
    assert.ok(applyHintPenalty(100, 3) < applyHintPenalty(100, 2), "more hints = smaller reward");
  });

  it("applyHintPenalty: floors at 40% of base, never goes to 0", () => {
    const r = applyHintPenalty(100, 50); // absurd spam
    assert.equal(r, 40);
    assert.ok(r > 0);
  });

  it("getHint increments a real per-attempt counter on every call, even repeats of the same step", () => {
    const db = freshDb();
    const id = seed(db);
    const h1 = getHint(db, id, "u1");
    const h2 = getHint(db, id, "u1");
    const h3 = getHint(db, id, "u1");
    assert.equal(h1.hintsUsed, 1);
    assert.equal(h2.hintsUsed, 2);
    assert.equal(h3.hintsUsed, 3);
    // all three are for the same (still-step-0) lead — repeats count.
    assert.equal(h1.step, 0);
    assert.equal(h2.step, 0);
    assert.equal(h3.step, 0);
  });

  it("getHint reports a projected reward that drops as hints are spammed", () => {
    const db = freshDb();
    const id = seed(db);
    const h1 = getHint(db, id, "u1"); // free
    assert.equal(h1.projectedRewardCc, 100);
    const h2 = getHint(db, id, "u1"); // 1st paid hint
    assert.equal(h2.projectedRewardCc, 85);
    const h3 = getHint(db, id, "u1"); // 2nd paid hint
    assert.equal(h3.projectedRewardCc, 70);
  });

  it("spamming hints before ever attempting a command still reduces the eventual payout on completion", () => {
    const db = freshDb();
    const id = seed(db);
    // Spam 4 explicit hint requests without submitting anything yet.
    getHint(db, id, "u1");
    getHint(db, id, "u1");
    getHint(db, id, "u1");
    getHint(db, id, "u1");
    let last;
    for (const cmd of SOLUTION) last = attemptCommand(db, id, "u1", cmd);
    assert.equal(last.completed, true);
    assert.equal(last.hintsUsed, 4);
    assert.equal(last.baseRewardCc, 100);
    assert.ok(last.rewardCc < last.baseRewardCc, "hint spam must cost real reward");
    assert.equal(last.rewardCc, applyHintPenalty(100, 4));
  });

  it("a single free initial hint (the T1.5 auto-nudge on connect) costs nothing", () => {
    const db = freshDb();
    const id = seed(db);
    getHint(db, id, "u1"); // the one auto-shown hint when the terminal opens
    let last;
    for (const cmd of SOLUTION) last = attemptCommand(db, id, "u1", cmd);
    assert.equal(last.rewardCc, 100, "one hint must stay free");
  });

  it("hints requested after a completed attempt don't further reduce the already-paid reward", () => {
    const db = freshDb();
    const id = seed(db);
    for (const cmd of SOLUTION) attemptCommand(db, id, "u1", cmd);
    const afterComplete = getHint(db, id, "u1");
    assert.equal(afterComplete.completed, true);
    assert.equal(afterComplete.hint, null);
  });
});
