// server/lib/goal-decomposition.js
//
// Persistent Goal Decomposition (#10) — a durable subgoal TREE keyed by real DB
// rows (mig 340 goal_trees + goal_nodes). A root goal mints a DTU; each subgoal
// is a node that can itself be decomposed. Status rolls UP: when every child of
// a node is done, the node auto-completes; when the root completes, the tree
// completes. Pure, bounded reads (no N+1 — the whole tree is fetched in one
// query and assembled in memory). Never fabricates progress.

import { createDTU } from "../economy/dtu-pipeline.js";

const NODE_STATUSES = ["pending", "active", "done", "blocked", "abandoned"];
let _idc = 0;
function gid(p) { return `${p}_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/**
 * Create a goal tree with a root node, optionally minting a root DTU so the goal
 * is a first-class citizen of the substrate. Returns { ok, treeId, rootId }.
 */
export function createGoalTree(db, { userId, title, description = "", mintDtu = true } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const uid = String(userId || "");
  if (!uid || !title) return { ok: false, reason: "missing_user_or_title" };

  let rootDtuId = null;
  if (mintDtu) {
    try {
      const r = createDTU(db, {
        creatorId: uid, title: `Goal: ${title}`,
        content: description || title, contentType: "text",
        lensId: "decomp", citationMode: "original",
        tags: ["goal", "decomposition"],
        metadata: { kind: "goal_root" },
      });
      if (r?.ok && r.dtu?.id) rootDtuId = r.dtu.id;
    } catch { /* DTU mint is best-effort — the tree stands without it */ }
  }

  const treeId = gid("gt");
  const rootId = gid("gn");
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO goal_trees (id, user_id, title, description, root_dtu_id) VALUES (?, ?, ?, ?, ?)`)
        .run(treeId, uid, title, description, rootDtuId);
      db.prepare(`INSERT INTO goal_nodes (id, tree_id, parent_id, title, detail, status, depth, ordinal, dtu_id)
                  VALUES (?, ?, NULL, ?, ?, 'active', 0, 0, ?)`)
        .run(rootId, treeId, title, description, rootDtuId);
    })();
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, treeId, rootId, rootDtuId };
}

/**
 * Decompose a node into subgoals. `subgoals` is an array of strings or
 * {title, detail}. Each becomes a child node; the parent flips pending→active.
 * Returns { ok, nodes:[{id,title}] }.
 */
export function addSubgoals(db, { treeId, parentId, subgoals = [] } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!treeId || !parentId) return { ok: false, reason: "missing_tree_or_parent" };
  const parent = db.prepare(`SELECT id, depth, status FROM goal_nodes WHERE id = ? AND tree_id = ?`).get(parentId, treeId);
  if (!parent) return { ok: false, reason: "parent_not_found" };
  const list = (Array.isArray(subgoals) ? subgoals : [])
    .map((s) => (typeof s === "string" ? { title: s } : s))
    .filter((s) => s && s.title);
  if (!list.length) return { ok: false, reason: "no_subgoals" };

  const baseOrd = db.prepare(`SELECT COALESCE(MAX(ordinal), -1) AS m FROM goal_nodes WHERE tree_id = ? AND parent_id = ?`)
    .get(treeId, parentId).m;
  const created = [];
  try {
    const insert = db.prepare(`INSERT INTO goal_nodes (id, tree_id, parent_id, title, detail, status, depth, ordinal)
                               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`);
    db.transaction(() => {
      list.forEach((s, i) => {
        const id = gid("gn");
        insert.run(id, treeId, parentId, String(s.title), s.detail ? String(s.detail) : null, parent.depth + 1, baseOrd + 1 + i);
        created.push({ id, title: String(s.title) });
      });
      // A parent that now has open children is itself in-progress, not done.
      if (parent.status === "pending" || parent.status === "done") {
        db.prepare(`UPDATE goal_nodes SET status = 'active', updated_at = unixepoch() WHERE id = ?`).run(parentId);
      }
    })();
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, nodes: created };
}

/**
 * Set a node's status. On `done`, roll completion UP: any ancestor whose every
 * non-abandoned child is done auto-completes, cascading to the tree. Returns
 * { ok, rolledUp:[ids], treeDone:boolean }.
 */
