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
  createGoalTree, addSubgoals, setNodeStatus, getGoalTree, nextActionable, listGoalTrees,
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
}
