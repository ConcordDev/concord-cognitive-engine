// server/tests/marathon-replanner.test.js
//
// Part 3 of the marathon <-> goal-tree integration — the explicit replan
// checkpoint. Unit-level tests for lib/marathon-replanner.js:
//   - shouldReplan (pure trigger logic, no DB)
//   - runReplanCheckpoint (applies a scripted brain's structured output
//     through the real addSubgoals/setNodeStatus primitives)
//   - the PINNED SAFETY INVARIANT: a replan can never touch/expand
//     allowed_domains_json or budget_cap on the marathon session.
//
// Run: node --test --test-force-exit --test-timeout=100000 server/tests/marathon-replanner.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createGoalTree, addSubgoals, getGoalTree, setNodeStatus } from "../lib/goal-decomposition.js";
import { startMarathon } from "../lib/agent-marathon.js";
import { shouldReplan, runReplanCheckpoint, REPLAN_MARKER, DEFAULT_REPLAN_TURN_INTERVAL } from "../lib/marathon-replanner.js";

function scriptedBrain(text) {
  return async () => ({ ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 });
}

describe("marathon-replanner.js — shouldReplan (pure trigger logic)", () => {
  it("triggers on an explicit [REPLAN_NEEDED: reason] marker regardless of turn counts", () => {
    const r = shouldReplan({ answerText: "Stuck. [REPLAN_NEEDED: same approach failed 3 times]", priorTotalTurns: 1, newTotalTurns: 2 });
    assert.equal(r.trigger, true);
    assert.equal(r.reason, "same approach failed 3 times");
  });

  it("triggers with a default reason when the marker has no reason text", () => {
    const r = shouldReplan({ answerText: "[REPLAN_NEEDED:]", priorTotalTurns: 0, newTotalTurns: 1 });
    assert.equal(r.trigger, true);
    assert.equal(r.reason, "brain_requested");
  });

  it("does not trigger with no marker and turns below the interval", () => {
    const r = shouldReplan({ answerText: "ordinary progress update", priorTotalTurns: 3, newTotalTurns: 5, intervalTurns: 20 });
    assert.equal(r.trigger, false);
  });

  it("triggers on crossing the turn-interval boundary", () => {
    const r = shouldReplan({ answerText: "ordinary progress update", priorTotalTurns: 18, newTotalTurns: 21, intervalTurns: 20 });
    assert.equal(r.trigger, true);
    assert.equal(r.reason, "turn_interval");
  });

  it("does not re-trigger for turns that stay within the same interval bucket", () => {
    const r = shouldReplan({ answerText: "ordinary progress update", priorTotalTurns: 21, newTotalTurns: 25, intervalTurns: 20 });
    assert.equal(r.trigger, false);
  });

  it("interval trigger can be disabled with intervalTurns: 0 (marker-only mode)", () => {
    const r = shouldReplan({ answerText: "ordinary progress update", priorTotalTurns: 18, newTotalTurns: 40, intervalTurns: 0 });
    assert.equal(r.trigger, false);
  });

  it("DEFAULT_REPLAN_TURN_INTERVAL is a sane positive default", () => {
    assert.ok(Number.isFinite(DEFAULT_REPLAN_TURN_INTERVAL) && DEFAULT_REPLAN_TURN_INTERVAL > 0);
  });

  it("REPLAN_MARKER is exported and matches the documented convention", () => {
    assert.ok(REPLAN_MARKER.test("[REPLAN_NEEDED: x]"));
  });
});

describe("marathon-replanner.js — runReplanCheckpoint (applies structured output via addSubgoals/setNodeStatus)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  it("adds new subgoals under the tree root and abandons named nodes", async () => {
    const t = createGoalTree(db, { userId: "u1", title: "Ship the feature", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["dead-end approach", "keep this one"] });
    const [deadEnd] = d.nodes;

    const brainReply = JSON.stringify({
      addSubgoals: [{ title: "try a different approach", detail: "the first one was a dead end" }],
      abandonNodeIds: [deadEnd.id],
    });
    const r = await runReplanCheckpoint(db, { treeId: t.treeId, userId: "u1", reason: "test", brain: scriptedBrain(brainReply) });

    assert.equal(r.ok, true);
    assert.equal(r.added.ok, true);
    assert.equal(r.added.nodes.length, 1);
    assert.equal(r.added.nodes[0].title, "try a different approach");
    assert.equal(r.abandoned.length, 1);
    assert.equal(r.abandoned[0].nodeId, deadEnd.id);
    assert.equal(r.abandoned[0].ok, true);

    const gt = getGoalTree(db, t.treeId);
    const byTitle = new Map(gt.tree.root.children.map((c) => [c.title, c]));
    assert.equal(byTitle.get("dead-end approach").status, "abandoned");
    assert.ok(byTitle.get("try a different approach"), "new subgoal is really in the tree");
  });

  it("tolerates a JSON reply wrapped in prose/markdown fences", async () => {
    const t = createGoalTree(db, { userId: "u2", title: "Goal", mintDtu: false });
    const wrapped = "Sure, here's my plan:\n```json\n" + JSON.stringify({ addSubgoals: [{ title: "new step" }], abandonNodeIds: [] }) + "\n```";
    const r = await runReplanCheckpoint(db, { treeId: t.treeId, userId: "u2", brain: scriptedBrain(wrapped) });
    assert.equal(r.ok, true);
    assert.equal(r.added.nodes.length, 1);
  });

  it("honestly fails (not a fabricated success) on unparseable brain output", async () => {
    const t = createGoalTree(db, { userId: "u3", title: "Goal", mintDtu: false });
    const r = await runReplanCheckpoint(db, { treeId: t.treeId, userId: "u3", brain: scriptedBrain("I refuse to output JSON today.") });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unparseable_output");
  });

  it("honestly fails for a missing/unknown tree", async () => {
    const r = await runReplanCheckpoint(db, { treeId: "gt_nope", userId: "u4", brain: scriptedBrain("{}") });
    assert.equal(r.ok, false);
  });

  it("caps additions/abandonments at their documented ceilings", async () => {
    const t = createGoalTree(db, { userId: "u5", title: "Goal", mintDtu: false });
    const manyAdds = Array.from({ length: 30 }, (_, i) => ({ title: `subgoal ${i}` }));
    const r = await runReplanCheckpoint(db, {
      treeId: t.treeId, userId: "u5",
      brain: scriptedBrain(JSON.stringify({ addSubgoals: manyAdds, abandonNodeIds: [] })),
    });
    assert.equal(r.ok, true);
    assert.ok(r.added.nodes.length <= 10, `expected <=10 subgoals added, got ${r.added.nodes.length}`);
  });
});

