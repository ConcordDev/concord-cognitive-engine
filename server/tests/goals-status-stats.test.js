// S7 (Review 5 F8) — the Autonomy status header stats are derived
// from the goal registry at read time, not read from the hand-kept
// cumulative counters that evaluateGoal never updated. server.js is a
// monolith that cannot be imported standalone, so this suite extracts
// the exact shipped deriveGoalStats bytes and behaviour-tests them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
const i = serverSrc.indexOf("function deriveGoalStats");
assert.ok(i >= 0, "deriveGoalStats must exist in server.js");
const j = serverSrc.indexOf("\n}\n", i) + 3;
const deriveGoalStats = new Function(serverSrc.slice(i, j) + "; return deriveGoalStats;")();

test("status macro wires the derivation, not the stored counters", () => {
  assert.ok(serverSrc.includes("stats: deriveGoalStats(ctx.state.goals),"));
});

test("the F8 exhibit: a goal approved through evaluation counts as approved", () => {
  // Stored counters after an evaluate-approval: approved stays 0
  // (the old header). The derivation counts current states instead.
  const registry = new Map([
    ["g1", { id: "g1", state: "approved" }],
    ["g2", { id: "g2", state: "proposed" }],
    ["g3", { id: "g3", state: "abandoned" }],
  ]);
  const s = deriveGoalStats({ registry, stats: { proposed: 3, approved: 0, completed: 0, abandoned: 0, avgCompletionTime: 0 } });
  assert.equal(s.approved, 1);
  assert.equal(s.proposed, 1);
  assert.equal(s.abandoned, 1);
  assert.equal(s.total, 3);
});

test("every state counts; unknown states count toward total only", () => {
  const registry = new Map([
    ["a", { id: "a", state: "active" }],
    ["b", { id: "b", state: "active" }],
    ["c", { id: "c", state: "completed" }],
    ["d", { id: "d", state: "blocked" }],
    ["e", { id: "e", state: "paused" }],
    ["f", { id: "f", state: "evaluating" }],
    ["x", { id: "x", state: "bogus" }],
  ]);
  const s = deriveGoalStats({ registry, stats: { avgCompletionTime: 42 } });
  assert.equal(s.active, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.blocked, 1);
  assert.equal(s.paused, 1);
  assert.equal(s.evaluating, 1);
  assert.equal(s.total, 7);
  assert.equal(s.avgCompletionTime, 42); // carried, not counted
});

test("empty registry derives zeros", () => {
  const s = deriveGoalStats({ registry: new Map(), stats: {} });
  assert.equal(s.total, 0);
  assert.equal(s.proposed, 0);
  assert.equal(s.avgCompletionTime, 0);
});
