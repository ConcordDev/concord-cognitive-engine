// server/lib/entity-substrate.js
//
// #1715 S2 — the Knowledge Graph workbench on the canonical store.
// The entity workbench's nodes/edges/schemas live as DTUs in
// STATE.dtus (the canonical entity store, per B5's determination):
//
//   node   → a DTU, machine.kind "entity-node", owner-scoped
//            (privacy "private", scope "user", author = the user), so
//            the graph projections' visibility rules keep it visible
//            to its owner only. title carries the node's name; the
//            workbench fields (entityType, attributes with their
//            provenance stamps, wikidataId) ride in `machine`.
//   edge   → a typed relation (S1, lib/dtu-relations.js) on the
//            from-node's DTU; the edge's weight rides in the
//            relation's attributes.
//   schema → a DTU, machine.kind "entity-schema" (distinct from the
//            platform schema registry's "schema" DTUs — no collision),
//            its fields in `machine`.
//
// Views returned here reproduce the legacy STATE.entityGraph record
// shapes EXACTLY ({ id, name, entityType, attributes, wikidataId,
// createdAt } / { id, from, to, relType, weight, createdAt } /
// { id, className, attributes, createdAt, updatedAt? }) — the lens
// macros and the frontend cannot tell the store moved.
//
// Every mutation re-`set`s the DTU: STATE.dtus is a write-through
// store, and an in-place mutation without a set does not persist.
//
// Legacy compatibility, stated plainly:
//  - Migration (migrateUser) moves a user's legacy entityGraph data
//    onto DTUs with the SAME ids, then freezes the legacy arrays —
//    they stay readable in state, nothing reads them for the
//    workbench any more, nothing is deleted. Idempotent: DTU
//    presence is the marker; a foreign DTU squatting on a legacy id
//    is counted as a conflict, never overwritten.
//  - Legacy edge relTypes are free-form strings; S1's strict type
//    charset would refuse some of them. putEdge tries the strict
//    writer first and falls back to writing the identical record
//    shape directly for a legacy-style type (non-empty, ≤64 chars).
//    Behaviour preservation beats charset purity for user data that
//    already exists; new substrate-native callers keep the strict
//    path.

import { addRelation, removeRelation, relationsOf } from "./dtu-relations.js";

export const ENTITY_NODE_KIND = "entity-node";
export const ENTITY_SCHEMA_KIND = "entity-schema";
export const MIGRATION_SOURCE = "migration:entity-graph";

const dtusOf = (state) => state?.dtus || null;
const authoredBy = (dtu, userId) =>
  (dtu.author || dtu.ownerId || dtu.userId || dtu.createdBy) === userId;
export const isEntityNode = (dtu) => !!dtu && dtu.machine?.kind === ENTITY_NODE_KIND;
export const isEntitySchema = (dtu) => !!dtu && dtu.machine?.kind === ENTITY_SCHEMA_KIND;

// ── Node views ──────────────────────────────────────────────────────

export function dtuToNode(dtu) {
  const m = dtu.machine || {};
  return {
    id: dtu.id,
    name: dtu.title || "",
    entityType: m.entityType || "generic",
    attributes: m.attributes || {},
    wikidataId: m.wikidataId ?? null,
    createdAt: dtu.createdAt ?? null,
  };
}

export function nodeToDtu(node, userId) {
  return {
    id: node.id,
    title: node.name,
    tier: "personal",
    privacy: "private",
    scope: "user",
    author: userId,
    tags: [],
    machine: {
      kind: ENTITY_NODE_KIND,
      entityType: node.entityType || "generic",
      attributes: node.attributes || {},
      wikidataId: node.wikidataId ?? null,
    },
    createdAt: node.createdAt ?? Date.now(),
    relations: [],
  };
}

export function listNodes(state, userId) {
  const dtus = dtusOf(state);
  if (!dtus) return [];
  const out = [];
  for (const dtu of dtus.values()) {
    if (isEntityNode(dtu) && authoredBy(dtu, userId)) out.push(dtuToNode(dtu));
  }
  return out;
}

export function getNodeDtu(state, userId, id) {
  const dtus = dtusOf(state);
  const dtu = dtus?.get?.(id);
  return isEntityNode(dtu) && authoredBy(dtu, userId) ? dtu : null;
}

