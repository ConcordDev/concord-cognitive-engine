// #1715 S2 — the entity workbench on the canonical DTU store.
//
// Two pin families: (1) the legacy workbench behaviour, unchanged —
// same macros, same result shapes, same refusals; (2) the substrate
// end-state — nodes are owner-scoped entity DTUs, edges are typed
// relations on them, schemas are entity-schema DTUs, and legacy
// STATE.entityGraph data migrates on first access, idempotently,
// with a reconciling receipt, its arrays left frozen.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEntityActions from "../domains/entity.js";

const actions = new Map();
registerEntityActions((domain, name, fn) => actions.set(`${domain}/${name}`, fn));
const call = (name, userId, params = {}) =>
  actions.get(`entity/${name}`)({ actor: { userId }, userId }, {}, params);

let STATE;
function freshState() {
  STATE = {
    dtus: new Map(),
    entityGraph: { nodes: new Map(), edges: new Map(), schemas: new Map() },
  };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}
beforeEach(freshState);

describe("S2 workbench behaviour (shapes unchanged)", () => {
  it("node/edge/schema CRUD round-trips through the macros", () => {
    const a = call("node-create", "u1", { name: "Ada", entityType: "person", attributes: { role: "engineer" } });
    assert.equal(a.ok, true);
    assert.equal(a.result.node.attributes.role.source, "manual");
    const b = call("node-create", "u1", { name: "Concord" });
    const e = call("edge-create", "u1", { from: a.result.node.id, to: b.result.node.id, relType: "works-on", weight: 3 });
    assert.equal(e.ok, true);
    assert.equal(e.result.edge.weight, 3);
    assert.equal(call("edge-create", "u1", { from: a.result.node.id, to: b.result.node.id, relType: "works-on" }).error, "edge already exists");
    assert.equal(call("edge-create", "u1", { from: a.result.node.id, to: a.result.node.id }).error, "self-edge not allowed");
    const g = call("graph-get", "u1", {});
    assert.equal(g.result.nodes.length, 2);
    assert.equal(g.result.edges.length, 1);
    const sc = call("schema-save", "u1", { className: "Person", attributes: [{ name: "role", type: "string", required: true }] });
    assert.equal(sc.ok, true);
    assert.equal(call("schema-list", "u1", {}).result.schemas.length, 1);
    assert.equal(call("schema-delete", "u1", { id: sc.result.schema.id }).ok, true);
    assert.equal(call("schema-delete", "u1", { id: sc.result.schema.id }).error, "schema not found");
  });

  it("node-update stamps provenance; node-delete removes incident edges both directions", () => {
    const a = call("node-create", "u1", { name: "A" }).result.node;
    const b = call("node-create", "u1", { name: "B" }).result.node;
    const c = call("node-create", "u1", { name: "C" }).result.node;
    call("edge-create", "u1", { from: a.id, to: b.id, relType: "r1" });
    call("edge-create", "u1", { from: c.id, to: b.id, relType: "r2" });
    const upd = call("node-update", "u1", { id: a.id, attributeKey: "city", attributeValue: "Poughkeepsie", attributeSource: "profile" });
    assert.equal(upd.result.node.attributes.city.source, "profile");
    const del = call("node-delete", "u1", { id: b.id });
    assert.equal(del.result.edgesRemoved, 2);
    assert.equal(call("graph-get", "u1", {}).result.edges.length, 0);
    assert.equal(call("node-delete", "u1", { id: b.id }).error, "node not found");
  });

  it("merge reconciles attributes and rewires edges; split moves attributes onto a linked node", () => {
    const a = call("node-create", "u1", { name: "A", attributes: { x: 1, y: 2 } }).result.node;
    const b = call("node-create", "u1", { name: "B", attributes: { y: 99, z: 3 } }).result.node;
    const c = call("node-create", "u1", { name: "C" }).result.node;
    call("edge-create", "u1", { from: c.id, to: a.id, relType: "in" });
    call("edge-create", "u1", { from: a.id, to: b.id, relType: "out" });
    const m = call("node-merge", "u1", { sourceId: a.id, targetId: b.id });
    assert.equal(m.ok, true);
    assert.equal(m.result.node.attributes.y.value, 99, "target wins conflicts by default");
    assert.equal(m.result.node.attributes.x.value, 1, "gaps fill from source");
    const g = call("graph-get", "u1", {});
    assert.equal(g.result.nodes.length, 2);
    assert.deepEqual(g.result.edges.map(e => `${e.from === c.id ? "c" : "?"}->${e.to === b.id ? "b" : "?"}`), ["c->b"],
      "the incoming edge rewired onto the target; the a->b edge became a self-edge and dropped");
    const sp = call("node-split", "u1", { id: b.id, splitName: "B-part", attributeKeys: ["x"] });
    assert.equal(sp.ok, true);
    assert.deepEqual(sp.result.attributesMoved, ["x"]);
    assert.equal(sp.result.edge.relType, "split_from");
  });

  it("path-find BFS, wikidata dedupe, bulk import skips, provenance report", () => {
    const a = call("node-create", "u1", { name: "A" }).result.node;
    const b = call("node-create", "u1", { name: "B" }).result.node;
    const c = call("node-create", "u1", { name: "C" }).result.node;
    call("edge-create", "u1", { from: a.id, to: b.id, relType: "ab" });
    call("edge-create", "u1", { from: b.id, to: c.id, relType: "bc" });
    const p = call("path-find", "u1", { from: a.id, to: c.id });
    assert.equal(p.result.found, true);
    assert.equal(p.result.hops, 2);
    assert.equal(call("path-find", "u1", { from: a.id, to: "nope" }).error, "from or to node not found");
    const w1 = call("import-wikidata", "u1", { wikidataId: "Q42", label: "Answer", description: "the answer" });
    assert.equal(w1.ok, true);
    assert.equal(call("import-wikidata", "u1", { wikidataId: "Q42", label: "Again" }).error, "wikidata entity already imported");
    const bulk = call("import-bulk", "u1", { rows: [{ name: "R1", pop: 10 }, { label: "" }, "junk"] });
    assert.equal(bulk.result.createdCount, 1);
    assert.equal(bulk.result.skippedCount, 2);
    const prov = call("provenance-report", "u1", {});
    assert.ok(prov.result.bySource.some(s => s.source === "wikidata"));
  });

  it("users are isolated: B sees none of A's graph and cannot address A's nodes", () => {
    const a = call("node-create", "uA", { name: "A-only" }).result.node;
    assert.equal(call("graph-get", "uB", {}).result.nodes.length, 0);
    assert.equal(call("node-update", "uB", { id: a.id, name: "hijack" }).error, "node not found");
    assert.equal(call("node-delete", "uB", { id: a.id }).error, "node not found");
  });
});

