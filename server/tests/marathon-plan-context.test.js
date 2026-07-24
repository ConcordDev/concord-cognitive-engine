// server/tests/marathon-plan-context.test.js
//
// Part 1 of the marathon <-> goal-tree integration — plan-grounding
// (read path). Unit-level tests for lib/marathon-plan-context.js against a
// real in-memory better-sqlite3 DB run through the FULL migration ledger
// (goal_trees/goal_nodes need migration 340, projects needs migration 378).
//
// Run: node --test --test-force-exit --test-timeout=100000 server/tests/marathon-plan-context.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createGoalTree, addSubgoals, setNodeStatus } from "../lib/goal-decomposition.js";
import { createProject } from "../lib/project-thread.js";
import { getLinkedGoalTreeId, buildPlanContextBlock } from "../lib/marathon-plan-context.js";

describe("marathon-plan-context.js — plan-grounding read path", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  it("getLinkedGoalTreeId returns null for a missing/unknown project", () => {
    assert.equal(getLinkedGoalTreeId(db, "proj_does_not_exist"), null);
    assert.equal(getLinkedGoalTreeId(db, null), null);
    assert.equal(getLinkedGoalTreeId(db, undefined), null);
  });

  it("getLinkedGoalTreeId resolves the real goal_tree_id off the projects row", () => {
    const t = createGoalTree(db, { userId: "u1", title: "Ship the thing", mintDtu: false });
    const p = createProject(db, "u1", "My Project", { goalTreeId: t.treeId });
    assert.equal(p.ok, true);
    assert.equal(getLinkedGoalTreeId(db, p.project.id), t.treeId);
  });

  it("buildPlanContextBlock is an honest no-op (ok:false) for a project with no linked tree", () => {
    const p = createProject(db, "u1", "Bare project, no tree");
    const r = buildPlanContextBlock(db, p.project.id);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_goal_tree_linked");
    assert.equal(r.block, "");
  });

  it("buildPlanContextBlock is an honest no-op for a missing project id", () => {
    const r1 = buildPlanContextBlock(db, "proj_totally_bogus");
    assert.equal(r1.ok, false);
    assert.equal(r1.block, "");
    const r2 = buildPlanContextBlock(db, null);
    assert.equal(r2.ok, false);
    assert.equal(r2.block, "");
  });

  it("buildPlanContextBlock renders text that matches the LIVE tree state exactly", () => {
    const t = createGoalTree(db, { userId: "u2", title: "Refactor the payments module", mintDtu: false });
    const d = addSubgoals(db, {
      treeId: t.treeId, parentId: t.rootId,
      subgoals: ["Audit current code", "Write migration", { title: "Add tests", detail: "cover the edge cases" }],
    });
    assert.equal(d.ok, true);
    const [nodeA, nodeB, nodeC] = d.nodes;

    // Complete one subgoal for real, via the SAME primitive Part 2 uses, so
    // the "progress" line reflects genuine, not fabricated, state.
    const done = setNodeStatus(db, { treeId: t.treeId, nodeId: nodeA.id, status: "done" });
    assert.equal(done.ok, true);

    const p = createProject(db, "u2", "Payments refactor", { goalTreeId: t.treeId });
    const r = buildPlanContextBlock(db, p.project.id);

    assert.equal(r.ok, true);
    assert.equal(r.goalTreeId, t.treeId);
    // Tree = root + 3 subgoals = 4 nodes total; only nodeA is done so far
    // (matches getGoalTree's own total/done/progress contract exactly).
    assert.equal(r.total, 4);
    assert.equal(r.done, 1);
    assert.equal(r.progress, Math.round((1 / 4) * 100) / 100);

    // The two remaining subgoals must appear verbatim in the actionable list
    // AND in the rendered block — nothing invented, nothing dropped.
    const actionableIds = r.actionable.map((a) => a.id).sort();
    assert.deepEqual(actionableIds, [nodeB.id, nodeC.id].sort());

    assert.ok(r.block.includes(`Progress: 1/4 subgoal(s) done (25%)`), r.block);
    assert.ok(r.block.includes(`[${nodeB.id}] Write migration (status: pending)`), r.block);
    assert.ok(r.block.includes(`[${nodeC.id}] Add tests (status: pending)`), r.block);
    assert.ok(r.block.includes("SUBGOAL_COMPLETE"), "instructs the brain on how to report completion");
    assert.ok(r.block.includes(`Refactor the payments module`), "tree title present verbatim");
  });

  it("buildPlanContextBlock reports 'no open subgoals' honestly once the tree is fully done", () => {
    const t = createGoalTree(db, { userId: "u3", title: "Small task", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["only step"] });
    setNodeStatus(db, { treeId: t.treeId, nodeId: d.nodes[0].id, status: "done" });

    const p = createProject(db, "u3", "Small task project", { goalTreeId: t.treeId });
    const r = buildPlanContextBlock(db, p.project.id);
    assert.equal(r.ok, true);
    assert.equal(r.actionable.length, 0);
    assert.ok(r.block.includes("No open actionable subgoals remain"));
  });
});
