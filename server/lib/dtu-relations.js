// server/lib/dtu-relations.js
//
// Typed relations on DTU records (#1715 S1 — the convergence's
// substrate extension). A DTU's relations are record metadata, a
// sibling of `lineage`: they live OUTSIDE the integrity-hashed
// content layers (dtu-integrity.js hashes content/summary/layers/
// metadata/tags), exactly as lineage does, so adding or removing a
// relation never invalidates a DTU's provenance hash.
//
// Shape: dtu.relations = [{ to, type, attributes?, source, at }]
//   to         — the target DTU's id (dangling targets are tolerated
//                by readers, as dangling lineage ids are today).
//   type       — a short relation kind ("cites", "part-of", a
//                workbench edge type, ...). Free-form within a
//                conservative charset; visibility and meaning belong
//                to the surfaces, identity belongs here.
//   attributes — optional plain object (the workbench's per-edge
//                data rides here; per-attribute provenance stamps
//                keep their { value, source, at } shape inside it).
//   source     — who/what wrote the relation ("manual", "workbench",
//                "map:<mapId>", "migration:entity-graph", ...).
//   at         — write timestamp (ms epoch).
//
// One relation per (to, type) pair per DTU: re-adding the same pair
// replaces its attributes/source/at instead of stacking duplicates —
// the pair IS the edge's identity (the GRAPH_INDEX projection keys
// relation edges `${id}->${to}#${type}` for the same reason, so a
// typed edge never overwrites a lineage edge between the same pair).

export const RELATION_TYPE_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

function fail(error) {
  return { ok: false, error };
}

/** Normalised read: always an array of well-formed relation records. */
export function relationsOf(dtu) {
  if (!dtu || !Array.isArray(dtu.relations)) return [];
  return dtu.relations.filter(
    (r) => r && typeof r.to === "string" && r.to && typeof r.type === "string" && r.type,
  );
}

/**
 * Add (or replace) a typed relation on a DTU record, in place.
 * @returns {{ok:true, relation:object, replaced:boolean} | {ok:false, error:string}}
 */
export function addRelation(dtu, input = {}) {
  if (!dtu || typeof dtu !== "object") return fail("dtu_required");
  if (!dtu.id) return fail("dtu_id_required");
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!to) return fail("relation_target_required");
  if (to === dtu.id) return fail("relation_self");
  const type = typeof input.type === "string" ? input.type.trim() : "";
  if (!RELATION_TYPE_RE.test(type)) return fail("relation_type_invalid");
  const attributes =
    input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes)
      ? { ...input.attributes }
      : undefined;
  const relation = {
    to,
    type,
    ...(attributes ? { attributes } : {}),
    source: typeof input.source === "string" && input.source ? input.source : "manual",
    at: Number.isFinite(input.at) ? input.at : Date.now(),
  };
  if (!Array.isArray(dtu.relations)) dtu.relations = [];
  const existing = dtu.relations.findIndex((r) => r && r.to === to && r.type === type);
  if (existing >= 0) {
    dtu.relations[existing] = relation;
    return { ok: true, relation, replaced: true };
  }
  dtu.relations.push(relation);
  return { ok: true, relation, replaced: false };
}

/** Remove a typed relation. Returns whether anything was removed. */
export function removeRelation(dtu, to, type) {
  if (!dtu || !Array.isArray(dtu.relations)) return { ok: true, removed: false };
  const before = dtu.relations.length;
  dtu.relations = dtu.relations.filter((r) => !(r && r.to === to && r.type === type));
  return { ok: true, removed: dtu.relations.length !== before };
}

/**
 * The GRAPH_INDEX edges this DTU's relations project to. The index
 * builder (server.js rebuildGraphIndex) writes exactly these, keyed
 * by edge.id — the `#${type}` suffix keeps a typed edge distinct
 * from a lineage edge between the same pair. Visibility filtering
 * stays the index readers' job (_graphVisibleEdge checks both
 * endpoints, relations included).
 */
export function relationEdges(dtu) {
  if (!dtu || !dtu.id) return [];
  return relationsOf(dtu).map((r) => ({
    id: `${dtu.id}->${r.to}#${r.type}`,
    source: dtu.id,
    target: r.to,
    type: r.type,
    relation: true,
  }));
}
