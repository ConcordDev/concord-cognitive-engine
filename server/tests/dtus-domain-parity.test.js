// Contract tests for server/domains/dtus.js — DTU knowledge-base browser
// parity macros: citation graph, faceted search, lineage tree, bulk ops,
// compare/merge, saved views, and the 4-layer editor.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDtusActions from "../domains/dtus.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, data = {}, params = null) {
  const fn = ACTIONS.get(`dtus.${name}`);
  if (!fn) throw new Error(`dtus.${name} not registered`);
  const artifact = { id: data.id || "dtu_test", title: data.title || "Test DTU", data, meta: data.meta || {} };
  return fn(ctx, artifact, params || data);
}

before(() => { registerDtusActions(register); });

beforeEach(() => {
  // isolate per-user persistent state between tests
  if (globalThis._concordSTATE) globalThis._concordSTATE.dtusLens = undefined;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const CORPUS = [
  { id: "d1", title: "Cognition basics", tier: "regular", layer: "core", scope: "public", tags: ["mind", "theory"], quality: 80, parents: [] },
  { id: "d2", title: "Cognition advanced", tier: "mega", layer: "core", scope: "public", tags: ["mind"], quality: 60, parents: ["d1"], cites: ["d1"] },
  { id: "d3", title: "Memory model", tier: "regular", layer: "human", scope: "personal", tags: ["memory"], quality: 30, parents: ["d1", "d2"], cites: ["d1", "d2"] },
];

describe("dtus.citationGraph", () => {
  it("projects nodes and edges from a corpus", () => {
    const r = call("citationGraph", ctxA, { dtus: CORPUS });
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 3);
    assert.ok(r.result.edges.length >= 2);
    assert.equal(r.result.stats.nodeCount, 3);
  });

  it("computes inDegree + influence + hubs", () => {
    const r = call("citationGraph", ctxA, { dtus: CORPUS });
    const d1 = r.result.nodes.find(n => n.id === "d1");
    assert.ok(d1.inDegree >= 2);
    assert.equal(d1.influence, 100);
    assert.equal(r.result.hubs[0].id, "d1");
  });

  it("handles an empty corpus", () => {
    const r = call("citationGraph", ctxA, { dtus: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 0);
  });
});

describe("dtus.facets", () => {
  it("buckets layer / tier / scope / quality / tag", () => {
    const r = call("facets", ctxA, { dtus: CORPUS });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.ok(r.result.facets.tier.find(b => b.value === "regular").count === 2);
    assert.ok(r.result.facets.tag.find(b => b.value === "mind").count === 2);
    assert.ok(r.result.facets.quality.length > 0);
  });
});

describe("dtus.facetedSearch", () => {
  it("filters by tier", () => {
    const r = call("facetedSearch", ctxA, { dtus: CORPUS, filter: { tiers: ["mega"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.results[0].id, "d2");
  });

  it("filters by query text and quality band", () => {
    const r = call("facetedSearch", ctxA, { dtus: CORPUS, filter: { query: "cognition", minQuality: 70 } });
    assert.equal(r.result.matched, 1);
    assert.equal(r.result.results[0].id, "d1");
  });

  it("filters by tag intersection", () => {
    const r = call("facetedSearch", ctxA, { dtus: CORPUS, filter: { tags: ["memory"] } });
    assert.equal(r.result.matched, 1);
  });
});

describe("dtus.lineageTree", () => {
  it("builds a recursive drill-down tree", () => {
    const root = {
      id: "mega1", title: "MEGA cluster", tier: "mega",
      children: [
        { id: "o1", title: "Original 1", tier: "regular", children: [] },
        { id: "o2", title: "Original 2", tier: "regular", children: [] },
      ],
    };
    const r = call("lineageTree", ctxA, { root });
    assert.equal(r.ok, true);
    assert.equal(r.result.tree.children.length, 2);
    assert.equal(r.result.stats.nodeCount, 3);
    assert.equal(r.result.stats.maxDepth, 1);
  });

  it("returns null tree when no root supplied", () => {
    const r = call("lineageTree", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.tree, null);
  });
});

describe("dtus.bulkOp", () => {
  it("plans a bulk tag op", () => {
    const r = call("bulkOp", ctxA, { dtuIds: ["d1", "d2"], op: "tag", value: "verified" });
    assert.equal(r.ok, true);
    assert.equal(r.result.affected, 2);
    assert.equal(r.result.changes[0].action, "add");
  });

  it("plans a bulk archive op", () => {
    const r = call("bulkOp", ctxA, { dtuIds: ["d3"], op: "archive" });
    assert.equal(r.ok, true);
    assert.equal(r.result.changes[0].value, "archived");
  });

  it("rejects an unknown op and an empty id list", () => {
    assert.equal(call("bulkOp", ctxA, { dtuIds: ["d1"], op: "explode" }).ok, false);
    assert.equal(call("bulkOp", ctxA, { dtuIds: [], op: "tag", value: "x" }).ok, false);
  });

  it("rejects an invalid tier value", () => {
    assert.equal(call("bulkOp", ctxA, { dtuIds: ["d1"], op: "tier", value: "ultra" }).ok, false);
  });
});

describe("dtus.compareDtus", () => {
  it("diffs two DTUs and recommends merge for near-duplicates", () => {
    const a = { id: "d1", title: "Cognition basics", summary: "Intro to cognition", tier: "regular", tags: ["mind"], quality: 80 };
    const b = { id: "d2", title: "Cognition basics", summary: "Intro to cognition", tier: "regular", tags: ["mind"], quality: 70 };
    const r = call("compareDtus", ctxA, { a, b });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommendation, "merge");
    assert.ok(r.result.diff.find(d => d.field === "quality" && !d.same));
  });

  it("rejects when fewer than two DTUs provided", () => {
    assert.equal(call("compareDtus", ctxA, { a: { id: "d1" } }).ok, false);
  });
});

describe("dtus.mergeDtus", () => {
  it("merges two DTUs with union strategy", () => {
    const a = { id: "d1", title: "Cognition", summary: "A", tier: "regular", tags: ["mind"], quality: 80, citationCount: 3 };
    const b = { id: "d2", title: "Cognition v2", summary: "B", tier: "mega", tags: ["theory"], quality: 60, citationCount: 2 };
    const r = call("mergeDtus", ctxA, { a, b, strategy: "union" });
    assert.equal(r.ok, true);
    assert.equal(r.result.merged.tier, "mega");
    assert.equal(r.result.merged.tags.length, 2);
    assert.equal(r.result.merged.citationCount, 5);
    assert.equal(r.result.tombstone, "d2");
  });
});

describe("dtus saved views (persistent per-user)", () => {
  it("saves, lists, and deletes a view", () => {
    const saved = call("saveView", ctxA, { name: "High quality", filter: { minQuality: 80 } });
    assert.equal(saved.ok, true);
    const viewId = saved.result.view.id;

    const listed = call("listViews", ctxA, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.views[0].name, "High quality");

    const del = call("deleteView", ctxA, { viewId });
    assert.equal(del.ok, true);
    assert.equal(call("listViews", ctxA, {}).result.count, 0);
  });

  it("isolates views per user", () => {
    call("saveView", ctxA, { name: "A view", filter: {} });
    assert.equal(call("listViews", ctxB, {}).result.count, 0);
    assert.equal(call("listViews", ctxA, {}).result.count, 1);
  });

  it("rejects an unnamed view", () => {
    assert.equal(call("saveView", ctxA, { filter: {} }).ok, false);
  });
});

describe("dtus 4-layer editor", () => {
  it("seeds layers from a source DTU then persists edits", () => {
    const seeded = call("getLayers", ctxA, { dtuId: "d1", dtu: { id: "d1", summary: "Layer text", tags: ["mind"], tier: "regular" } });
    assert.equal(seeded.ok, true);
    assert.equal(seeded.result.source, "seed");
    assert.equal(seeded.result.layers.human, "Layer text");

    const upd = call("updateLayers", ctxA, { dtuId: "d1", layers: { human: "Edited", machine: '{"tags":["mind"]}' } });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.layers.human, "Edited");
    assert.equal(upd.result.warnings.length, 0);

    const reread = call("getLayers", ctxA, { dtuId: "d1" });
    assert.equal(reread.result.source, "overlay");
    assert.equal(reread.result.layers.human, "Edited");
  });

  it("warns on invalid JSON in the machine layer", () => {
    const r = call("updateLayers", ctxA, { dtuId: "d2", layers: { machine: "not json" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.warnings.includes("machine layer is not valid JSON"));
  });

  it("rejects missing dtuId", () => {
    assert.equal(call("getLayers", ctxA, {}).ok, false);
    assert.equal(call("updateLayers", ctxA, { layers: {} }).ok, false);
  });
});
