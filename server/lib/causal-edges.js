// server/lib/causal-edges.js
//
// DW1 — DTU causal-edge layer (Pearl-style causal DAG typing).
//
// Concord's citation graph (server/economy/royalty-cascade.js + the
// `royalty_lineage` table, migration 008) is unlabeled and uncausal: a
// citation just means "B referenced A", carrying no claim about WHY. This
// module adds a SEPARATE, additive layer — `dtu_causal_edges` (migration 352)
// — that types the relationship between two DTUs along Judea Pearl's causal
// vocabulary: causes / enables / prevents / corrects / analogizes.
//
// CONSTITUTIONAL BOUNDARY: this file must NEVER import from
// server/economy/**, touch `royalty_lineage`, touch `dtu_citations`, or
// influence any marketplace-fee constant. A causal edge carries zero
// royalty/citation meaning by construction — it is a pure reasoning-layer
// annotation on top of the substrate, not a money-shaped relationship.
//
// ── Edge directionality ────────────────────────────────────────────────────
// Each row means: `parent_id` CAUSALLY PRODUCES `child_id` via `edge_type`.
//   parent_id --[edge_type]--> child_id
// e.g. "drought (parent) `causes` crop_failure (child)",
//      "vaccine_research (parent) `enables` herd_immunity (child)",
//      "chosen name calling this "child"/"parent" mirrors the existing
//      lattice-fork / royalty_lineage naming convention (child = the newer/
//      downstream artifact, parent = the earlier/upstream one) even though
//      causal edges are a separate table from both.
//
// ── Cycle-handling decision (documented per DW1 spec) ──────────────────────
// Pearl's causal-DAG formalism assumes acyclicity so that do-calculus and
// counterfactual reasoning stay well-defined. Concord's actual domains
// (ecology, economy, social systems) frequently contain GENUINE feedback
// loops — "A enables B, B causes C, C prevents A" is a real, useful causal
// claim (e.g. a subsidy enables overproduction, overproduction causes a
// price crash, the price crash prevents further subsidy). Rejecting such an
// edge at write time (the way citation edges reject self-reference) would
// throw away real domain knowledge for the sake of a formalism Concord
// doesn't actually need at the storage layer — nothing here runs Pearl-style
// do-calculus over the raw graph. So: addCausalEdge does NOT reject an edge
// that would close a cycle. What's actually load-bearing is that ANY
// traversal over this graph terminates safely — traceCausalPath below uses a
// visited-set BFS specifically so a cyclic graph can never spin it forever,
// independent of the "cycles are legitimate" content decision.

import crypto from "node:crypto";

export const CAUSAL_EDGE_TYPES = Object.freeze([
  "causes",
  "enables",
  "prevents",
  "corrects",
  "analogizes",
]);

function tableExists(db, table) {
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
  } catch {
    return false;
  }
}

// ── create ──────────────────────────────────────────────────────────────────

/**
 * Add a causal edge between two DTUs.
 *
 * Validates `edgeType` against the same enum the DB's CHECK constraint
 * enforces — checked here in JS too, rather than relying on the DB to catch
 * a bad value, so a caller gets a clear, typed error instead of a raw SQLite
 * constraint-violation exception.
 *
 * @param {object} db
 * @param {object} o
 * @param {string} o.childId   — the downstream/effect DTU id.
 * @param {string} o.parentId  — the upstream/cause DTU id.
 * @param {string} o.edgeType  — one of CAUSAL_EDGE_TYPES.
 * @param {number} [o.confidence=0.5] — [0,1].
 * @returns {{id:string, childId:string, parentId:string, edgeType:string,
 *            confidence:number, createdAt:number}}
 * @throws  {Error} with `.code` set — 'missing_child_id' | 'missing_parent_id' |
 *          'invalid_edge_type' | 'invalid_confidence'.
 */
export function addCausalEdge(db, { childId, parentId, edgeType, confidence = 0.5 } = {}) {
  if (!db) throw new Error("addCausalEdge: db required");

  if (!childId) {
    const e = new Error("addCausalEdge: childId required");
    e.code = "missing_child_id";
    throw e;
  }
  if (!parentId) {
    const e = new Error("addCausalEdge: parentId required");
    e.code = "missing_parent_id";
    throw e;
  }
  if (!CAUSAL_EDGE_TYPES.includes(edgeType)) {
    const e = new Error(
      `addCausalEdge: edgeType must be one of ${CAUSAL_EDGE_TYPES.join(", ")} (got ${JSON.stringify(edgeType)})`,
    );
    e.code = "invalid_edge_type";
    throw e;
  }
  const conf = confidence === undefined ? 0.5 : Number(confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    const e = new Error(`addCausalEdge: confidence must be a number within [0,1] (got ${JSON.stringify(confidence)})`);
    e.code = "invalid_confidence";
    throw e;
  }

  // Same id-generation convention as lib/lattice-fork.js (`fork_${...}`) —
  // a short random-hex suffix behind a domain prefix.
  const id = `cedge_${crypto.randomBytes(9).toString("hex")}`;
  const createdAt = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO dtu_causal_edges (id, child_id, parent_id, edge_type, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, String(childId), String(parentId), edgeType, conf, createdAt);

  return {
    id,
    childId: String(childId),
    parentId: String(parentId),
    edgeType,
    confidence: conf,
    createdAt,
  };
}

