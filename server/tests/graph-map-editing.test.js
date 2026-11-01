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
  it("re-import into the same map merges by label — 0 added, duplicates counted", () => {
    const doc = {
      nodes: [{ label: "Alpha" }, { label: "Beta" }],
      edges: [{ fromLabel: "Alpha", toLabel: "Beta", label: "links" }],
    };
    const first = call(ctxA, "map-import", { format: "json", content: JSON.stringify(doc) });
    assert.equal(first.result.imported.nodes, 2);
    const again = call(ctxA, "map-import", { format: "json", mapId: first.result.map.id, content: JSON.stringify(doc) });
    assert.equal(again.ok, true);
    assert.equal(again.result.imported.nodes, 0);
    assert.equal(again.result.merged, 2);
    assert.equal(again.result.skipped.edges, 1);
    const detail = call(ctxA, "map-detail", { id: first.result.map.id });
    assert.equal(detail.result.map.nodes.length, 2);
    assert.equal(detail.result.map.edges.length, 1);
    assert.equal(call(ctxA, "map-import", { format: "json", mapId: "mp_nope", content: JSON.stringify(doc) }).error, "map not found");
  });
  it("imports a CSV edges section; an unknown-endpoint row is a per-row error", () => {
    const csv = ["label,notes", "Alpha,", "Beta,", "edges", "from,to,label", "Alpha,Beta,links", "Alpha,Ghost,bad"].join("\n");
    const r = call(ctxA, "map-import", { format: "csv", content: csv });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.imported.nodes, 2);
    assert.equal(r.result.imported.edges, 1);
    assert.equal(r.result.errors.length, 1);
    assert.equal(r.result.errors[0].row, 7);
  });
  it("caps at 1000 node rows with a whole-call error, never truncation", () => {
    const nodes = Array.from({ length: 1001 }, (_, i) => ({ label: `N${i}` }));
    const r = call(ctxA, "map-import", { format: "json", content: JSON.stringify({ nodes }) });
    assert.equal(r.ok, false);
    assert.match(r.error, /1000/);
  });
});

