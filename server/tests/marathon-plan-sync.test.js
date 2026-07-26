// server/tests/marathon-plan-sync.test.js
//
// Part 2 of the marathon <-> goal-tree integration — tree write-back
// (status sync). Unit-level tests for lib/marathon-plan-sync.js against a
// real in-memory better-sqlite3 DB run through the FULL migration ledger
// (goal_trees/goal_nodes need migration 340).
//
// Run: node --test --test-force-exit --test-timeout=100000 server/tests/marathon-plan-sync.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createGoalTree, addSubgoals, getGoalTree } from "../lib/goal-decomposition.js";
import { findSubgoalCompleteMarkers, applyPlanSync } from "../lib/marathon-plan-sync.js";

describe("marathon-plan-sync.js — findSubgoalCompleteMarkers (pure extraction)", () => {
  it("extracts a single marker's node id, trimmed", () => {
    assert.deepEqual(findSubgoalCompleteMarkers("Done! [SUBGOAL_COMPLETE: gn_abc123 ]"), ["gn_abc123"]);
  });

  it("extracts multiple markers in one answer", () => {
    const text = "Finished both. [SUBGOAL_COMPLETE: gn_a] and also [SUBGOAL_COMPLETE: gn_b]";
    assert.deepEqual(findSubgoalCompleteMarkers(text), ["gn_a", "gn_b"]);
  });

  it("returns [] for no marker / empty / null text", () => {
    assert.deepEqual(findSubgoalCompleteMarkers("just a normal answer"), []);
    assert.deepEqual(findSubgoalCompleteMarkers(""), []);
    assert.deepEqual(findSubgoalCompleteMarkers(null), []);
    assert.deepEqual(findSubgoalCompleteMarkers(undefined), []);
  });

  it("ignores an empty-id marker", () => {
    assert.deepEqual(findSubgoalCompleteMarkers("[SUBGOAL_COMPLETE:   ]"), []);
  });
});

describe("marathon-plan-sync.js — applyPlanSync (write-back via setNodeStatus)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  it("honest no-op when no tree is linked (treeId falsy)", () => {
    const r1 = applyPlanSync(db, { treeId: null, answerText: "[SUBGOAL_COMPLETE: gn_whatever]" });
    assert.equal(r1.ok, true);
    assert.deepEqual(r1.applied, []);
    assert.equal(r1.reason, "no_tree_linked");

    const r2 = applyPlanSync(db, { treeId: undefined, answerText: "[SUBGOAL_COMPLETE: gn_whatever]" });
    assert.equal(r2.reason, "no_tree_linked");
  });

  it("honest no-op when the answer carries no marker at all", () => {
    const t = createGoalTree(db, { userId: "u1", title: "Goal A", mintDtu: false });
    const r = applyPlanSync(db, { treeId: t.treeId, answerText: "just finished some work, nothing to report" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.applied, []);
    assert.equal(r.reason, "no_marker");
  });

  it("flips the RIGHT node to done and rolls up correctly when it's the only child", () => {
    const t = createGoalTree(db, { userId: "u2", title: "Goal B", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["only subgoal"] });
    const nodeId = d.nodes[0].id;

    const r = applyPlanSync(db, { treeId: t.treeId, answerText: `All done. [SUBGOAL_COMPLETE: ${nodeId}]` });
    assert.equal(r.ok, true);
    assert.equal(r.applied.length, 1);
    assert.equal(r.applied[0].nodeId, nodeId);
    assert.equal(r.applied[0].ok, true);
    // Only child done -> rolls all the way up to the root -> tree completes.
    assert.equal(r.applied[0].treeDone, true);

    const gt = getGoalTree(db, t.treeId);
    assert.equal(gt.tree.root.status, "done");
    assert.equal(gt.tree.root.children[0].status, "done");
  });

  it("does NOT roll the parent up while a sibling is still open", () => {
    const t = createGoalTree(db, { userId: "u3", title: "Goal C", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["step one", "step two"] });
    const [stepOne] = d.nodes;

    const r = applyPlanSync(db, { treeId: t.treeId, answerText: `[SUBGOAL_COMPLETE: ${stepOne.id}]` });
    assert.equal(r.applied[0].ok, true);
    assert.equal(r.applied[0].treeDone, false);

    const gt = getGoalTree(db, t.treeId);
    assert.equal(gt.tree.root.status, "active", "root stays active — sibling still open");
    assert.equal(gt.tree.root.children.find((c) => c.id === stepOne.id).status, "done");
  });

  it("reports a real failure (not a fabricated success) for an unknown node id", () => {
    const t = createGoalTree(db, { userId: "u4", title: "Goal D", mintDtu: false });
    const r = applyPlanSync(db, { treeId: t.treeId, answerText: "[SUBGOAL_COMPLETE: gn_does_not_exist]" });
    assert.equal(r.ok, true); // the sync call itself didn't throw
    assert.equal(r.applied[0].ok, false);
    assert.equal(r.applied[0].reason, "node_not_found");
  });

  it("applies multiple markers in one answer to distinct nodes", () => {
    const t = createGoalTree(db, { userId: "u5", title: "Goal E", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["a", "b", "c"] });
    const [a, b] = d.nodes;
    const r = applyPlanSync(db, { treeId: t.treeId, answerText: `[SUBGOAL_COMPLETE: ${a.id}] [SUBGOAL_COMPLETE: ${b.id}]` });
    assert.equal(r.applied.length, 2);
    assert.ok(r.applied.every((x) => x.ok));
    const gt = getGoalTree(db, t.treeId);
    const byId = new Map(gt.tree.root.children.map((c) => [c.id, c]));
    assert.equal(byId.get(a.id).status, "done");
    assert.equal(byId.get(b.id).status, "done");
    assert.equal(byId.get(d.nodes[2].id).status, "pending");
  });
});
