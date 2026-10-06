// The graph macros read GRAPH_INDEX, which holds every DTU, and the graph
// domain is public-read. A private DTU must only appear in graph results for
// its owner; shared lattice DTUs stay visible to everyone.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("graph macros respect DTU privacy", () => {
  let runMacro, STATE, alice, bob;
  const PUB = "dtu_graphvis_public";
  const PRIV = "dtu_graphvis_private";

  before(async () => {
    ({ runMacro, STATE, ctx: alice } = await macroRuntime("graphvis-alice"));
    ({ ctx: bob } = await macroRuntime("graphvis-bob"));
    const now = new Date().toISOString();
    STATE.dtus.set(PUB, { id: PUB, title: "Shared lattice note", tier: "regular", tags: ["graphvis"], lineage: { parents: [], children: [PRIV] }, createdAt: now });
    STATE.dtus.set(PRIV, { id: PRIV, title: "Alice private plan", tier: "regular", tags: ["graphvis"], visibility: "private", ownerId: "graphvis-alice", lineage: { parents: [PUB], children: [] }, createdAt: now });
    // autotag.apply marks GRAPH_INDEX dirty so the next read rebuilds it.
    await runMacro("autotag", "apply", { dtuId: PUB, tags: ["graphvis"] }, alice);
  });
  after(() => { STATE.dtus.delete(PUB); STATE.dtus.delete(PRIV); });

  const ids = (r) => (r.nodes || []).map((n) => n.id);

  it("forceGraph around a shared node: owner sees the private child, others don't", async () => {
    const a = await runMacro("graph", "forceGraph", { centerNode: PUB, depth: 1, maxNodes: 50 }, alice);
    const b = await runMacro("graph", "forceGraph", { centerNode: PUB, depth: 1, maxNodes: 50 }, bob);
    assert.ok(ids(a).includes(PRIV));
    assert.ok(ids(b).includes(PUB));
    assert.equal(ids(b).includes(PRIV), false);
    assert.equal(b.links.some((l) => l.source === PRIV || l.target === PRIV), false);
  });

  it("visualData overview hides the private node from others", async () => {
    const b = await runMacro("graph", "visualData", { limit: 100000 }, bob);
    assert.equal(ids(b).includes(PRIV), false);
    const a = await runMacro("graph", "visualData", { limit: 100000 }, alice);
    assert.ok(ids(a).includes(PRIV));
  });

  it("neighbors and edges don't reveal the private node to others", async () => {
    const n = await runMacro("graph", "neighbors", { id: PUB }, bob);
    assert.equal(n.neighbors.some((x) => x.id === PRIV), false);
    assert.equal((await runMacro("graph", "neighbors", { id: PRIV }, bob)).ok, false);
    const e = await runMacro("graph", "edges", { limit: 1000 }, bob);
    assert.equal(e.edges.some((x) => x.source === PRIV || x.target === PRIV), false);
  });

  it("search finds shared nodes by title and hides private ones from others", async () => {
    const b = await runMacro("graph", "search", { q: "lattice note" }, bob);
    assert.ok(b.results.some((x) => x.id === PUB));
    assert.equal((await runMacro("graph", "search", { q: "alice private" }, bob)).results.length, 0);
    const a = await runMacro("graph", "search", { q: "alice private" }, alice);
    assert.ok(a.results.some((x) => x.id === PRIV));
    assert.equal((await runMacro("graph", "search", { q: "a" }, alice)).results.length, 0);
  });

  it("a child that only names its parent is reachable from the parent", async () => {
    const KID = "dtu_graphvis_kid";
    // dtu.create sets only the child's lineage.parents; the parent's children stay unset.
    STATE.dtus.set(KID, { id: KID, title: "Kid note", tier: "regular", tags: [], lineage: { parents: [PUB] }, createdAt: new Date().toISOString() });
    await runMacro("autotag", "apply", { dtuId: PUB, tags: ["graphvis"] }, alice); // mark index dirty
    const r = await runMacro("graph", "forceGraph", { centerNode: PUB, depth: 1, maxNodes: 50 }, bob);
    assert.ok(ids(r).includes(KID));
    assert.ok(r.links.some((l) => l.source === PUB && l.target === KID));
    STATE.dtus.delete(KID);
  });

  it("DTUs written after the index was built show up without a manual dirty flag", async () => {
    const LATE = "dtu_graphvis_late";
    await runMacro("graph", "visualData", { limit: 10 }, bob); // build now
    STATE.dtus.set(LATE, { id: LATE, title: "Late arrival", tier: "regular", tags: [], lineage: { parents: [] }, createdAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 5100)); // rebuild throttle window
    const r = await runMacro("graph", "search", { q: "late arrival" }, bob);
    assert.ok(r.results.some((x) => x.id === LATE));
    STATE.dtus.delete(LATE);
  });

  it("query results drop the private node for others", async () => {
    const b = await runMacro("graph", "query", { dsl: `descendants of ${PUB}` }, bob);
    assert.equal(b.results.some((x) => x.id === PRIV), false);
    const a = await runMacro("graph", "query", { dsl: `descendants of ${PUB}` }, alice);
    assert.ok(a.results.some((x) => x.id === PRIV));
  });
});