export function setNodeStatus(db, { treeId, nodeId, status } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!NODE_STATUSES.includes(status)) return { ok: false, reason: "bad_status", valid: NODE_STATUSES };
  const node = db.prepare(`SELECT id, parent_id FROM goal_nodes WHERE id = ? AND tree_id = ?`).get(nodeId, treeId);
  if (!node) return { ok: false, reason: "node_not_found" };

  const rolledUp = [];
  let treeDone = false;
  try {
    // Prepared statements hoisted OUT of the roll-up walk so the loop body
    // holds no db.prepare (bounded by tree depth, but kept N+1-clean regardless).
    const selKids = db.prepare(`SELECT status FROM goal_nodes WHERE parent_id = ?`);
    const markDone = db.prepare(`UPDATE goal_nodes SET status = 'done', updated_at = unixepoch() WHERE id = ?`);
    const selParent = db.prepare(`SELECT parent_id AS parentId FROM goal_nodes WHERE id = ?`);
    db.transaction(() => {
      db.prepare(`UPDATE goal_nodes SET status = ?, updated_at = unixepoch() WHERE id = ?`).run(status, nodeId);
      if (status === "done") {
        // Walk up: complete an ancestor when all its live children are done.
        let cur = node.parent_id;
        while (cur) {
          const kids = selKids.all(cur);
          const live = kids.filter((k) => k.status !== "abandoned");
          const allDone = live.length > 0 && live.every((k) => k.status === "done");
          if (!allDone) break;
          markDone.run(cur);
          rolledUp.push(cur);
          cur = selParent.get(cur)?.parentId || null;
        }
        const root = db.prepare(`SELECT status FROM goal_nodes WHERE tree_id = ? AND parent_id IS NULL`).get(treeId);
        if (root?.status === "done") {
          db.prepare(`UPDATE goal_trees SET status = 'done', updated_at = unixepoch() WHERE id = ?`).run(treeId);
          treeDone = true;
        }
      }
    })();
  } catch (e) {
    return { ok: false, reason: "update_failed", error: String(e?.message || e) };
  }
  return { ok: true, rolledUp, treeDone };
}

/** Assemble the full tree in one query (no N+1). Returns { ok, tree, progress }. */
export function getGoalTree(db, treeId) {
  if (!db || !treeId) return { ok: false, reason: "missing_tree" };
  const meta = db.prepare(`SELECT id, user_id AS userId, title, description, root_dtu_id AS rootDtuId, status FROM goal_trees WHERE id = ?`).get(treeId);
  if (!meta) return { ok: false, reason: "tree_not_found" };
  const rows = db.prepare(`
    SELECT id, parent_id AS parentId, title, detail, status, depth, ordinal, dtu_id AS dtuId
    FROM goal_nodes WHERE tree_id = ? ORDER BY depth, ordinal
  `).all(treeId);

  const byId = new Map();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  let root = null;
  for (const r of rows) {
    const node = byId.get(r.id);
    if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId).children.push(node);
    else if (!r.parentId) root = node;
  }
  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const progress = total > 0 ? Math.round((done / total) * 100) / 100 : 0;
  return { ok: true, tree: { ...meta, root }, progress, total, done };
}

/** Next actionable leaves: pending/active nodes with NO open (non-done/abandoned) children. */
export function nextActionable(db, treeId, limit = 10) {
  if (!db || !treeId) return [];
  const rows = db.prepare(`SELECT id, parent_id AS parentId, title, status FROM goal_nodes WHERE tree_id = ?`).all(treeId);
  const hasOpenChild = new Set();
  for (const r of rows) {
    if (r.parentId && r.status !== "done" && r.status !== "abandoned") hasOpenChild.add(r.parentId);
  }
  return rows
    .filter((r) => (r.status === "pending" || r.status === "active") && !hasOpenChild.has(r.id))
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 100))
    .map((r) => ({ id: r.id, title: r.title, status: r.status }));
}

/** List a user's goal trees (newest first), with cheap progress. */
export function listGoalTrees(db, userId, { status, limit = 50 } = {}) {
  if (!db || !userId) return [];
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const where = status ? `WHERE user_id = ? AND status = ?` : `WHERE user_id = ?`;
  const args = status ? [String(userId), status, lim] : [String(userId), lim];
  const trees = db.prepare(`SELECT id, title, status, created_at AS createdAt FROM goal_trees ${where} ORDER BY created_at DESC LIMIT ?`).all(...args);
  if (!trees.length) return [];
  // One grouped count query for all trees (no per-tree loop query).
  const ids = trees.map((t) => t.id);
  const ph = ids.map(() => "?").join(",");
  const counts = db.prepare(
    `SELECT tree_id AS tid, COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
     FROM goal_nodes WHERE tree_id IN (${ph}) GROUP BY tree_id`
  ).all(...ids);
  const cmap = new Map(counts.map((c) => [c.tid, c]));
  return trees.map((t) => {
    const c = cmap.get(t.id) || { total: 0, done: 0 };
    return { ...t, total: c.total, done: c.done, progress: c.total > 0 ? Math.round((c.done / c.total) * 100) / 100 : 0 };
  });
}

export default { createGoalTree, addSubgoals, setNodeStatus, getGoalTree, nextActionable, listGoalTrees };
