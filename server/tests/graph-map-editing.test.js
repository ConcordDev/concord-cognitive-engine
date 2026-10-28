// Behaviour tests for the Graph lens map-editing macros added in the
// #1706 rework: map-update (rename/describe), edge-update (+ edge type),
// node typed properties, map-import (CSV/JSON with per-row errors),
// map-orphans, and delete-undo (map-undo-delete). Driven through the
// exact 3-arg live dispatch shape fn(ctx, artifact, params) against
// the STATE-backed map store, like the board harness.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGraphActions from "../domains/graph.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "graph", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
registerGraphActions(registerLensAction);

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const call = (ctx, name, params = {}) => ACTIONS.get(name)(ctx, {}, params);

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

function makeMap(ctx = ctxA, title = "Systems") {
  const r = call(ctx, "map-create", { title });
  assert.equal(r.ok, true);
  return r.result.map;
}
function addNode(ctx, mapId, label, parentId) {
  const r = call(ctx, "node-add", { mapId, label, parentId });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.node;
}

describe("map-update", () => {
  it("renames and describes a map, persisted on read-back", () => {
    const m = makeMap();
    const u = call(ctxA, "map-update", { id: m.id, title: "Renamed", description: "How it connects" });
    assert.equal(u.ok, true);
    assert.equal(u.result.map.title, "Renamed");
    const d = call(ctxA, "map-detail", { id: m.id });
    assert.equal(d.result.map.title, "Renamed");
    assert.equal(d.result.map.description, "How it connects");
  });
  it("refuses an empty title and an unknown map", () => {
    const m = makeMap();
    assert.equal(call(ctxA, "map-update", { id: m.id, title: "  " }).ok, false);
    assert.equal(call(ctxA, "map-update", { id: "mp_nope", title: "x" }).error, "map not found");
  });
  it("is owner-scoped: another user cannot rename my map", () => {
    const m = makeMap();
    assert.equal(call(ctxB, "map-update", { id: m.id, title: "hijack" }).ok, false);
  });
});

describe("edge-update and edge type", () => {
  it("adds a typed edge and edits its label and type", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const b = addNode(ctxA, m.id, "Beta");
    const e = call(ctxA, "edge-add", { mapId: m.id, fromNodeId: a.id, toNodeId: b.id, label: "feeds", type: "data" });
    assert.equal(e.result.edge.type, "data");
    const u = call(ctxA, "edge-update", { mapId: m.id, edgeId: e.result.edge.id, label: "blocks", type: "control" });
    assert.equal(u.ok, true);
    assert.equal(u.result.edge.label, "blocks");
    assert.equal(u.result.edge.type, "control");
    assert.equal(call(ctxA, "edge-update", { mapId: m.id, edgeId: "ed_nope", label: "x" }).error, "edge not found");
  });
});

describe("node typed properties (inspector)", () => {
  it("sets typed props, removes a key set to null, refuses non-scalars", () => {
    const m = makeMap();
    const n = addNode(ctxA, m.id, "Gamma");
    const u1 = call(ctxA, "node-update", { mapId: m.id, nodeId: n.id, props: { owner: "ada", weight: 3, active: true } });
    assert.deepEqual(u1.result.node.props, { owner: "ada", weight: 3, active: true });
    const u2 = call(ctxA, "node-update", { mapId: m.id, nodeId: n.id, props: { weight: null } });
    assert.deepEqual(u2.result.node.props, { owner: "ada", active: true });
    const bad = call(ctxA, "node-update", { mapId: m.id, nodeId: n.id, props: { nested: { x: 1 } } });
    assert.equal(bad.ok, false);
  });
});

describe("map-orphans", () => {
  it("lists exactly the degree-0 nodes", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const linked = addNode(ctxA, m.id, "Linked", a.id); // node-add with parent creates an edge
    const solo = addNode(ctxA, m.id, "Solo");
    assert.ok(linked);
    const r = call(ctxA, "map-orphans", { id: m.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.orphans.map((n) => n.id), [solo.id]);
    assert.equal(r.result.count, 1);
  });
});

