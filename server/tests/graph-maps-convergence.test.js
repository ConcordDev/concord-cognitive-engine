// #1715 S3 — Maps convergence onto the DTU substrate.
//
// Pins: map macro behaviour unchanged (central-node guard, edge
// uniqueness, merge contract); every node resolves to a DTU
// (standalone nodes get owner-scoped "map-node" backings, stamped
// onto node.dtuId); every map edge stands as a typed relation on the
// substrate with the asserting maps recorded; deletions prune
// exactly their relations; a second map asserting the same pair
// shares one relation; pre-linked DTUs are used, never replaced.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

function makeMap(user = "u1") {
  const m = call("map-create", user, { title: "My Map" }).result.map;
  const child = call("node-add", user, { mapId: m.id, label: "Child", parentId: m.nodes[0].id }).result.node;
  return { map: call("map-detail", user, { id: m.id }).result.map, child };
}

describe("S3 maps convergence", () => {
  it("nodes get owner-scoped backing DTUs; the parent edge stands as a relation", () => {
    const { map } = makeMap();
    const central = map.nodes.find((n) => n.central);
    const child = map.nodes.find((n) => !n.central);
    assert.ok(central.dtuId && child.dtuId, "both nodes resolved to DTUs");
    const backing = STATE.dtus.get(child.dtuId);
    assert.equal(backing.machine.kind, "map-node");
    assert.equal(backing.author, "u1");
    assert.equal(backing.privacy, "private");
    assert.equal(backing.title, "Child");
    const rel = STATE.dtus.get(central.dtuId).relations;
    assert.equal(rel.length, 1);
    assert.equal(rel[0].to, child.dtuId);
    assert.equal(rel[0].type, "map-link");
    assert.equal(rel[0].source, "map");
    assert.deepEqual(rel[0].attributes.mapIds, [map.id]);
  });

  it("a labelled edge slugs its type and keeps the label; edge-delete prunes the relation", () => {
    const { map, child } = makeMap();
    const third = call("node-add", "u1", { mapId: map.id, label: "Third" }).result.node;
    const e = call("edge-add", "u1", { mapId: map.id, fromNodeId: child.id, toNodeId: third.id, label: "Depends On" }).result.edge;
    const fromDtu = STATE.dtus.get(child.dtuId);
    const rel = fromDtu.relations.find((r) => r.type === "depends-on");
    assert.ok(rel, "label slugged to the relation type");
    assert.equal(rel.attributes.label, "Depends On");
    call("edge-delete", "u1", { mapId: map.id, edgeId: e.id });
    assert.equal(STATE.dtus.get(child.dtuId).relations.some((r) => r.type === "depends-on"), false);
  });

  it("node-delete prunes its relations but the backing DTU survives; central guard intact", () => {
    const { map, child } = makeMap();
    const central = map.nodes.find((n) => n.central);
    assert.equal(call("node-delete", "u1", { mapId: map.id, nodeId: central.id }).error, "cannot delete the central node");
    const childDtuId = child.dtuId;
    call("node-delete", "u1", { mapId: map.id, nodeId: child.id });
    assert.equal(STATE.dtus.get(central.dtuId).relations.length, 0, "the edge's relation pruned");
    assert.ok(STATE.dtus.get(childDtuId), "backing DTU outlives the view element (documented boundary)");
  });

  it("two maps asserting the same pair share one relation; deleting one map keeps it, deleting both prunes it", () => {
    // The same two real DTUs, linked into both maps with an edge
    // between them in each — one substrate relation, two asserters.
    STATE.dtus.set("dtu_a", { id: "dtu_a", title: "A", author: "u1", relations: [] });
    STATE.dtus.set("dtu_b", { id: "dtu_b", title: "B", author: "u1", relations: [] });
    const m1 = call("map-create", "u1", { title: "One" }).result.map;
    const m2 = call("map-create", "u1", { title: "Two" }).result.map;
    for (const m of [m1, m2]) {
      const na = call("node-add", "u1", { mapId: m.id, label: "A here" }).result.node;
      const nb = call("node-add", "u1", { mapId: m.id, label: "B here" }).result.node;
      call("link-node-dtu", "u1", { mapId: m.id, nodeId: na.id, dtuId: "dtu_a" });
      call("link-node-dtu", "u1", { mapId: m.id, nodeId: nb.id, dtuId: "dtu_b" });
      call("edge-add", "u1", { mapId: m.id, fromNodeId: na.id, toNodeId: nb.id });
    }
    call("map-detail", "u1", { id: m1.id });
    const shared = STATE.dtus.get("dtu_a").relations.filter((r) => r.to === "dtu_b");
    assert.equal(shared.length, 1, "one relation for the pair");
    assert.deepEqual(new Set(shared[0].attributes.mapIds), new Set([m1.id, m2.id]));
    call("map-delete", "u1", { id: m1.id });
    const after1 = STATE.dtus.get("dtu_a").relations.filter((r) => r.to === "dtu_b");
    assert.equal(after1.length, 1, "still asserted by the surviving map");
    assert.deepEqual(after1[0].attributes.mapIds, [m2.id]);
    call("map-delete", "u1", { id: m2.id });
    assert.equal(STATE.dtus.get("dtu_a").relations.some((r) => r.to === "dtu_b"), false);
  });

  it("a pre-linked node keeps its real DTU; relations land on it and retract with the map", () => {
    STATE.dtus.set("dtu_real", { id: "dtu_real", title: "Real content", author: "someoneelse", relations: [] });
    const m = call("map-create", "u1", { title: "Links" }).result.map;
    const n = call("node-add", "u1", { mapId: m.id, label: "Pointer" }).result.node;
    call("link-node-dtu", "u1", { mapId: m.id, nodeId: n.id, dtuId: "dtu_real" });
    call("edge-add", "u1", { mapId: m.id, fromNodeId: m.nodes[0].id, toNodeId: n.id });
    const central = call("map-detail", "u1", { id: m.id }).result.map.nodes[0];
    assert.equal(STATE.dtus.get(central.dtuId).relations[0].to, "dtu_real");
    assert.equal(STATE.dtus.get("dtu_real").title, "Real content", "the real DTU is never rewritten by convergence");
  });

  it("node-update carries label/notes onto the backing DTU; repeated converges are no-ops", () => {
    const { map, child } = makeMap();
    call("node-update", "u1", { mapId: map.id, nodeId: child.id, label: "Renamed", notes: "field notes" });
    const backing = STATE.dtus.get(child.dtuId);
    assert.equal(backing.title, "Renamed");
    assert.equal(backing.content, "field notes");
    const sizeBefore = STATE.dtus.size;
    const relCount = [...STATE.dtus.values()].reduce((n, d) => n + (d.relations?.length || 0), 0);
    call("map-detail", "u1", { id: map.id });
    call("map-detail", "u1", { id: map.id });
    assert.equal(STATE.dtus.size, sizeBefore, "no new DTUs on reconverge");
    assert.equal([...STATE.dtus.values()].reduce((n, d) => n + (d.relations?.length || 0), 0), relCount);
  });

  it("another user's converge never touches this user's relations", () => {
    const { map } = makeMap("u1");
    const central = map.nodes.find((n) => n.central);
    call("map-create", "u2", { title: "Other" });
    assert.equal(STATE.dtus.get(central.dtuId).relations.length, 1);
  });
});