describe("S2 substrate end-state", () => {
  it("nodes land as owner-scoped entity DTUs; edges are relations on them", () => {
    const a = call("node-create", "u1", { name: "Ada" }).result.node;
    const b = call("node-create", "u1", { name: "Bob" }).result.node;
    call("edge-create", "u1", { from: a.id, to: b.id, relType: "knows", weight: 2 });
    const dtu = STATE.dtus.get(a.id);
    assert.equal(dtu.machine.kind, "entity-node");
    assert.equal(dtu.author, "u1");
    assert.equal(dtu.privacy, "private");
    assert.equal(dtu.scope, "user");
    assert.deepEqual(dtu.relations.map(r => [r.to, r.type, r.attributes.weight]), [[b.id, "knows", 2]]);
    const schema = call("schema-save", "u1", { className: "Person", attributes: [] }).result.schema;
    assert.equal(STATE.dtus.get(schema.id).machine.kind, "entity-schema");
  });

  it("legacy data migrates on first access — same ids, receipt reconciles, arrays frozen, rerun a no-op", () => {
    STATE.entityGraph.nodes.set("u1", [
      { id: "g_n1", name: "Legacy One", entityType: "person", attributes: { role: { value: "ops", source: "import", at: 7 } }, wikidataId: null, createdAt: 100 },
      { id: "g_n2", name: "Legacy Two", entityType: "generic", attributes: {}, wikidataId: "Q9", createdAt: 101 },
    ]);
    STATE.entityGraph.edges.set("u1", [
      { id: "g_e1", from: "g_n1", to: "g_n2", relType: "works at", weight: 4, createdAt: 102 },
    ]);
    STATE.entityGraph.schemas.set("u1", [
      { id: "g_s1", className: "Person", attributes: [{ name: "role", type: "string", required: false }], createdAt: 103 },
    ]);
    const g = call("graph-get", "u1", {});
    assert.deepEqual(g.result.nodes.map(n => n.id).sort(), ["g_n1", "g_n2"]);
    assert.equal(g.result.edges.length, 1);
    assert.equal(g.result.edges[0].relType, "works at", "legacy free-form relTypes survive migration");
    assert.equal(g.result.edges[0].weight, 4);
    assert.equal(g.result.schemas.length, 1);
    assert.deepEqual(
      { nodes: g.result.migration.nodes, edges: g.result.migration.edges, schemas: g.result.migration.schemas },
      { nodes: 2, edges: 1, schemas: 1 },
    );
    // The migrated edge is a relation on the substrate.
    assert.equal(STATE.dtus.get("g_n1").relations[0].source, "migration:entity-graph");
    // Legacy arrays are frozen, not deleted.
    assert.equal(STATE.entityGraph.nodes.get("u1").length, 2);
    // Second access: no duplicates, receipt stable.
    const g2 = call("graph-get", "u1", {});
    assert.equal(g2.result.nodes.length, 2);
    assert.equal(g2.result.migration.at, g.result.migration.at);
    // And the migrated graph is fully workable.
    assert.equal(call("edge-delete", "u1", { id: g.result.edges[0].id }).ok, true);
    assert.equal(call("graph-get", "u1", {}).result.edges.length, 0);
  });

  it("migration never overwrites a foreign DTU squatting on a legacy id", () => {
    STATE.dtus.set("g_n1", { id: "g_n1", title: "Someone else's DTU", machine: { kind: "note" }, author: "uX" });
    STATE.entityGraph.nodes.set("u1", [
      { id: "g_n1", name: "Clashing", entityType: "generic", attributes: {}, wikidataId: null, createdAt: 1 },
      { id: "g_n2", name: "Fine", entityType: "generic", attributes: {}, wikidataId: null, createdAt: 2 },
    ]);
    const g = call("graph-get", "u1", {});
    assert.deepEqual(g.result.migration.conflicts, ["g_n1"]);
    assert.equal(STATE.dtus.get("g_n1").title, "Someone else's DTU");
    assert.deepEqual(g.result.nodes.map(n => n.id), ["g_n2"]);
  });
});