export function getNode(state, userId, id) {
  const dtu = getNodeDtu(state, userId, id);
  return dtu ? dtuToNode(dtu) : null;
}

/** Create or replace a node on the substrate. Preserves the DTU's
 *  existing relations (edges live there, not in the node view). */
export function putNode(state, userId, node) {
  const dtus = dtusOf(state);
  if (!dtus) return null;
  const existing = dtus.get(node.id);
  const fresh = nodeToDtu(node, userId);
  if (isEntityNode(existing)) fresh.relations = existing.relations || [];
  dtus.set(node.id, fresh);
  return dtuToNode(fresh);
}

/** Delete a node DTU and scrub relations pointing at it from the
 *  owner's other entity DTUs. Returns the incident-edge count. */
export function deleteNode(state, userId, id) {
  const dtus = dtusOf(state);
  if (!dtus || !getNodeDtu(state, userId, id)) return { deleted: false, edgesRemoved: 0 };
  let edgesRemoved = 0;
  for (const dtu of dtus.values()) {
    if (!isEntityNode(dtu) || !authoredBy(dtu, userId) || dtu.id === id) continue;
    const before = relationsOf(dtu).length;
    dtu.relations = relationsOf(dtu).filter((r) => r.to !== id);
    if (dtu.relations.length !== before) {
      edgesRemoved += before - dtu.relations.length;
      dtus.set(dtu.id, dtu);
    }
  }
  edgesRemoved += relationsOf(dtus.get(id)).length;
  dtus.delete(id);
  return { deleted: true, edgesRemoved };
}

// ── Edge views (relations on the owner's entity DTUs) ──────────────

export const edgeId = (from, to, relType) => `${from}->${to}#${relType}`;

export function listEdges(state, userId) {
  const dtus = dtusOf(state);
  if (!dtus) return [];
  const out = [];
  for (const dtu of dtus.values()) {
    if (!isEntityNode(dtu) || !authoredBy(dtu, userId)) continue;
    for (const r of relationsOf(dtu)) {
      out.push({
        id: edgeId(dtu.id, r.to, r.type),
        from: dtu.id,
        to: r.to,
        relType: r.type,
        weight: r.attributes?.weight ?? 1,
        createdAt: r.at ?? null,
      });
    }
  }
  return out;
}

/** Write an edge. Returns { ok } or { ok:false, error } — validation
 *  of endpoints is the caller's (macro's) job, as in the legacy code. */
export function putEdge(state, userId, { from, to, relType, weight = 1, at, source = "workbench" }) {
  const dtu = getNodeDtu(state, userId, from);
  if (!dtu) return { ok: false, error: "from node not found" };
  const r = addRelation(dtu, {
    to, type: relType, attributes: { weight }, source, at,
  });
  if (!r.ok) {
    if (r.error !== "relation_type_invalid" || typeof relType !== "string" || !relType.trim() || relType.length > 64) {
      return r;
    }
    // Legacy free-form relType: write the identical record shape
    // directly (replace-per-pair semantics preserved).
    if (!Array.isArray(dtu.relations)) dtu.relations = [];
    const rel = { to, type: relType, attributes: { weight }, source, at: Number.isFinite(at) ? at : Date.now() };
    const idx = dtu.relations.findIndex((x) => x && x.to === to && x.type === relType);
    if (idx >= 0) dtu.relations[idx] = rel; else dtu.relations.push(rel);
  }
  state.dtus.set(from, dtu);
  return { ok: true, edge: { id: edgeId(from, to, relType), from, to, relType, weight, createdAt: at ?? Date.now() } };
}

/** Delete an edge by its view id (found by exact match over the
 *  owner's edges — no id parsing, so any legacy relType survives). */
export function deleteEdge(state, userId, id) {
  const edge = listEdges(state, userId).find((e) => e.id === id);
  if (!edge) return { ok: false, error: "edge not found" };
  const dtu = getNodeDtu(state, userId, edge.from);
  removeRelation(dtu, edge.to, edge.relType);
  state.dtus.set(edge.from, dtu);
  return { ok: true, deleted: id };
}

// ── Schema views ────────────────────────────────────────────────────

