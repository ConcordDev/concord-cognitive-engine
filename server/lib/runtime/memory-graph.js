// server/lib/runtime/memory-graph.js
//
// P3 — Persistent memory graph (docs/CONCORD_RUNTIME_MASTER_SPEC.md §8).
// Ephemeral / Episodic / Durable classes with provenance-linked edges.

import crypto from "node:crypto";
import { publish as publishRuntimeEvent } from "./event-bus.js";

const EPHEMERAL_TTL_S = Number(process.env.CONCORD_MEMORY_EPHEMERAL_TTL_S) || 86400;
const EPISODIC_TTL_S = Number(process.env.CONCORD_MEMORY_EPISODIC_TTL_S) || 604800;

function nodeId() {
  return `rmn_${crypto.randomUUID().slice(0, 16)}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function tablesReady(db) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_memory_nodes'`).get();
  } catch {
    return false;
  }
}

/**
 * @param {object} db
 * @param {object} opts
 * @param {'ephemeral'|'episodic'|'durable'} opts.memoryClass
 * @param {string} opts.kind
 * @param {string} [opts.refId]
 * @param {string} [opts.title]
 * @param {object} opts.content
 * @param {object} [opts.provenance]
 */
export function recordNode(db, opts = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "no_db" };
  const { memoryClass, kind, content } = opts;
  if (!memoryClass || !kind || !content) return { ok: false, reason: "missing_fields" };

  const id = nodeId();
  let expiresAt = null;
  if (memoryClass === "ephemeral") expiresAt = nowSec() + EPHEMERAL_TTL_S;
  if (memoryClass === "episodic") expiresAt = nowSec() + EPISODIC_TTL_S;

  try {
    db.prepare(`
      INSERT INTO runtime_memory_nodes
        (id, memory_class, kind, ref_id, title, content_json, provenance_json, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      memoryClass,
      kind,
      opts.refId || null,
      opts.title || null,
      JSON.stringify(content),
      opts.provenance ? JSON.stringify(opts.provenance) : null,
      expiresAt,
    );
    publishRuntimeEvent("memory.node.created", { nodeId: id, memoryClass, kind, refId: opts.refId });
    return { ok: true, nodeId: id };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function linkNodes(db, { fromNodeId, toNodeId, edgeKind, weight = 1.0 }) {
  if (!db || !fromNodeId || !toNodeId || !edgeKind) return { ok: false, reason: "missing_fields" };
  try {
    db.prepare(`
      INSERT OR IGNORE INTO runtime_memory_edges (from_node_id, to_node_id, edge_kind, weight)
      VALUES (?, ?, ?, ?)
    `).run(fromNodeId, toNodeId, edgeKind, weight);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function getNode(db, nodeId) {
  if (!db || !nodeId) return null;
  try {
    const row = db.prepare(`SELECT * FROM runtime_memory_nodes WHERE id = ?`).get(nodeId);
    return rowToNode(row);
  } catch {
    return null;
  }
}

function rowToNode(row) {
  if (!row) return null;
  return {
    ...row,
    content: JSON.parse(row.content_json || "{}"),
    provenance: row.provenance_json ? JSON.parse(row.provenance_json) : null,
  };
}

export function queryGraph(db, { refId, kind, memoryClass, limit = 50 } = {}) {
  if (!db || !tablesReady(db)) return [];
  const cap = Math.min(Math.max(limit, 1), 200);
  try {
    const clauses = [];
    const params = [];
    if (refId) { clauses.push("ref_id = ?"); params.push(refId); }
    if (kind) { clauses.push("kind = ?"); params.push(kind); }
    if (memoryClass) { clauses.push("memory_class = ?"); params.push(memoryClass); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`
      SELECT id, memory_class, kind, ref_id, title, created_at, expires_at
      FROM runtime_memory_nodes ${where}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, cap);
  } catch {
    return [];
  }
}

export function getNeighborhood(db, nodeId, depth = 1) {
  if (!db || !nodeId) return { nodes: [], edges: [] };
  const nodes = new Map();
  const edges = [];
  const center = getNode(db, nodeId);
  if (!center) return { nodes: [], edges: [] };
  nodes.set(nodeId, center);

  let frontier = [nodeId];
  for (let d = 0; d < depth; d++) {
    const next = [];
    if (!frontier.length) break;
    const placeholders = frontier.map(() => "?").join(",");
    const frontierSet = new Set(frontier);
    const edgeRows = db.prepare(`
      SELECT * FROM runtime_memory_edges
      WHERE from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders})
    `).all(...frontier, ...frontier);
    const missing = new Set();
    for (const e of edgeRows) {
      edges.push(e);
      const other = frontierSet.has(e.from_node_id) ? e.to_node_id : e.from_node_id;
      if (!nodes.has(other)) missing.add(other);
    }
    if (missing.size) {
      const ids = [...missing];
      const nodePlaceholders = ids.map(() => "?").join(",");
      const nodeRows = db.prepare(`
        SELECT * FROM runtime_memory_nodes WHERE id IN (${nodePlaceholders})
      `).all(...ids);
      for (const row of nodeRows) {
        const n = rowToNode(row);
        if (n && !nodes.has(n.id)) {
          nodes.set(n.id, n);
          next.push(n.id);
        }
      }
    }
    frontier = next;
  }
  return { nodes: [...nodes.values()], edges };
}

export function ingestMissionCompletion(db, mission) {
  if (!db || !mission) return { ok: false, reason: "missing_mission" };
  const episodic = recordNode(db, {
    memoryClass: "episodic",
    kind: "mission_completion",
    refId: mission.id,
    title: mission.title,
    content: {
      template: mission.template,
      source: mission.source,
      status: mission.status,
      stepsCompleted: mission.current_step,
      totalSteps: mission.total_steps,
      traceId: mission.trace_id,
    },
    provenance: { mission_id: mission.id, source: mission.source },
  });
  if (!episodic.ok) return episodic;

  if (mission.status === "completed" && mission.template === "fleet_health") {
    recordNode(db, {
      memoryClass: "durable",
      kind: "fleet_health_pass",
      refId: mission.id,
      title: `Fleet health OK @ ${new Date().toISOString()}`,
      content: { missionId: mission.id, completedAt: nowSec() },
      provenance: { derived_from: episodic.nodeId },
    });
  }
  linkNodes(db, { fromNodeId: episodic.nodeId, toNodeId: episodic.nodeId, edgeKind: "self", weight: 0 });
  return { ok: true, nodeId: episodic.nodeId };
}

export function sweepExpired(db) {
  if (!db || !tablesReady(db)) return 0;
  try {
    const r = db.prepare(`
      DELETE FROM runtime_memory_nodes WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(nowSec());
    return r.changes || 0;
  } catch {
    return 0;
  }
}

export function memoryGraphOverview(db) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const byClass = db.prepare(`
      SELECT memory_class, COUNT(*) AS c FROM runtime_memory_nodes GROUP BY memory_class
    `).all();
    const edgeCount = db.prepare(`SELECT COUNT(*) AS c FROM runtime_memory_edges`).get()?.c || 0;
    return {
      ok: true,
      nodesByClass: Object.fromEntries(byClass.map((r) => [r.memory_class, r.c])),
      edgeCount,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
