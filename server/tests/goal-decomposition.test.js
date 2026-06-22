// server/tests/goal-decomposition.test.js
//
// Persistent Goal Decomposition (#10) — a durable subgoal tree (mig 340) whose
// status rolls UP as leaves complete. Root goal mints a DTU. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  createGoalTree, addSubgoals, setNodeStatus, getGoalTree, nextActionable, listGoalTrees,
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
    let leaves = nextActionable(db, t.treeId);
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
});