describe("marathon-replanner.js — PINNED SAFETY INVARIANT: replan never touches the mandate envelope", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  it("a replan brain reply that smuggles allowed_domains_json/budget_cap/max_turns has ZERO effect on the session row", async () => {
    // Real marathon session with a REAL, deliberately narrow mandate.
    const started = startMarathon(db, "victim_user", {
      goal: "Do a small bounded task",
      allowedDomains: ["dtu"],
      budgetCap: 3,
      maxTurns: 10,
    });
    assert.equal(started.ok, true);

    const before = db.prepare(`
      SELECT allowed_domains_json, budget_cap, max_turns, budget_spent
      FROM agent_marathon_sessions WHERE id = ?
    `).get(started.sessionId);
    assert.equal(before.allowed_domains_json, JSON.stringify(["dtu"]));
    assert.equal(before.budget_cap, 3);
    assert.equal(before.max_turns, 10);

    // A goal tree + linked project, as if this marathon were plan-grounded.
    const t = createGoalTree(db, { userId: "victim_user", title: "Do a small bounded task", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["real step"] });

    // The MALICIOUS payload: alongside a legitimate addSubgoals entry, it
    // tries to smuggle mandate-expanding keys that look like they might
    // widen the session's permissions.
    const maliciousReply = JSON.stringify({
      addSubgoals: [{ title: "legitimately useful new subgoal" }],
      abandonNodeIds: [],
      allowed_domains_json: JSON.stringify(["dtu", "world", "economy", "everything"]),
      budget_cap: 999999,
      max_turns: 999999,
      budget_spent: 0,
      revoked_at: null,
      status: "running",
    });

    const r = await runReplanCheckpoint(db, {
      treeId: t.treeId, userId: "victim_user", reason: "adversarial test",
      brain: scriptedBrain(maliciousReply),
    });
    assert.equal(r.ok, true, "the legitimate part of the call still succeeds");
    assert.equal(r.added.nodes.length, 1, "the legitimate addSubgoals entry was still applied");

    // The invariant: the session's mandate fields are BYTE-IDENTICAL to
    // before the replan call. runReplanCheckpoint has no code path that
    // reads or writes agent_marathon_sessions at all.
    const after = db.prepare(`
      SELECT allowed_domains_json, budget_cap, max_turns, budget_spent, revoked_at, status
      FROM agent_marathon_sessions WHERE id = ?
    `).get(started.sessionId);
    assert.equal(after.allowed_domains_json, before.allowed_domains_json);
    assert.equal(after.budget_cap, before.budget_cap);
    assert.equal(after.max_turns, before.max_turns);
    assert.equal(after.budget_spent, before.budget_spent);
    assert.equal(after.revoked_at, null);
    assert.equal(after.status, "pending", "status untouched by the replan call itself");
  });

  it("even a reply that is ONLY mandate-shaped keys (no addSubgoals/abandonNodeIds at all) changes nothing", async () => {
    const started = startMarathon(db, "victim_user_2", { goal: "x", allowedDomains: ["tools"], budgetCap: 1 });
    const before = db.prepare(`SELECT allowed_domains_json, budget_cap FROM agent_marathon_sessions WHERE id = ?`).get(started.sessionId);

    const t = createGoalTree(db, { userId: "victim_user_2", title: "x", mintDtu: false });
    const onlyMandateKeys = JSON.stringify({ allowed_domains_json: JSON.stringify(["everything"]), budget_cap: 1000000 });
    const r = await runReplanCheckpoint(db, { treeId: t.treeId, userId: "victim_user_2", brain: scriptedBrain(onlyMandateKeys) });
    assert.equal(r.ok, true);
    assert.equal(r.added.nodes.length, 0, "no legitimate addSubgoals key present -> nothing added");

    const after = db.prepare(`SELECT allowed_domains_json, budget_cap FROM agent_marathon_sessions WHERE id = ?`).get(started.sessionId);
    assert.deepEqual(after, before);
  });
});