export function dtuToSchema(dtu) {
  const m = dtu.machine || {};
  const view = {
    id: dtu.id,
    className: m.className || "",
    attributes: m.attributes || [],
    createdAt: dtu.createdAt ?? null,
  };
  if (m.updatedAt != null) view.updatedAt = m.updatedAt;
  return view;
}

export function listSchemas(state, userId) {
  const dtus = dtusOf(state);
  if (!dtus) return [];
  const out = [];
  for (const dtu of dtus.values()) {
    if (isEntitySchema(dtu) && authoredBy(dtu, userId)) out.push(dtuToSchema(dtu));
  }
  return out;
}

export function putSchema(state, userId, schema) {
  const dtus = dtusOf(state);
  if (!dtus) return null;
  const existing = dtus.get(schema.id);
  const dtu = {
    id: schema.id,
    title: `Entity schema: ${schema.className}`,
    tier: "personal",
    privacy: "private",
    scope: "user",
    author: userId,
    tags: [],
    machine: {
      kind: ENTITY_SCHEMA_KIND,
      className: schema.className,
      attributes: schema.attributes || [],
      ...(schema.updatedAt != null ? { updatedAt: schema.updatedAt } : {}),
    },
    createdAt: schema.createdAt ?? (isEntitySchema(existing) ? existing.createdAt : Date.now()),
    relations: isEntitySchema(existing) ? (existing.relations || []) : [],
  };
  dtus.set(schema.id, dtu);
  return dtuToSchema(dtu);
}

export function deleteSchema(state, userId, id) {
  const dtus = dtusOf(state);
  const dtu = dtus?.get?.(id);
  if (!isEntitySchema(dtu) || !authoredBy(dtu, userId)) return false;
  dtus.delete(id);
  return true;
}

// ── Legacy migration ────────────────────────────────────────────────

function migrationLog(state) {
  const g = state.entityGraph;
  if (!g || typeof g !== "object") return null;
  if (!g.migrations || typeof g.migrations !== "object" || Array.isArray(g.migrations)) {
    g.migrations = {};
  }
  return g.migrations;
}

export function migrationReceipt(state, userId) {
  return migrationLog(state)?.[userId] || null;
}

/**
 * Move one user's legacy entityGraph data onto the substrate.
 * Idempotent — safe to call on every workbench access; after the
 * first completed run it is a receipt read. Legacy arrays are left
 * frozen in place (readable, uncounted). Returns the receipt:
 * { userId, at, nodes, edges, schemas, conflicts:[ids] }.
 */
export function migrateUser(state, userId) {
  const dtus = dtusOf(state);
  const log = migrationLog(state);
  if (!dtus || !log) return null;
  if (log[userId]) return log[userId];
  const g = state.entityGraph;
  const legacyNodes = g.nodes instanceof Map ? (g.nodes.get(userId) || []) : [];
  const legacyEdges = g.edges instanceof Map ? (g.edges.get(userId) || []) : [];
  const legacySchemas = g.schemas instanceof Map ? (g.schemas.get(userId) || []) : [];
  const receipt = {
    userId, at: Date.now(),
    nodes: 0, edges: 0, schemas: 0, conflicts: [],
  };
  const migratedIds = new Set();
  for (const node of legacyNodes) {
    const existing = dtus.get(node.id);
    if (isEntityNode(existing) && authoredBy(existing, userId)) { migratedIds.add(node.id); continue; }
    if (existing) { receipt.conflicts.push(node.id); continue; }
    dtus.set(node.id, nodeToDtu(node, userId));
    migratedIds.add(node.id);
    receipt.nodes++;
  }
  for (const schema of legacySchemas) {
    const existing = dtus.get(schema.id);
    if (isEntitySchema(existing) && authoredBy(existing, userId)) continue;
    if (existing) { receipt.conflicts.push(schema.id); continue; }
    putSchema(state, userId, schema);
    receipt.schemas++;
  }
  for (const edge of legacyEdges) {
    if (!migratedIds.has(edge.from) || !migratedIds.has(edge.to)) continue;
    const r = putEdge(state, userId, {
      from: edge.from, to: edge.to, relType: edge.relType,
      weight: edge.weight ?? 1, at: edge.createdAt, source: MIGRATION_SOURCE,
    });
    if (r.ok) receipt.edges++;
  }
  log[userId] = receipt;
  return receipt;
}
