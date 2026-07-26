// tests/depth/dtu-citation-graph-behavior.test.js — REAL behavioral tests for
// the `dtu.citation-graph` macro (V1.2 Wave A, "Society & Presence"
// capability 4 — "reputation + citation graph").
//
// Boots the real server (macroRuntime, per docs/DEPTH_FLEET_PLAN.md
// methodology) and seeds REAL rows directly into the live `royalty_lineage`
// + `dtus` tables — the same edge table economy/royalty-cascade.js's
// getAncestorChain()/getDescendants() (reused, not reimplemented, by this
// macro) and the `dtu.lineage`/`economy.royaltyFlow` macros already read.
//
// Coverage: a genuine multi-generation citation CHAIN (3 hops), not a
// single-hop stub; the { userId } aggregate mode across a user's authored
// corpus; the node/edge shape GraphView.tsx consumes (id/label/group/weight,
// source/target/kind:'citation'); and the honest empty-graph state for a
// DTU with no real lineage.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

function ensureUser(db, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(userId, userId, `${userId}@example.test`);
}

function ensureDtu(db, { id, creatorId, title }) {
  ensureUser(db, creatorId);
  db.prepare(`
    INSERT OR IGNORE INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', '[]', 'public', 'regular', datetime('now'), datetime('now'))
  `).run(id, creatorId, creatorId, title);
}

function ensureLineageEdge(db, { childId, parentId, creatorId, parentCreatorId }) {
  db.prepare(`
    INSERT OR IGNORE INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
    VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
  `).run(`lin_${childId}_${parentId}`, childId, parentId, creatorId, parentCreatorId);
}

describe("dtu.citation-graph — real royalty_lineage traversal (V1.2 Wave A)", () => {
  let runMacro, ctx, db;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("dtu-citation-graph"));
    db = ctx.db;
  });

  it("missing both dtuId and userId is an honest validation error", async () => {
    const r = await runMacro("dtu", "citation-graph", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_dtuId_or_userId");
  });

  it("a DTU with no real lineage returns an honest single-node graph, never a fabricated edge", async () => {
    ensureDtu(db, { id: "cg_lonely", creatorId: "cg_u_lonely", title: "Uncited Original" });
    const r = await runMacro("dtu", "citation-graph", { dtuId: "cg_lonely" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes.length, 1);
    assert.equal(r.result.nodes[0].id, "cg_lonely");
    assert.equal(r.result.nodes[0].group, "self");
    assert.deepEqual(r.result.edges, []);
    assert.equal(r.result.stats.edgeCount, 0);
  });

  it("a REAL multi-generation citation chain (3 hops) renders as an actual chain, not a center-only star", async () => {
    // Chain: cg_root cites cg_a; cg_a cites cg_b; cg_b cites cg_c (3 generations
    // of ancestors). A separate DTU cg_child cites cg_root (one descendant).
    ensureDtu(db, { id: "cg_root", creatorId: "cg_u_root", title: "Root Claim" });
    ensureDtu(db, { id: "cg_a", creatorId: "cg_u_a", title: "Gen-1 Source" });
    ensureDtu(db, { id: "cg_b", creatorId: "cg_u_b", title: "Gen-2 Source" });
    ensureDtu(db, { id: "cg_c", creatorId: "cg_u_c", title: "Gen-3 Source" });
    ensureDtu(db, { id: "cg_child", creatorId: "cg_u_child", title: "Derivative Work" });

    ensureLineageEdge(db, { childId: "cg_root", parentId: "cg_a", creatorId: "cg_u_root", parentCreatorId: "cg_u_a" });
    ensureLineageEdge(db, { childId: "cg_a", parentId: "cg_b", creatorId: "cg_u_a", parentCreatorId: "cg_u_b" });
    ensureLineageEdge(db, { childId: "cg_b", parentId: "cg_c", creatorId: "cg_u_b", parentCreatorId: "cg_u_c" });
    ensureLineageEdge(db, { childId: "cg_child", parentId: "cg_root", creatorId: "cg_u_child", parentCreatorId: "cg_u_root" });

    const r = await runMacro("dtu", "citation-graph", { dtuId: "cg_root" }, ctx);
    assert.equal(r.ok, true);

    const nodeIds = r.result.nodes.map((n) => n.id).sort();
    assert.deepEqual(nodeIds, ["cg_a", "cg_b", "cg_c", "cg_child", "cg_root"].sort());

    // Real titles surfaced as labels — not fabricated / not bare ids.
    const byId = Object.fromEntries(r.result.nodes.map((n) => [n.id, n]));
    assert.equal(byId.cg_root.label, "Root Claim");
    assert.equal(byId.cg_c.label, "Gen-3 Source");
    assert.equal(byId.cg_root.group, "self");
    assert.equal(byId.cg_a.group, "cited");
    assert.equal(byId.cg_c.group, "cited");

    // The genuine multi-hop chain: 4 real edges, each a citation
    // (child -> parent), read back off royalty_lineage — NOT a 4-spoke star
    // fanning out of cg_root alone (a single-hop stub would only ever
    // produce edges with cg_root as source or target).
    assert.equal(r.result.edges.length, 4);
    const edgeSet = new Set(r.result.edges.map((e) => `${e.source}->${e.target}`));
    assert.ok(edgeSet.has("cg_root->cg_a"));
    assert.ok(edgeSet.has("cg_a->cg_b")); // neither endpoint is the requested dtuId — proves real chain topology
    assert.ok(edgeSet.has("cg_b->cg_c")); // ditto — generation-3 hop
    assert.ok(edgeSet.has("cg_child->cg_root"));
    for (const e of r.result.edges) assert.equal(e.kind, "citation");

    assert.equal(r.result.stats.nodeCount, 5);
    assert.equal(r.result.stats.edgeCount, 4);
  });

  it("{ userId } mode unions the citation neighborhoods of every DTU that user authored", async () => {
    ensureDtu(db, { id: "cg_owned_1", creatorId: "cg_u_owner", title: "Owned Work 1" });
    ensureDtu(db, { id: "cg_owned_2", creatorId: "cg_u_owner", title: "Owned Work 2" });
    ensureDtu(db, { id: "cg_external", creatorId: "cg_u_other", title: "External Source" });
    ensureLineageEdge(db, { childId: "cg_owned_1", parentId: "cg_external", creatorId: "cg_u_owner", parentCreatorId: "cg_u_other" });

    const r = await runMacro("dtu", "citation-graph", { userId: "cg_u_owner" }, ctx);
    assert.equal(r.ok, true);
    const nodeIds = r.result.nodes.map((n) => n.id).sort();
    assert.deepEqual(nodeIds, ["cg_external", "cg_owned_1", "cg_owned_2"].sort());

    const byId = Object.fromEntries(r.result.nodes.map((n) => [n.id, n]));
    assert.equal(byId.cg_owned_1.group, "self");
    assert.equal(byId.cg_owned_2.group, "self");
    assert.equal(byId.cg_external.group, "cited");

    assert.equal(r.result.edges.length, 1);
    assert.equal(r.result.edges[0].source, "cg_owned_1");
    assert.equal(r.result.edges[0].target, "cg_external");
    assert.equal(r.result.edges[0].kind, "citation");
  });

  it("a userId with no authored DTUs returns an honest empty graph", async () => {
    const r = await runMacro("dtu", "citation-graph", { userId: "cg_u_ghost_nobody_authored_anything" }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.nodes, []);
    assert.deepEqual(r.result.edges, []);
  });
});
