// server/tests/invariant-geometry.test.js
//
// Invariant Geometry Mapper (#20) — builds the co-violation graph from REAL
// invariant telemetry (we drive real assertSoft calls, then read the live
// metrics/log the module consumes). No mock data — the graph reflects actual
// recorded pass/fail events. Offline.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertSoft, resetInvariantMetrics } from "../emergent/atlas-invariants.js";
import { invariantGraph, bettiSummary } from "../lib/invariant-geometry.js";
import registerInvgeoMacros from "../domains/invgeo.js";

describe("Invariant Geometry Mapper (#20)", () => {
  beforeEach(() => resetInvariantMetrics());

  it("builds one node per invariant from real pass/fail counts", () => {
    assertSoft("inv_a", true);   // pass
    assertSoft("inv_a", false);  // fail
    assertSoft("inv_b", true);   // pass
    const g = invariantGraph();
    const a = g.nodes.find((n) => n.id === "inv_a");
    assert.equal(a.pass, 1);
    assert.equal(a.fail, 1);
    assert.equal(a.severity, 0.5, "real failure ratio");
  });

  it("draws a co-violation edge between invariants that fail close together", () => {
    assertSoft("inv_x", false);
    assertSoft("inv_y", false); // consecutive failures → edge x|y
    const g = invariantGraph({ windowMs: 10000 });
    const edge = g.edges.find((e) => (e.source === "inv_x" && e.target === "inv_y") || (e.source === "inv_y" && e.target === "inv_x"));
    assert.ok(edge, "co-violation edge exists");
    assert.ok(edge.weight >= 1);
  });

  it("the topological summary counts components and cycles correctly", () => {
    // triangle A-B-C → 1 component, 1 cycle
    const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const edges = [{ source: "A", target: "B" }, { source: "B", target: "C" }, { source: "A", target: "C" }];
    const s = bettiSummary(nodes, edges);
    assert.equal(s.components, 1);
    assert.equal(s.cycles, 1);
    // a lone edge + isolated node → 2 components, 0 cycles
    const s2 = bettiSummary([{ id: "A" }, { id: "B" }, { id: "C" }], [{ source: "A", target: "B" }]);
    assert.equal(s2.components, 2);
    assert.equal(s2.cycles, 0);
  });

  it("invgeo.graph macro returns the live graph", async () => {
    assertSoft("inv_live", false);
    const macros = new Map();
    registerInvgeoMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
    const r = await macros.get("invgeo.graph")({}, {});
    assert.equal(r.ok, true);
    assert.ok(r.nodes.some((n) => n.id === "inv_live"));
    assert.ok(r.summary && typeof r.summary.components === "number");
  });
});
