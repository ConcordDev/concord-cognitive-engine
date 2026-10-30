// server/lib/map-convergence.js
//
// #1715 S3 — Maps convergence. A map stays what it is: a VIEW
// definition (membership, layout, per-map state) in
// STATE.graphLens.maps. What converges is identity and relations:
//
//   - Every map node resolves to a DTU. A node the user linked
//     (node.dtuId, via link-node-dtu) stands as-is. A standalone
//     authored node gets a backing DTU minted for it —
//     machine.kind "map-node", owner-scoped (privacy "private",
//     scope "user", author = the user) — and the minted id is
//     stamped onto node.dtuId, the same field link-node-dtu uses.
//     The node's label/notes are the backing DTU's title/content.
//   - Every map edge exists on the substrate as a typed relation
//     (S1) on the from-node's DTU: type is the edge label slugified
//     ("map-link" when the label is empty or unusable), attributes
//     carry { mapIds: [...], label } and source is "map". One
//     relation can be asserted by several maps (same pair + type);
//     mapIds records which maps assert it.
//
// Convergence is a RECONCILE, run lazily from the graph macros that
// read or mutate a user's maps: the desired relation set is derived
// from the maps as they stand, and map-sourced relations on the
// user's map-node DTUs are made to match it exactly. That makes the
// substrate relation set a pure function of the views — missed or
// partial write paths self-heal on the next touch, and deleting a
// map (or a node, or an edge) prunes exactly its relations.
//
// Deliberate boundaries, stated once:
//   - Backing DTUs are never deleted by map operations. A substrate
//     object outlives the view element that minted it (it may have
//     been linked elsewhere since); node deletion removes the view
//     element and its map relations, not the DTU.
//   - Relations NOT sourced "map" (workbench edges, manual writes)
//     are never touched by the reconcile.
//   - Map membership/layout fields (positions, trash where present,
//     mergedFrom, central) remain map-local — they are view state.

import { addRelation, removeRelation, relationsOf } from "./dtu-relations.js";

export const MAP_NODE_KIND = "map-node";
export const MAP_RELATION_SOURCE = "map";
const DEFAULT_RELATION_TYPE = "map-link";

const authoredBy = (dtu, userId) =>
  (dtu.author || dtu.ownerId || dtu.userId || dtu.createdBy) === userId;
export const isMapNodeDtu = (dtu) => !!dtu && dtu.machine?.kind === MAP_NODE_KIND;

/** A map edge label → a valid S1 relation type (or the default). */
export function relationTypeForLabel(label) {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return /^[a-z][a-z0-9_-]*$/.test(slug) ? slug : DEFAULT_RELATION_TYPE;
}

function backingDtuFor(state, userId, map, node, mintId) {
  const dtus = state.dtus;
  if (node.dtuId) {
    const existing = dtus.get(node.dtuId);
    if (existing) return existing;
  }
  const dtu = {
    id: mintId(),
    title: node.label || "",
    content: node.notes || "",
    tier: "personal",
    privacy: "private",
    scope: "user",
    author: userId,
    tags: [],
    machine: { kind: MAP_NODE_KIND, mapId: map.id, nodeId: node.id },
    createdAt: new Date().toISOString(),
    relations: [],
  };
  dtus.set(dtu.id, dtu);
  node.dtuId = dtu.id;
  return dtu;
}

/**
 * Converge one user's maps onto the substrate.
 * @param {object} state — the global STATE (dtus + graphLens.maps)
 * @param {string} userId
 * @param {() => string} mintId — id generator for backing DTUs
 * @returns {{ backedNodes:number, relationsWritten:number, relationsPruned:number }}
 */
