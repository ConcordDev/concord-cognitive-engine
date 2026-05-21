// Contract tests for the Obsidian-graph-view / Kumu parity macros in
// server/domains/graph.js — local graph view, saved filters, color group
// rules, timeline scrubber, auto-layout, bidirectional DTU sync, view export.
// Pure-Node Tier-2 — no server boot, no HTTP.

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

const ctxA = { actor: { userId: "graph_a" }, userId: "graph_a" };
const ctxB = { actor: { userId: "graph_b" }, userId: "graph_b" };

// Build a small map: central → A → B, central → C (isolated D added too).
function seedMap(ctx) {
  const map = call("map-create", ctx, { title: "Test Map" }).result.map;
  const central = map.nodes[0];
  const a = call("node-add", ctx, { mapId: map.id, label: "Alpha node", parentId: central.id, notes: "alpha notes" }).result.node;
  const b = call("node-add", ctx, { mapId: map.id, label: "Beta node", parentId: a.id }).result.node;
  const c = call("node-add", ctx, { mapId: map.id, label: "Gamma central topic", parentId: central.id }).result.node;
  const d = call("node-add", ctx, { mapId: map.id, label: "Delta orphan" }).result.node;
  return { map, central, a, b, c, d };
}

describe("graph — local graph view", () => {
  it("returns the neighborhood at depth 1 then depth 2", () => {
    const { map, central } = seedMap(ctxA);
    const d1 = call("local-graph", ctxA, { mapId: map.id, nodeId: central.id, depth: 1 });
    assert.equal(d1.ok, true);
    // central + Alpha + Gamma (direct neighbors) = 3
    assert.equal(d1.result.nodeCount, 3);
    const d2 = call("local-graph", ctxA, { mapId: map.id, nodeId: central.id, depth: 2 });
    // adds Beta (2 hops away) = 4
    assert.equal(d2.result.nodeCount, 4);
    assert.equal(d2.result.depth, 2);
    assert.ok(d2.result.nodes.every((n) => typeof n.hops === "number"));
  });

  it("rejects an unknown node", () => {
    const { map } = seedMap(ctxA);
    const r = call("local-graph", ctxA, { mapId: map.id, nodeId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("graph — saved filters / query language", () => {
  it("save, list, apply and delete a filter", () => {
    const { map } = seedMap(ctxA);
    const saved = call("filter-save", ctxA, { name: "Central nodes", query: { central: true } });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.updated, false);
    assert.equal(call("filter-list", ctxA).result.count, 1);

    const applied = call("filter-apply", ctxA, { mapId: map.id, filterId: saved.result.filter.id });
    assert.equal(applied.ok, true);
    assert.equal(applied.result.matchCount, 1); // only the central node

    const del = call("filter-delete", ctxA, { id: saved.result.filter.id });
    assert.equal(del.ok, true);
    assert.equal(call("filter-list", ctxA).result.count, 0);
  });

  it("filter-save updates an existing filter of the same name", () => {
    call("filter-save", ctxA, { name: "Re", query: { labelContains: "x" } });
    const r = call("filter-save", ctxA, { name: "re", query: { labelContains: "y" } });
    assert.equal(r.result.updated, true);
    assert.equal(call("filter-list", ctxA).result.count, 1);
  });

  it("filter-apply runs an inline query (labelContains)", () => {
    const { map } = seedMap(ctxA);
    const r = call("filter-apply", ctxA, { mapId: map.id, query: { labelContains: "node" } });
    assert.equal(r.ok, true);
    // Alpha node + Beta node match "node"
    assert.equal(r.result.matchCount, 2);
  });

  it("filters are per-user", () => {
    call("filter-save", ctxA, { name: "A only", query: {} });
    assert.equal(call("filter-list", ctxB).result.count, 0);
  });
});

describe("graph — node color group rules", () => {
  it("sets rules and produces node→color assignments", () => {
    const { map } = seedMap(ctxA);
    const set = call("group-rules-set", ctxA, {
      mapId: map.id,
      rules: [{ name: "Central topics", color: "#a855f7", labelContains: "central" }],
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.count, 1);
    const got = call("group-rules-get", ctxA, { id: map.id });
    assert.equal(got.ok, true);
    // "Gamma central topic" matches "central"
    assert.equal(got.result.groupedCount, 1);
  });

  it("rejects an invalid hex color", () => {
    const { map } = seedMap(ctxA);
    const r = call("group-rules-set", ctxA, { mapId: map.id, rules: [{ name: "Bad", color: "blue" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0); // invalid rule dropped
  });
});

describe("graph — timeline scrubber", () => {
  it("returns growth frames and a subset at an earlier index", () => {
    const { map } = seedMap(ctxA);
    const full = call("timeline", ctxA, { id: map.id });
    assert.equal(full.ok, true);
    assert.ok(full.result.frameCount >= 1);
    assert.equal(full.result.nodeCount, 5); // all nodes at last frame
    const early = call("timeline", ctxA, { id: map.id, index: 0 });
    assert.ok(early.result.nodeCount <= full.result.nodeCount);
    assert.equal(early.result.index, 0);
  });

  it("rejects an unknown map", () => {
    const r = call("timeline", ctxA, { id: "missing" });
    assert.equal(r.ok, false);
  });
});

describe("graph — auto-layout algorithms", () => {
  it("computes radial positions for every node", () => {
    const { map } = seedMap(ctxA);
    const r = call("layout", ctxA, { mapId: map.id, algorithm: "radial" });
    assert.equal(r.ok, true);
    assert.equal(Object.keys(r.result.positions).length, 5);
    assert.equal(r.result.algorithm, "radial");
  });

  it("supports hierarchical and circular", () => {
    const { map } = seedMap(ctxA);
    assert.equal(call("layout", ctxA, { mapId: map.id, algorithm: "hierarchical" }).ok, true);
    assert.equal(call("layout", ctxA, { mapId: map.id, algorithm: "circular" }).ok, true);
  });

  it("rejects an unknown algorithm", () => {
    const { map } = seedMap(ctxA);
    const r = call("layout", ctxA, { mapId: map.id, algorithm: "spiral" });
    assert.equal(r.ok, false);
  });
});

describe("graph — bidirectional DTU sync", () => {
  it("links a node to a DTU then syncs edits back", () => {
    globalThis._concordSTATE.dtus.set("dtu-1", { id: "dtu-1", title: "old", content: "old" });
    const { map, a } = seedMap(ctxA);
    const link = call("link-node-dtu", ctxA, { mapId: map.id, nodeId: a.id, dtuId: "dtu-1" });
    assert.equal(link.ok, true);
    call("node-update", ctxA, { mapId: map.id, nodeId: a.id, label: "Renamed", notes: "new body" });
    const sync = call("sync-to-dtu", ctxA, { mapId: map.id, nodeId: a.id });
    assert.equal(sync.ok, true);
    const dtu = globalThis._concordSTATE.dtus.get("dtu-1");
    assert.equal(dtu.title, "Renamed");
    assert.equal(dtu.content, "new body");
  });

  it("rejects sync for a node with no linked DTU", () => {
    const { map, b } = seedMap(ctxA);
    const r = call("sync-to-dtu", ctxA, { mapId: map.id, nodeId: b.id });
    assert.equal(r.ok, false);
  });
});

describe("graph — export view with state", () => {
  it("exports JSON with baked-in view state", () => {
    const { map } = seedMap(ctxA);
    call("layout", ctxA, { mapId: map.id, algorithm: "circular" });
    const r = call("export-view", ctxA, { mapId: map.id, format: "json", zoom: 1.5, panX: 20, panY: -10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.viewState.zoom, 1.5);
    assert.equal(r.result.export.nodes.length, 5);
    assert.ok(r.result.export.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  });

  it("exports an SVG string", () => {
    const { map } = seedMap(ctxA);
    const r = call("export-view", ctxA, { mapId: map.id, format: "svg", zoom: 2 });
    assert.equal(r.ok, true);
    assert.match(r.result.svg, /^<svg/);
    assert.ok(r.result.svg.includes("scale(2)"));
  });

  it("rejects an unknown format", () => {
    const { map } = seedMap(ctxA);
    const r = call("export-view", ctxA, { mapId: map.id, format: "pdf" });
    assert.equal(r.ok, false);
  });
});