describe("delete + undo", () => {
  it("restores a deleted node with its edges", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const b = addNode(ctxA, m.id, "Beta", a.id);
    const del = call(ctxA, "node-delete", { mapId: m.id, nodeId: b.id });
    assert.equal(del.result.undoable, true);
    assert.equal(call(ctxA, "map-detail", { id: m.id }).result.map.nodes.length, 1);
    const undo = call(ctxA, "map-undo-delete", { mapId: m.id });
    assert.equal(undo.ok, true);
    assert.equal(undo.result.restored, "node");
    assert.equal(undo.result.restoredEdges, 1);
    const after = call(ctxA, "map-detail", { id: m.id }).result.map;
    assert.equal(after.nodes.length, 2);
    assert.equal(after.edges.length, 1);
  });
  it("restores a deleted edge; empty trash refuses honestly", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const b = addNode(ctxA, m.id, "Beta");
    const e = call(ctxA, "edge-add", { mapId: m.id, fromNodeId: a.id, toNodeId: b.id });
    call(ctxA, "edge-delete", { mapId: m.id, edgeId: e.result.edge.id });
    const undo = call(ctxA, "map-undo-delete", { mapId: m.id });
    assert.equal(undo.result.restored, "edge");
    assert.equal(call(ctxA, "map-undo-delete", { mapId: m.id }).error, "nothing to undo");
  });
  it("does not consume the trash entry when an edge restore is impossible", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const b = addNode(ctxA, m.id, "Beta");
    const c = addNode(ctxA, m.id, "Gamma");
    const e = call(ctxA, "edge-add", { mapId: m.id, fromNodeId: b.id, toNodeId: c.id });
    call(ctxA, "edge-delete", { mapId: m.id, edgeId: e.result.edge.id }); // trash: edge
    call(ctxA, "node-delete", { mapId: m.id, nodeId: c.id }); // trash: node (top)
    // top of trash is the node; undo it first, then the edge restores fine
    assert.equal(call(ctxA, "map-undo-delete", { mapId: m.id }).result.restored, "node");
    assert.equal(call(ctxA, "map-undo-delete", { mapId: m.id }).result.restored, "edge");
  });
});

describe("map-import", () => {
  it("imports a 50-node CSV and reports a bad row per-row", () => {
    const lines = ["label,notes"];
    for (let i = 1; i <= 50; i++) lines.push(`Node ${i},"note, with comma ${i}"`);
    lines.push(",missing label");
    const r = call(ctxA, "map-import", { format: "csv", title: "Big import", content: lines.join("\n") });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.imported.nodes, 50);
    assert.equal(r.result.errors.length, 1);
    assert.equal(r.result.errors[0].row, 52);
    const detail = call(ctxA, "map-detail", { id: r.result.map.id });
    assert.equal(detail.result.map.nodes.length, 50);
    assert.equal(detail.result.map.nodes[0].notes, "note, with comma 1");
  });
  it("imports JSON nodes and edges by label; unknown-label edge is a per-row error", () => {
    const doc = {
      nodes: [{ label: "Alpha" }, { label: "Beta" }],
      edges: [
        { fromLabel: "Alpha", toLabel: "Beta", label: "links", type: "data" },
        { fromLabel: "Alpha", toLabel: "Ghost", label: "bad" },
      ],
    };
    const r = call(ctxA, "map-import", { format: "json", content: JSON.stringify(doc) });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported.edges, 1);
    assert.equal(r.result.errors.length, 1);
    assert.equal(r.result.map.edges[0].type, "data");
  });
  it("refuses invalid JSON, a missing label column, and empty content", () => {
    assert.equal(call(ctxA, "map-import", { format: "json", content: "{nope" }).ok, false);
    assert.equal(call(ctxA, "map-import", { format: "csv", content: "name,notes\nx,y" }).ok, false);
    assert.equal(call(ctxA, "map-import", { format: "csv", content: "  " }).ok, false);
  });
});