// ── read ────────────────────────────────────────────────────────────────────

/**
 * All causal edges touching `dtuId`, split by role.
 *
 * @param {object} db
 * @param {string} dtuId
 * @returns {{asChild: object[], asParent: object[]}} — `asChild` are edges
 *   where this DTU is the effect (dtuId === child_id); `asParent` are edges
 *   where this DTU is the cause (dtuId === parent_id). Honest-empty (never
 *   throws) when the table is missing or the id is falsy — callers that want
 *   to distinguish "no edges" from "no table" should call tableExists
 *   themselves; this helper is meant to be safe to call unconditionally from
 *   enrichment/best-effort call sites (see emergent/drift-monitor.js).
 */
export function causalEdgesFor(db, dtuId) {
  if (!db || !dtuId || !tableExists(db, "dtu_causal_edges")) {
    return { asChild: [], asParent: [] };
  }
  const id = String(dtuId);
  let asChild = [];
  let asParent = [];
  try {
    asChild = db
      .prepare("SELECT * FROM dtu_causal_edges WHERE child_id = ? ORDER BY created_at ASC")
      .all(id);
  } catch {
    asChild = [];
  }
  try {
    asParent = db
      .prepare("SELECT * FROM dtu_causal_edges WHERE parent_id = ? ORDER BY created_at ASC")
      .all(id);
  } catch {
    asParent = [];
  }
  return { asChild, asParent };
}

/**
 * Is there ANY direct causal edge between `a` and `b`, in either direction?
 * A small convenience built on causalEdgesFor — used by drift-monitor to
 * decide whether a detected contradiction has causal context.
 *
 * @returns {object|null} the edge row if one exists, else null.
 */
export function directCausalEdgeBetween(db, a, b) {
  if (!a || !b) return null;
  const { asChild, asParent } = causalEdgesFor(db, a);
  const bId = String(b);
  return (
    asChild.find((e) => e.parent_id === bId) ||
    asParent.find((e) => e.child_id === bId) ||
    null
  );
}

// ── trace ───────────────────────────────────────────────────────────────────

/**
 * BFS a causal path from `fromId` to `toId` walking parent_id -> child_id
 * edges FORWARD (cause -> effect), i.e. "does fromId's causal influence
 * eventually reach toId, and by what chain?" — the natural reading of
 * "trace the causal path from X to Y".
 *
 * Terminates safely regardless of the cycle-handling decision above: a
 * visited-node set guarantees each DTU id is expanded at most once, so even
 * a graph containing genuine causal cycles (A enables B, B causes C, C
 * prevents A) cannot loop the BFS forever. `maxDepth` is a second, redundant
 * bound (hop count) — belt-and-suspenders, not the only thing preventing an
 * infinite loop.
 *
 * @param {object} db
 * @param {string} fromId
 * @param {string} toId
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=10]
 * @returns {object[]|null} the ordered edge-row chain (parent_id===fromId's
 *   frontier ... child_id===toId) if a path exists within maxDepth hops,
 *   `[]` if fromId === toId (trivial path), or `null` if unreachable.
 */
export function traceCausalPath(db, fromId, toId, { maxDepth = 10 } = {}) {
  if (!db || !fromId || !toId || !tableExists(db, "dtu_causal_edges")) return null;
  const from = String(fromId);
  const to = String(toId);
  if (from === to) return [];

  const visited = new Set([from]);
  let frontier = [{ nodeId: from, path: [] }];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier = [];
    for (const { nodeId, path } of frontier) {
      let outgoing = [];
      try {
        outgoing = db.prepare("SELECT * FROM dtu_causal_edges WHERE parent_id = ?").all(nodeId);
      } catch {
        outgoing = [];
      }
      for (const edge of outgoing) {
        if (edge.child_id === to) {
          return [...path, edge];
        }
        if (!visited.has(edge.child_id)) {
          visited.add(edge.child_id);
          nextFrontier.push({ nodeId: edge.child_id, path: [...path, edge] });
        }
      }
    }
    frontier = nextFrontier;
    depth++;
  }
  return null;
}