export function convergeUserMaps(state, userId, mintId) {
  const out = { backedNodes: 0, relationsWritten: 0, relationsPruned: 0 };
  const dtus = state?.dtus;
  const maps = state?.graphLens?.maps instanceof Map
    ? (state.graphLens.maps.get(userId) || [])
    : [];
  if (!dtus || typeof dtus.get !== "function") return out;

  // (a) Backing: every node in every map resolves to a DTU, and the
  // backing DTU carries the node's current label/notes.
  for (const map of maps) {
    for (const node of map.nodes || []) {
      const before = node.dtuId;
      const dtu = backingDtuFor(state, userId, map, node, mintId);
      if (!before) out.backedNodes++;
      if (isMapNodeDtu(dtu) && authoredBy(dtu, userId)) {
        if (dtu.title !== (node.label || "")) dtu.title = node.label || "";
        const notes = node.notes || "";
        if ((dtu.content || "") !== notes) dtu.content = notes;
        dtus.set(dtu.id, dtu);
      }
    }
  }

  // (b) Desired relation set from the maps as they stand.
  // key: `${fromDtuId}->${toDtuId}#${type}`
  const desired = new Map();
  const nodeDtu = (map, nodeId) => (map.nodes || []).find((n) => n.id === nodeId)?.dtuId || null;
  for (const map of maps) {
    for (const edge of map.edges || []) {
      const from = nodeDtu(map, edge.from);
      const to = nodeDtu(map, edge.to);
      if (!from || !to || from === to) continue;
      const type = relationTypeForLabel(edge.label);
      const key = `${from}->${to}#${type}`;
      if (!desired.has(key)) {
        desired.set(key, { from, to, type, label: edge.label || "", mapIds: new Set() });
      }
      desired.get(key).mapIds.add(map.id);
    }
  }

  // (c) Prune/refresh the map-sourced relations this user governs:
  // those on their own map-node DTUs, and those whose asserting maps
  // (attributes.mapIds) all belong to this user — a relation may sit
  // on a real DTU the user linked into a map, and it is still theirs
  // to retract when the map changes. Other users' map relations and
  // non-map relations are never touched.
  const otherMapIds = new Set();
  if (state.graphLens?.maps instanceof Map) {
    for (const [otherUser, theirMaps] of state.graphLens.maps.entries()) {
      if (otherUser === userId) continue;
      for (const m of theirMaps || []) otherMapIds.add(m.id);
    }
  }
  for (const dtu of dtus.values()) {
    let dirty = false;
    for (const r of [...relationsOf(dtu)]) {
      if (r.source !== MAP_RELATION_SOURCE) continue;
      const assertedBy = r.attributes?.mapIds || [];
      // Governed when the asserting maps are this user's — or no
      // longer exist at all (a deleted map's relations are its
      // owner's to retract; map ids are unique, so a vanished id
      // cannot be another user's live map).
      const governed =
        (isMapNodeDtu(dtu) && authoredBy(dtu, userId)) ||
        (assertedBy.length > 0 && assertedBy.every((id) => !otherMapIds.has(id)));
      if (!governed) continue;
      const key = `${dtu.id}->${r.to}#${r.type}`;
      const want = desired.get(key);
      if (!want) {
        removeRelation(dtu, r.to, r.type);
        out.relationsPruned++;
        dirty = true;
      } else {
        const have = new Set(assertedBy);
        const sameMaps = have.size === want.mapIds.size && [...want.mapIds].every((m) => have.has(m));
        if (!sameMaps || (r.attributes?.label || "") !== want.label) {
          r.attributes = { ...(r.attributes || {}), mapIds: [...want.mapIds], label: want.label };
          dirty = true;
        }
        desired.delete(key);
      }
    }
    if (dirty) dtus.set(dtu.id, dtu);
  }

  // (d) Write the desired relations not already standing.
  for (const want of desired.values()) {
    const dtu = dtus.get(want.from);
    if (!dtu) continue;
    const r = addRelation(dtu, {
      to: want.to,
      type: want.type,
      attributes: { mapIds: [...want.mapIds], label: want.label },
      source: MAP_RELATION_SOURCE,
    });
    if (r.ok) {
      dtus.set(want.from, dtu);
      out.relationsWritten++;
    }
  }
  return out;
}