describe("checkpoints: orphans / props discipline / trash bounds", () => {
  it("a fresh map has zero orphans — the central node is the anchor, not an orphan", () => {
    const m = makeMap();
    const r = call(ctxA, "map-orphans", { id: m.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.orphans, []);
    assert.equal(r.result.count, 0);
  });
  it("rejects props past 32 keys instead of truncating, and non-finite numbers naming the key", () => {
    const m = makeMap();
    const n = addNode(ctxA, m.id, "Props");
    const many = {};
    for (let i = 0; i < 33; i++) many[`k${i}`] = i;
    const over = call(ctxA, "node-update", { mapId: m.id, nodeId: n.id, props: many });
    assert.equal(over.ok, false);
    assert.match(over.error, /32/);
    const nan = call(ctxA, "node-update", { mapId: m.id, nodeId: n.id, props: { score: NaN } });
    assert.equal(nan.ok, false);
    assert.match(nan.error, /score/);
    const after = call(ctxA, "map-detail", { id: m.id }).result.map.nodes.find((x) => x.id === n.id);
    assert.equal(after.props, undefined);
  });
  it("node-add takes initial props through the same sanitizer; bad props create nothing", () => {
    const m = makeMap();
    const good = call(ctxA, "node-add", { mapId: m.id, label: "WithProps", props: { tier: "core", weight: 2 } });
    assert.equal(good.ok, true);
    assert.deepEqual(good.result.node.props, { tier: "core", weight: 2 });
    const before = call(ctxA, "map-detail", { id: m.id }).result.map.nodes.length;
    const bad = call(ctxA, "node-add", { mapId: m.id, label: "BadProps", props: { nested: [1] } });
    assert.equal(bad.ok, false);
    assert.equal(call(ctxA, "map-detail", { id: m.id }).result.map.nodes.length, before);
  });
  it("trash keeps only the last 10 deletions", () => {
    const m = makeMap();
    const ids = [];
    for (let i = 0; i < 11; i++) ids.push(addNode(ctxA, m.id, `T${i}`).id);
    for (const id of ids) call(ctxA, "node-delete", { mapId: m.id, nodeId: id });
    for (let i = 0; i < 10; i++) assert.equal(call(ctxA, "map-undo-delete", { mapId: m.id }).ok, true);
    assert.equal(call(ctxA, "map-undo-delete", { mapId: m.id }).error, "nothing to undo");
  });
  it("undo never mints a duplicate directed edge pair", () => {
    const m = makeMap();
    const a = m.nodes[0];
    const b = addNode(ctxA, m.id, "Beta");
    const e = call(ctxA, "edge-add", { mapId: m.id, fromNodeId: a.id, toNodeId: b.id });
    call(ctxA, "edge-delete", { mapId: m.id, edgeId: e.result.edge.id });
    call(ctxA, "edge-add", { mapId: m.id, fromNodeId: a.id, toNodeId: b.id });
    const undo = call(ctxA, "map-undo-delete", { mapId: m.id });
    assert.equal(undo.ok, true);
    assert.equal(undo.result.alreadyPresent, true);
    assert.equal(call(ctxA, "map-detail", { id: m.id }).result.map.edges.length, 1);
  });
});

// ── S9 (F9): DTU link validation + real integrity verification ──────
import { DatabaseSync } from "node:sqlite";
import { initIntegrityTable, createIntegritySystem } from "../lib/dtu-integrity.js";

describe("link-node-dtu validates the DTU at link time", () => {
  it("rejects a bogus id inline and links a real one", () => {
    const m = makeMap();
    const centre = m.nodes[0];
    const real = { id: "dtu_real", title: "Real", content: "x" };
    globalThis._concordSTATE.dtus = { get: (id) => (id === real.id ? real : undefined) };
    const bad = call(ctxA, "link-node-dtu", { mapId: m.id, nodeId: centre.id, dtuId: "bogus-dtu-id" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /doesn't exist/);
    const good = call(ctxA, "link-node-dtu", { mapId: m.id, nodeId: centre.id, dtuId: "dtu_real" });
    assert.equal(good.ok, true);
    assert.equal(call(ctxA, "map-detail", { id: m.id }).result.map.nodes[0].dtuId, "dtu_real");
  });
});

describe("verify-dtu runs the integrity chain", () => {
  // One shared in-memory db: the macro caches its integrity system.
  const db = new DatabaseSync(":memory:");
  initIntegrityTable(db);
  const anchor = createIntegritySystem(db);
  const anchored = { id: "dtu_anchored", content: "signed content", summary: "s", tier: "regular", scope: "global", createdAt: "2025-01-01T00:00:00Z" };
  anchor.generateIntegrity(anchored);
  const plain = { id: "dtu_plain", content: "never anchored", summary: "s", tier: "regular", scope: "global", createdAt: "2025-01-01T00:00:00Z" };
  const store = new Map([[anchored.id, anchored], [plain.id, plain]]);
  const wire = () => {
    globalThis._concordSTATE.dtus = { get: (id) => store.get(id) };
    globalThis._concordSTATE.db = db;
  };

  it("reports verified for an anchored, untouched DTU", () => {
    wire();
    const r = call(ctxA, "verify-dtu", { dtuId: "dtu_anchored" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.status, "verified");
    assert.equal(r.result.contentMatch, true);
  });
  it("reports unanchored — not verified — when no record exists", () => {
    wire();
    const r = call(ctxA, "verify-dtu", { dtuId: "dtu_plain" });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "unanchored");
    assert.equal(r.result.isValid, false);
  });
  it("reports tampered when the content no longer matches", () => {
    wire();
    store.set("dtu_anchored", { ...anchored, content: "edited after signing" });
    const r = call(ctxA, "verify-dtu", { dtuId: "dtu_anchored" });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "tampered");
    assert.equal(r.result.contentMatch, false);
    store.set("dtu_anchored", anchored);
  });
  it("refuses an unknown DTU", () => {
    wire();
    const r = call(ctxA, "verify-dtu", { dtuId: "dtu_nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "DTU not found");
  });
});
