// server/lib/runtime/supervisor-tree.js
//
// Hierarchical supervisor: Dila → directors → workers → capabilities.

import { DILA_AGENT_ID } from "./constants.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_supervisor_nodes'`).get();
  } catch {
    return false;
  }
}

export function listSupervisorNodes(db, parentId = null) {
  if (!db || !tablesReady(db)) return [];
  try {
    if (parentId === null) {
      return db.prepare(`
        SELECT * FROM runtime_supervisor_nodes WHERE parent_id IS NULL ORDER BY sort_order ASC
      `).all();
    }
    return db.prepare(`
      SELECT * FROM runtime_supervisor_nodes WHERE parent_id = ? ORDER BY sort_order ASC
    `).all(parentId);
  } catch {
    return [];
  }
}

export function upsertSupervisorNode(db, node) {
  if (!db || !tablesReady(db) || !node?.id) return { ok: false, reason: "missing_inputs" };
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO runtime_supervisor_nodes
        (id, parent_id, node_kind, label, agent_id, status, meta_json, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        node_kind = excluded.node_kind,
        label = excluded.label,
        agent_id = excluded.agent_id,
        status = excluded.status,
        meta_json = excluded.meta_json,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(
      node.id,
      node.parent_id ?? null,
      node.node_kind || "subsystem",
      node.label,
      node.agent_id || null,
      node.status || "UNKNOWN",
      node.meta_json ? JSON.stringify(node.meta_json) : null,
      node.sort_order ?? 0,
      now,
    );
    return { ok: true, id: node.id };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function buildSupervisorTree(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const all = db.prepare(`SELECT * FROM runtime_supervisor_nodes ORDER BY sort_order ASC`).all();
    const byId = new Map(all.map((n) => [n.id, { ...n, meta: n.meta_json ? JSON.parse(n.meta_json) : null, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id).children.push(node);
      } else if (!node.parent_id) {
        roots.push(node);
      }
    }
    return { ok: true, roots, nodeCount: all.length };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * Sync live worker roster into supervisor tree under directors.
 */
export async function syncWorkersIntoTree(db, roster = []) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const directorFor = (name) => {
    const n = String(name || "");
    if (/research|kimi|gemini|data|embed/.test(n)) return "dila.research";
    if (/code|mistral|grok|frontend|qa|pickle|lightning/.test(n)) return "dila.engineering";
    return "dila.operations";
  };
  let synced = 0;
  for (const w of roster) {
    const parent = directorFor(w.name);
    const status = w.alive ? "HEALTHY" : "DEGRADED";
    const r = upsertSupervisorNode(db, {
      id: `worker.${w.name}`,
      parent_id: parent,
      node_kind: "worker",
      label: w.name,
      status,
      meta_json: { family: w.family, source: w.source, specialization: w.specialization },
      sort_order: synced,
    });
    if (r.ok) synced++;
  }
  upsertSupervisorNode(db, {
    id: "dila",
    parent_id: null,
    node_kind: "root",
    label: "DILA",
    agent_id: DILA_AGENT_ID,
    status: roster.some((w) => w.alive) ? "HEALTHY" : "DEGRADED",
  });
  return { ok: true, synced };
}

export async function collectHierarchicalSupervisor({ db, dispatchMCP, flatStatus } = {}) {
  const tree = buildSupervisorTree(db);
  let roster = [];
  try {
    const { getWorkerRoster } = await import("../dila-workers.js");
    roster = await getWorkerRoster();
    await syncWorkersIntoTree(db, roster);
  } catch { /* optional */ }

  if (flatStatus?.subsystems) {
    const map = {
      mission_runtime: "dila.mission_runtime",
      auth_gate: "dila.auth_gate",
      organ_fleet: "dila.operations",
      marathon_bridge: "dila.engineering",
      coding_intelligence: "dila.engineering",
      memory_graph: "dila.research",
      predict: "dila.research",
    };
    for (const [key, nodeId] of Object.entries(map)) {
      const sub = flatStatus.subsystems[key];
      if (!sub) continue;
      upsertSupervisorNode(db, {
        id: nodeId,
        parent_id: nodeId.startsWith("dila.") ? "dila.executive" : null,
        node_kind: "subsystem",
        label: key.replace(/_/g, " "),
        status: sub.status === "HEALTHY" || sub.status === "ENFORCING" ? "HEALTHY"
          : sub.status === "DISABLED" ? "DISABLED" : "DEGRADED",
        meta_json: sub,
      });
    }
  }

  const refreshed = buildSupervisorTree(db);
  return {
    ok: true,
    tree: refreshed.roots,
    nodeCount: refreshed.nodeCount,
    workersAlive: roster.filter((w) => w.alive).length,
    workersTotal: roster.length,
  };
}
