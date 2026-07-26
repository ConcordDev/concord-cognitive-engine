// server/domains/decomp.js
//
// Persistent Goal Decomposition (#10) — macros over the durable subgoal tree
// (lib/goal-decomposition.js, mig 340). A root goal mints a DTU; subgoals form a
// tree whose status rolls UP as leaves complete. Distinct from the OKR `goals`
// domain and the agent-initiative goals — this is the durable plan scaffold the
// R&D engine (#21) hangs work on.
//
// Registered from server.js: registerDecompMacros(register).

import {
  createGoalTree, addSubgoals, setNodeStatus, getGoalTree, nextActionable, listGoalTrees, assignNode,
} from "../lib/goal-decomposition.js";

export default function registerDecompMacros(register) {
  register("decomp", "create", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return createGoalTree(db, { userId, title: input.title, description: input.description, mintDtu: input.mintDtu !== false });
  }, { note: "create a persistent goal tree (mints a root DTU) (#10)" });

  register("decomp", "decompose", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return addSubgoals(db, { treeId: input.treeId, parentId: input.parentId, subgoals: input.subgoals });
  }, { note: "add subgoals under a node (#10)" });

  register("decomp", "advance", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return setNodeStatus(db, { treeId: input.treeId, nodeId: input.nodeId, status: input.status });
  }, { note: "set a node's status; completion rolls up the tree (#10)" });

  register("decomp", "tree", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return getGoalTree(db, input.treeId);
  }, { note: "fetch the full goal tree + progress (#10)" });

  register("decomp", "next", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, actionable: nextActionable(db, input.treeId, input.limit) };
  }, { note: "next actionable leaf subgoals (#10)" });

  register("decomp", "list", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, trees: listGoalTrees(db, userId, { status: input.status, limit: input.limit }) };
  }, { note: "list a user's goal trees with progress (#10)" });

  // Standalone trees (e.g. a single-owner ConKay "project", project-thread.js
  // mig 378) have no participant roster — the only meaningful assignment
  // without one is "claim it as mine" / "release it." Cross-participant
  // assignment (assigning to someone ELSE) requires a real membership
  // signal and lives in workspace.assign-subgoal for shared rooms instead
  // (server/domains/workspace-rooms.js, mig 386) — this macro deliberately
  // rejects a third-party assigneeUserId rather than accepting one on faith.
  register("decomp", "assign", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { treeId, nodeId, assigneeUserId } = input;
    if (!treeId || !nodeId) return { ok: false, reason: "missing_tree_or_node" };
    const gt = getGoalTree(db, treeId);
    if (!gt.ok) return { ok: false, reason: gt.reason || "tree_not_found" };
    if (gt.tree.userId !== String(userId)) return { ok: false, reason: "not_owned" };
    const target = assigneeUserId === undefined || assigneeUserId === null || assigneeUserId === "" ? null : String(assigneeUserId);
    if (target !== null && target !== String(userId)) {
      return { ok: false, reason: "assignee_must_be_self" };
    }
    return assignNode(db, { treeId, nodeId, assigneeUserId: target });
  }, { note: "claim (to yourself) or release a subgoal on a tree you own (#10)" });
}
