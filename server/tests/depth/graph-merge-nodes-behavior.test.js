// tests/depth/graph-merge-nodes-behavior.test.js — REAL behavioral tests for
// graph.map-merge-nodes: the honest replacement for the ungrounded
// graph.merge sandbox macro (server.js), operating on the real, persisted
// mind-map substrate (server/domains/graph.js `m.nodes`/`m.edges` via
// `findMap`). Every lensRun("graph", "map-merge-nodes", …) call literally
// names the macro, matching the harness's LITERAL_INVOKE_RE credit shape.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("graph.map-merge-nodes — edge re-pointing + dedup + node removal", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("graph-merge"); });

  // Build: central -> A, central -> B, central -> C, A -> C (so merging A
  // into B produces a duplicate edge central->B (via re-pointed central->A)
  // and a re-pointed B->C-shaped edge from A->C).
  async function buildFixture(title) {
    const map = await lensRun("graph", "map-create", { params: { title } }, ctx);
    const mapId = map.result.map.id;
    const centralId = map.result.map.nodes[0].id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A", parentId: centralId } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "B", parentId: centralId } }, ctx);
    const c = await lensRun("graph", "node-add", { params: { mapId, label: "C", parentId: centralId } }, ctx);
    const aId = a.result.node.id;
    const bId = b.result.node.id;
    const cId = c.result.node.id;
    // A -> C, so after merging A into B we'd get a second central->B edge is
    // NOT created (central->A repoints to central->B, and central->B already
    // exists as a *separate* edge object from node-add's parentId branch) —
    // that's the duplicate case under test.
    await lensRun("graph", "edge-add", { params: { mapId, fromNodeId: aId, toNodeId: cId } }, ctx);
    return { mapId, centralId, aId, bId, cId };
  }

  it("merges A into B (default keepId = targetNodeId): B survives, A is removed", async () => {
    const { mapId, aId, bId } = await buildFixture("MergeBasic");
    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId, sourceNodeId: aId, targetNodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.keptNodeId, bId);
    assert.equal(r.result.removedNodeId, aId);

    const detail = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    const ids = detail.result.map.nodes.map((n) => n.id);
    assert.ok(ids.includes(bId));
    assert.equal(ids.includes(aId), false);
  });

  it("re-points ALL of the losing node's edges onto the surviving node — none are silently dropped", async () => {
    const { mapId, centralId, aId, bId, cId } = await buildFixture("MergeRepoint");
    // Before merge: central->A, central->B, central->C, A->C (4 edges).
    const before = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    assert.equal(before.result.map.edges.length, 4);

    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId, sourceNodeId: aId, targetNodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    // A had 2 edges touching it: central->A and A->C. Both get re-pointed.
    assert.equal(r.result.edgesRepointed, 2);

    const after = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    const edges = after.result.map.edges;
    // The A->C edge must now point from B to C — not vanish.
    assert.ok(edges.some((e) => e.from === bId && e.to === cId), "B->C must exist after re-pointing A->C");
    // No edge should still reference the removed node A.
    assert.ok(!edges.some((e) => e.from === aId || e.to === aId));
    // central->C must be untouched.
    assert.ok(edges.some((e) => e.from === centralId && e.to === cId));
  });

  it("deduplicates edges that collide after re-pointing (same directed from/to)", async () => {
    const { mapId, centralId, aId, bId } = await buildFixture("MergeDedup");
    // central->A and central->B both exist. Re-pointing central->A onto B
    // produces a SECOND central->B edge, which must be deduplicated down to one.
    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId, sourceNodeId: aId, targetNodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.duplicateEdgesRemoved, 1);

    const detail = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    const centralToB = detail.result.map.edges.filter((e) => e.from === centralId && e.to === bId);
    assert.equal(centralToB.length, 1, "only one central->B edge should remain, not a parallel duplicate");
  });

  it("drops the self-loop created by re-pointing the direct edge between the two merged nodes", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "SelfLoop" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "B" } }, ctx);
    const aId = a.result.node.id;
    const bId = b.result.node.id;
    await lensRun("graph", "edge-add", { params: { mapId, fromNodeId: aId, toNodeId: bId } }, ctx);

    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId, sourceNodeId: aId, targetNodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.selfLoopsDropped, 1);

    const detail = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    assert.equal(detail.result.map.edges.some((e) => e.from === e.to), false);
  });

  it("honestly folds the losing node's notes/dtuId into the survivor instead of discarding them", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "DataFold" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "Alpha", notes: "alpha detail" } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "Beta", notes: "beta detail" } }, ctx);
    const aId = a.result.node.id;
    const bId = b.result.node.id;
    await lensRun("graph", "link-node-dtu", { params: { mapId, nodeId: aId, dtuId: "dtu_alpha_only" } }, ctx);

    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId, sourceNodeId: aId, targetNodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    // survivor keeps its own notes AND records the loser's, not silently dropped.
    assert.ok(r.result.node.notes.includes("beta detail"));
    assert.ok(r.result.node.notes.includes("alpha detail"));
    assert.ok(r.result.node.notes.includes("Alpha")); // provenance label in the fold
    // survivor had no dtuId of its own — it inherits the loser's real DTU link.
    assert.equal(r.result.node.dtuId, "dtu_alpha_only");
    // provenance is explicitly recorded, not just implied.
    assert.ok(r.result.node.mergedFrom.some((x) => x.id === aId && x.label === "Alpha"));
  });

  it("transfers the central flag onto the survivor if the losing node was the map's central node", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "CentralMerge" } }, ctx);
    const mapId = map.result.map.id;
    const centralId = map.result.map.nodes[0].id; // this is the central node
    const leaf = await lensRun("graph", "node-add", { params: { mapId, label: "Leaf", parentId: centralId } }, ctx);
    const leafId = leaf.result.node.id;

    // Merge the central node INTO the leaf (leaf survives as keepId=targetNodeId default).
    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: centralId, targetNodeId: leafId },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.node.central, true, "centrality must transfer so the map doesn't lose its central node");
  });

  it("keepId lets the caller pick the source as the survivor instead of the default target", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "KeepSource" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "B" } }, ctx);
    const aId = a.result.node.id;
    const bId = b.result.node.id;

    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: aId, targetNodeId: bId, keepId: aId },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.keptNodeId, aId);
    assert.equal(r.result.removedNodeId, bId);
  });

  it("rejects an unrecognized keepId rather than silently defaulting", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "BadKeep" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "B" } }, ctx);
    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: a.result.node.id, targetNodeId: b.result.node.id, keepId: "nope_not_either" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("keepId"));
  });

  it("rejects self-merge (sourceNodeId === targetNodeId)", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "SelfMerge" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: a.result.node.id, targetNodeId: a.result.node.id },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("itself"));
  });

  it("rejects a bogus mapId", async () => {
    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId: "nope_does_not_exist", sourceNodeId: "nd_x", targetNodeId: "nd_y" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("map not found"));
  });

  it("rejects a bogus sourceNodeId/targetNodeId on a real map", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "BogusNodes" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: a.result.node.id, targetNodeId: "nd_ghost" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("must exist"));
  });

  it("rejects missing sourceNodeId/targetNodeId params", async () => {
    const map = await lensRun("graph", "map-create", { params: { title: "MissingParams" } }, ctx);
    const r = await lensRun("graph", "map-merge-nodes", { params: { mapId: map.result.map.id } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("required"));
  });

  it("per-user isolation: a user cannot merge nodes on another user's map", async () => {
    const ctxOther = await depthCtx("graph-merge-other-user");
    const map = await lensRun("graph", "map-create", { params: { title: "OwnedByCtx" } }, ctx);
    const mapId = map.result.map.id;
    const a = await lensRun("graph", "node-add", { params: { mapId, label: "A" } }, ctx);
    const b = await lensRun("graph", "node-add", { params: { mapId, label: "B" } }, ctx);

    const r = await lensRun("graph", "map-merge-nodes", {
      params: { mapId, sourceNodeId: a.result.node.id, targetNodeId: b.result.node.id },
    }, ctxOther);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("map not found"));

    // Original owner's map is untouched — both nodes still present.
    const detail = await lensRun("graph", "map-detail", { params: { id: mapId } }, ctx);
    assert.equal(detail.result.map.nodes.length, 3); // central + A + B
  });
});
