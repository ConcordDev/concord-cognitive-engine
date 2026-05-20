// Contract tests for the graph lens — XMind/MindMeister-shape mind-map
// / concept-graph builder substrate in server/domains/graph.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGraphActions from "../domains/graph.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`graph.${name}`);
  assert.ok(fn, `graph.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGraphActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newMap(ctx = ctxA) {
  return call("map-create", ctx, { title: "Project Plan" }).result.map;
}

describe("graph.map CRUD", () => {
  it("creates a map with a central node, scoped per user", () => {
    const m = newMap();
    assert.equal(m.nodes.length, 1);
    assert.equal(m.nodes[0].central, true);
    assert.equal(call("map-list", ctxA, {}).result.count, 1);
    assert.equal(call("map-list", ctxB, {}).result.count, 0);
  });
  it("rejects an untitled map and deletes one", () => {
    assert.equal(call("map-create", ctxA, {}).ok, false);
    const m = newMap();
    call("map-delete", ctxA, { id: m.id });
    assert.equal(call("map-list", ctxA, {}).result.count, 0);
  });
});

describe("graph.nodes + edges", () => {
  it("adds a child node and auto-creates a branch edge", () => {
    const m = newMap();
    const r = call("node-add", ctxA, { mapId: m.id, label: "Phase 1", parentId: m.nodes[0].id });
    assert.equal(r.ok, true);
    assert.ok(r.result.edge);
    const d = call("map-detail", ctxA, { id: m.id }).result.map;
    assert.equal(d.nodes.length, 2);
    assert.equal(d.edges.length, 1);
  });
  it("cannot delete the central node; deleting a node cascades edges", () => {
    const m = newMap();
    assert.equal(call("node-delete", ctxA, { mapId: m.id, nodeId: m.nodes[0].id }).ok, false);
    const n = call("node-add", ctxA, { mapId: m.id, label: "Branch", parentId: m.nodes[0].id }).result.node;
    call("node-delete", ctxA, { mapId: m.id, nodeId: n.id });
    const d = call("map-detail", ctxA, { id: m.id }).result.map;
    assert.equal(d.nodes.length, 1);
    assert.equal(d.edges.length, 0);
  });
  it("adds explicit edges; rejects self-loops and duplicates", () => {
    const m = newMap();
    const a = call("node-add", ctxA, { mapId: m.id, label: "A" }).result.node;
    const b = call("node-add", ctxA, { mapId: m.id, label: "B" }).result.node;
    assert.equal(call("edge-add", ctxA, { mapId: m.id, fromNodeId: a.id, toNodeId: b.id }).ok, true);
    assert.equal(call("edge-add", ctxA, { mapId: m.id, fromNodeId: a.id, toNodeId: a.id }).ok, false);
    assert.equal(call("edge-add", ctxA, { mapId: m.id, fromNodeId: a.id, toNodeId: b.id }).ok, false);
  });
});

describe("graph.metrics", () => {
  it("computes degree + most-connected node", () => {
    const m = newMap();
    const hub = m.nodes[0];
    call("node-add", ctxA, { mapId: m.id, label: "C1", parentId: hub.id });
    call("node-add", ctxA, { mapId: m.id, label: "C2", parentId: hub.id });
    call("node-add", ctxA, { mapId: m.id, label: "C3", parentId: hub.id });
    const mt = call("map-metrics", ctxA, { id: m.id });
    assert.equal(mt.result.nodeCount, 4);
    assert.equal(mt.result.edgeCount, 3);
    assert.equal(mt.result.mostConnected.degree, 3);
  });
  it("graph-dashboard aggregates maps + nodes", () => {
    const m = newMap();
    call("node-add", ctxA, { mapId: m.id, label: "X" });
    const d = call("graph-dashboard", ctxA, {});
    assert.equal(d.result.maps, 1);
    assert.equal(d.result.totalNodes, 2);
  });
});

describe("graph — analysis macros still intact", () => {
  it("graphMetrics still responds", () => {
    assert.equal(call("graphMetrics", ctxA, {}).ok, true);
  });
});
