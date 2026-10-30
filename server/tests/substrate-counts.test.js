// #1715 S4 — one counting source.
//
// Pins: every Graph-workspace count derives from
// lib/substrate-counts.js over the canonical store; field names say
// which universe they count; the workbench block equals the
// adapter's own list lengths (substrate truth, not a second count);
// another user's records never inflate the caller's scoped counts;
// the index block reports the projection under its own name.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { substrateCounts } from "../lib/substrate-counts.js";
import { putNode, putEdge, putSchema } from "../lib/entity-substrate.js";
import registerGraphActions from "../domains/graph.js";

const actions = new Map();
registerGraphActions((domain, name, fn) => actions.set(`${domain}/${name}`, fn));
const call = (name, userId, params = {}) =>
  actions.get(`graph/${name}`)({ actor: { userId }, userId }, {}, params);

let STATE;
beforeEach(() => {
  STATE = { dtus: new Map(), graphLens: { maps: new Map() } };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
});

function seed() {
  // Caller's workbench: 2 nodes, 1 edge, 1 schema (substrate DTUs).
  putNode(STATE, "u1", { id: "n1", name: "Alpha", entityType: "person", attributes: {}, createdAt: 1, updatedAt: 1 });
  putNode(STATE, "u1", { id: "n2", name: "Beta", entityType: "org", attributes: {}, createdAt: 1, updatedAt: 1 });
  putEdge(STATE, "u1", { from: "n1", to: "n2", relType: "knows", at: 2 });
  putSchema(STATE, "u1", { id: "s1", name: "Person", fields: [], createdAt: 1 });
  // A plain DTU of the caller's and one of someone else's.
  STATE.dtus.set("d1", { id: "d1", title: "Mine", author: "u1", relations: [{ to: "d2", type: "cites", source: "manual", at: 1 }] });
  STATE.dtus.set("d2", { id: "d2", title: "Theirs", author: "u2", relations: [{ to: "d1", type: "cites", source: "manual", at: 1 }] });
}

describe("S4 substrate counts", () => {
  it("counts each universe under its own name", () => {
    seed();
    const c = substrateCounts(STATE, "u1");
    assert.equal(c.source, "dtu-substrate");
    assert.equal(c.dtusTotal, 5); // 2 nodes + 1 schema + d1 + d2 (the edge lives as a relation, not a DTU)
    assert.equal(c.dtusAuthoredByUser, 4); // n1, n2, s1, d1
    assert.equal(c.workbench.nodes, 2);
    assert.equal(c.workbench.edges, 1);
    assert.equal(c.workbench.schemas, 1);
    assert.equal(c.entityDtusTotal, 2);
    assert.equal(c.schemaDtusTotal, 1);
    assert.equal(c.relationsTotal, 3); // workbench edge + d1->d2 + d2->d1
    assert.equal(c.relationsOnUserDtus, 2); // the edge (on n1) + d1's citation
  });

  it("another user's records never enter the caller's scoped counts", () => {
    seed();
    const c2 = substrateCounts(STATE, "u2");
    assert.equal(c2.dtusTotal, 5, "the substrate total is global truth");
    assert.equal(c2.dtusAuthoredByUser, 1);
    assert.equal(c2.workbench.nodes, 0);
    assert.equal(c2.relationsOnUserDtus, 1);
  });

  it("the index block reports the projection under its own name, never as substrate truth", () => {
    seed();
    const index = { nodes: new Map([["a", 1], ["b", 1], ["tag:x", 1]]), edges: new Map([["e", 1]]) };
    const c = substrateCounts(STATE, "u1", { index, indexVisibleNodes: 2 });
    assert.equal(c.index.source, "graph-index");
    assert.equal(c.index.nodes, 3);
    assert.equal(c.index.edges, 1);
    assert.equal(c.index.nodesVisibleToCaller, 2);
    assert.equal(c.dtusTotal, 5, "substrate total unaffected by the projection");
  });

  it("map backings count from the substrate after convergence", () => {
    call("map-create", "u1", { title: "M" });
    const c = substrateCounts(STATE, "u1");
    assert.equal(c.mapBackings.dtus, 1, "the central node's backing DTU");
    call("node-add", "u1", { mapId: call("graph-dashboard", "u1").result.counts && STATE.graphLens.maps.get("u1")[0].id, label: "Kid", parentId: STATE.graphLens.maps.get("u1")[0].nodes[0].id });
    const c2 = substrateCounts(STATE, "u1");
    assert.equal(c2.mapBackings.dtus, 2);
    assert.equal(c2.mapBackings.relations, 1);
  });

  it("graph-dashboard surfaces the single source alongside its maps-only legacy fields", () => {
    seed();
    call("map-create", "u1", { title: "M" });
    const r = call("graph-dashboard", "u1").result;
    assert.equal(r.source, "user-maps");
    assert.equal(r.maps, 1);
    assert.equal(r.totalNodes, 1, "legacy field still counts MAP nodes only");
    assert.equal(r.counts.source, "dtu-substrate");
    assert.equal(r.counts.workbench.nodes, 2, "the counts block is the substrate truth");
    assert.equal(r.counts.dtusTotal, 6); // seed's 5 + the map's central backing DTU
  });

  it("an empty substrate counts as zeros, not an error", () => {
    const c = substrateCounts(STATE, "u1");
    assert.equal(c.dtusTotal, 0);
    assert.equal(c.workbench.nodes, 0);
    assert.equal(c.index, null);
  });
});
