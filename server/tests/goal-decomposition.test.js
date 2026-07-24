// server/tests/goal-decomposition.test.js
//
// Persistent Goal Decomposition (#10) — a durable subgoal tree (mig 340) whose
// status rolls UP as leaves complete. Root goal mints a DTU. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  createGoalTree, addSubgoals, setNodeStatus, getGoalTree, nextActionable, listGoalTrees, assignNode,
} from "../lib/goal-decomposition.js";
import registerDecompMacros from "../domains/decomp.js";

describe("Persistent Goal Decomposition (#10)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerDecompMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("creates a tree with a root node and mints a root DTU", () => {
    const r = createGoalTree(db, { userId: "u1", title: "Ship the R&D engine", description: "end to end" });
    assert.equal(r.ok, true);
    assert.ok(r.treeId && r.rootId);
    assert.ok(r.rootDtuId, "root DTU minted");
    const dtu = db.prepare("SELECT id, creator_id FROM dtus WHERE id = ?").get(r.rootDtuId);
    assert.equal(dtu.creator_id, "u1");
  });

  it("decomposes a node into subgoals and flips the parent active", () => {
    const t = createGoalTree(db, { userId: "u1", title: "Build feature", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["design", "implement", { title: "test", detail: "write tests" }] });
    assert.equal(d.ok, true);
    assert.equal(d.nodes.length, 3);
    const tree = getGoalTree(db, t.treeId);
    assert.equal(tree.tree.root.children.length, 3);
    assert.equal(tree.tree.root.children[2].detail, "write tests");
    assert.equal(tree.total, 4); // root + 3
  });

  it("rolls completion UP — all children done completes the parent and the tree", () => {
    const t = createGoalTree(db, { userId: "u1", title: "Two-step", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["a", "b"] });
    const [a, b] = d.nodes;
    let r = setNodeStatus(db, { treeId: t.treeId, nodeId: a.id, status: "done" });
    assert.equal(r.treeDone, false, "one child done is not enough");
    r = setNodeStatus(db, { treeId: t.treeId, nodeId: b.id, status: "done" });
    assert.ok(r.rolledUp.includes(t.rootId), "root rolled up");
    assert.equal(r.treeDone, true);
    const tmeta = db.prepare("SELECT status FROM goal_trees WHERE id = ?").get(t.treeId);
    assert.equal(tmeta.status, "done");
  });

  it("abandoned children don't block roll-up; nextActionable returns open leaves", () => {
    const t = createGoalTree(db, { userId: "u1", title: "With abandon", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["keep", "drop"] });
    const [keep, drop] = d.nodes;
    setNodeStatus(db, { treeId: t.treeId, nodeId: drop.id, status: "abandoned" });
    const leaves = nextActionable(db, t.treeId);
    assert.ok(leaves.some((l) => l.id === keep.id), "open leaf surfaces");
    assert.ok(!leaves.some((l) => l.id === drop.id), "abandoned leaf does not");
    const r = setNodeStatus(db, { treeId: t.treeId, nodeId: keep.id, status: "done" });
    assert.equal(r.treeDone, true, "the lone live child completing finishes the tree");
  });

  it("lists a user's trees with progress + macros round-trip", async () => {
    const trees = listGoalTrees(db, "u1");
    assert.ok(trees.length >= 4);
    assert.ok(trees.every((t) => typeof t.progress === "number"));

    const c = await macros.get("decomp.create")({ db, actor: { userId: "u9" } }, { title: "macro goal", mintDtu: false });
    assert.equal(c.ok, true);
    const dec = await macros.get("decomp.decompose")({ db }, { treeId: c.treeId, parentId: c.rootId, subgoals: ["x"] });
    assert.equal(dec.ok, true);
    const nx = await macros.get("decomp.next")({ db }, { treeId: c.treeId });
    assert.equal(nx.actionable[0].title, "x");
    const list = await macros.get("decomp.list")({ db, actor: { userId: "u9" } }, {});
    assert.equal(list.trees.length, 1);
  });

  describe("assignNode (#386) — per-subgoal assignee, pure storage", () => {
    it("assigns and clears a real node's assignee", () => {
      const t = createGoalTree(db, { userId: "u1", title: "Assignable", mintDtu: false });
      const r = assignNode(db, { treeId: t.treeId, nodeId: t.rootId, assigneeUserId: "u1" });
      assert.equal(r.ok, true);
      assert.equal(r.assignedToUserId, "u1");
      const tree = getGoalTree(db, t.treeId);
      assert.equal(tree.tree.root.assignedToUserId, "u1");

      const cleared = assignNode(db, { treeId: t.treeId, nodeId: t.rootId, assigneeUserId: null });
      assert.equal(cleared.ok, true);
      assert.equal(cleared.assignedToUserId, null);
      assert.equal(getGoalTree(db, t.treeId).tree.root.assignedToUserId, null);
    });

    it("rejects a node that doesn't belong to the given tree", () => {
      const t1 = createGoalTree(db, { userId: "u1", title: "Tree 1", mintDtu: false });
      const t2 = createGoalTree(db, { userId: "u1", title: "Tree 2", mintDtu: false });
      const r = assignNode(db, { treeId: t2.treeId, nodeId: t1.rootId, assigneeUserId: "u1" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "node_not_found");
    });

    it("a new node defaults to unassigned", () => {
      const t = createGoalTree(db, { userId: "u1", title: "Default unassigned", mintDtu: false });
      assert.equal(getGoalTree(db, t.treeId).tree.root.assignedToUserId, null);
    });
  });

  describe("decomp.assign macro (#386) — single-owner self-claim, no third-party assignment", () => {
    it("the tree owner can claim (self-assign) and release a subgoal", async () => {
      const c = await macros.get("decomp.create")({ db, actor: { userId: "owner_a" } }, { title: "Solo project", mintDtu: false });
      const claim = await macros.get("decomp.assign")({ db, actor: { userId: "owner_a" } }, { treeId: c.treeId, nodeId: c.rootId, assigneeUserId: "owner_a" });
      assert.equal(claim.ok, true);
      assert.equal(claim.assignedToUserId, "owner_a");

      const release = await macros.get("decomp.assign")({ db, actor: { userId: "owner_a" } }, { treeId: c.treeId, nodeId: c.rootId, assigneeUserId: null });
      assert.equal(release.ok, true);
      assert.equal(release.assignedToUserId, null);
    });

    it("rejects a caller who does not own the tree", async () => {
      const c = await macros.get("decomp.create")({ db, actor: { userId: "owner_b" } }, { title: "Not yours", mintDtu: false });
      const r = await macros.get("decomp.assign")({ db, actor: { userId: "intruder" } }, { treeId: c.treeId, nodeId: c.rootId, assigneeUserId: "intruder" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "not_owned");
    });

    it("rejects assigning to anyone other than the caller — no participant roster to validate against here", async () => {
      const c = await macros.get("decomp.create")({ db, actor: { userId: "owner_c" } }, { title: "Solo", mintDtu: false });
      const r = await macros.get("decomp.assign")({ db, actor: { userId: "owner_c" } }, { treeId: c.treeId, nodeId: c.rootId, assigneeUserId: "someone_else" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "assignee_must_be_self");
    });

    it("requires an authenticated actor and both treeId + nodeId", async () => {
      const c = await macros.get("decomp.create")({ db, actor: { userId: "owner_d" } }, { title: "X", mintDtu: false });
      assert.equal((await macros.get("decomp.assign")({ db, actor: {} }, { treeId: c.treeId, nodeId: c.rootId })).reason, "no_user");
      assert.equal((await macros.get("decomp.assign")({ db, actor: { userId: "owner_d" } }, { nodeId: c.rootId })).reason, "missing_tree_or_node");
    });
  });
});
