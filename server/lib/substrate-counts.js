// server/lib/substrate-counts.js
//
// #1715 S4 — ONE counting source for the Graph workspace.
//
// The F7 contradiction class: surfaces returned identically-named
// counts (totalNodes / totalEdges) computed over different universes
// — graph.stats counted the global GRAPH_INDEX projection (DTUs +
// synthetic tag nodes, lineage + relation edges), graph-dashboard
// counted only the caller's maps, and the workbench counted its own
// legacy arrays — so the header, the dashboard, and the panels could
// never agree and none of them said what it was counting.
//
// Every Graph-workspace count now derives here, from the canonical
// store (STATE.dtus) and its named projections, and every field name
// says which universe it counts. Consumers keep their legacy fields
// for compatibility and ADD these source-named ones; new surfaces
// should use only these.

import { listNodes, listEdges, listSchemas, isEntityNode, isEntitySchema } from "./entity-substrate.js";
import { relationsOf } from "./dtu-relations.js";

function authoredBy(dtu, userId) {
  return dtu?.author === userId || dtu?.ownerId === userId || dtu?.userId === userId || dtu?.createdBy === userId;
}

function isMapNodeDtu(dtu) {
  return dtu?.machine?.kind === "map-node";
}

/**
 * Count the substrate once, for one caller.
 * state: the server STATE (needs .dtus).
 * userId: the caller whose scoped counts are included.
 * opts.index: a GRAPH_INDEX-shaped { nodes: Map, edges: Map } to
 *   report the projection's counts under their own names (the index
 *   is a projection of the substrate, never the source of truth).
 * opts.indexVisibleNodes: precomputed count of index nodes visible
 *   to the caller (visibility is the projection layer's business).
 */
export function substrateCounts(state, userId, opts = {}) {
  const dtus = state?.dtus;
  const out = {
    source: "dtu-substrate",
    dtusTotal: 0,
    dtusAuthoredByUser: 0,
    relationsTotal: 0,
    relationsOnUserDtus: 0,
    workbench: { source: "dtu-substrate", nodes: 0, edges: 0, schemas: 0 },
    mapBackings: { source: "dtu-substrate", dtus: 0, relations: 0 },
    entityDtusTotal: 0,
    schemaDtusTotal: 0,
    index: null,
  };
  if (!dtus || typeof dtus.values !== "function") return out;

  for (const dtu of dtus.values()) {
    out.dtusTotal++;
    const mine = userId ? authoredBy(dtu, userId) : false;
    if (mine) out.dtusAuthoredByUser++;
    const rels = relationsOf(dtu);
    out.relationsTotal += rels.length;
    if (mine) {
      out.relationsOnUserDtus += rels.length;
      if (isMapNodeDtu(dtu)) {
        out.mapBackings.dtus++;
        out.mapBackings.relations += rels.filter((r) => r.source === "map").length;
      }
    }
    if (isEntityNode(dtu)) out.entityDtusTotal++;
    if (isEntitySchema(dtu)) out.schemaDtusTotal++;
  }

  if (userId) {
    out.workbench.nodes = listNodes(state, userId).length;
    out.workbench.edges = listEdges(state, userId).length;
    out.workbench.schemas = listSchemas(state, userId).length;
  }

  if (opts.index) {
    out.index = {
      source: "graph-index",
      nodes: opts.index.nodes?.size || 0,
      edges: opts.index.edges?.size || 0,
      ...(typeof opts.indexVisibleNodes === "number" ? { nodesVisibleToCaller: opts.indexVisibleNodes } : {}),
    };
  }
  return out;
}
