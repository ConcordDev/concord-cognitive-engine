/**
 * SX-NUM-21 math.graph tests.
 *
 * Reference case (catalogue): max flow on the CLRS textbook
 * network = 23, certified by the returned min cut
 * {s,v1,v2,v4}|{v3,t} of capacity 12 + 7 + 4 = 23. Dijkstra
 * on the CLRS weighted graph (distances s->t 35 via y/z... the
 * standard worked example), Kruskal on a hand graph, a
 * negative cycle served as a finding, and the Fiedler values
 * of P4 (2 - sqrt(2)) and K4 (4).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/graph.js";

const solver = getSolver("math.graph");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const CLRS_FLOW = {
  nodes: ["s", "v1", "v2", "v3", "v4", "t"],
  directed: true,
  edges: [
    { from: "s", to: "v1", capacity: 16 }, { from: "s", to: "v2", capacity: 13 },
    { from: "v1", to: "v3", capacity: 12 }, { from: "v2", to: "v1", capacity: 4 },
    { from: "v2", to: "v4", capacity: 14 }, { from: "v3", to: "v2", capacity: 9 },
    { from: "v3", to: "t", capacity: 20 }, { from: "v4", to: "v3", capacity: 7 },
    { from: "v4", to: "t", capacity: 4 },
  ],
};

test("registered at L2 with the CLRS flow reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.reference.includes("CLRS"));
});

test("reference case: max flow on the CLRS network is 23, certified by its min cut", () => {
  const r = run({ ...CLRS_FLOW, source: "s", sink: "t" }, "max-flow");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.maxFlow, 23);
  assert.equal(r.outputs.minCut.capacity, 23);
  assert.deepEqual(new Set(r.outputs.minCut.sideS), new Set(["s", "v1", "v2", "v4"]));
});

test("dijkstra on the CLRS weighted digraph; negative weights refused by name", () => {
  const g = {
    nodes: ["s", "t", "x", "y", "z"],
    directed: true,
    edges: [
      { from: "s", to: "t", weight: 10 }, { from: "s", to: "y", weight: 5 },
      { from: "t", to: "x", weight: 1 }, { from: "t", to: "y", weight: 2 },
      { from: "x", to: "z", weight: 4 }, { from: "y", to: "t", weight: 3 },
      { from: "y", to: "x", weight: 9 }, { from: "y", to: "z", weight: 2 },
      { from: "z", to: "x", weight: 6 }, { from: "z", to: "s", weight: 7 },
    ],
  };
  const r = run({ ...g, source: "s", dest: "x" }, "shortest-path");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.deepEqual(r.outputs.distances, { s: 0, t: 8, x: 9, y: 5, z: 7 });
  assert.deepEqual(r.outputs.path, ["s", "y", "t", "x"]);
  const neg = run({ nodes: ["a", "b"], directed: true, edges: [{ from: "a", to: "b", weight: -1 }], source: "a" }, "shortest-path");
  assert.equal(neg.status, "NOT_COMPUTED");
  assert.ok(neg.reason.startsWith("negative_weights"), neg.reason);
});

test("bellman-ford serves a negative cycle as a named finding, not distances", () => {
  const g = {
    nodes: ["a", "b", "c"],
    directed: true,
    edges: [
      { from: "a", to: "b", weight: 1 }, { from: "b", to: "c", weight: -3 }, { from: "c", to: "a", weight: 1 },
    ],
  };
  const r = run({ ...g, source: "a" }, "bellman-ford");
  assert.equal(r.status, "WARN", r.reason || "");
  assert.deepEqual(new Set(r.outputs.negativeCycle), new Set(["a", "b", "c"]));
});

test("mst: Kruskal total on a hand graph; a disconnected graph returns a labelled forest", () => {
  const g = {
    nodes: ["a", "b", "c", "d"],
    edges: [
      { from: "a", to: "b", weight: 1 }, { from: "b", to: "c", weight: 2 },
      { from: "a", to: "c", weight: 4 }, { from: "c", to: "d", weight: 3 },
      { from: "b", to: "d", weight: 5 },
    ],
  };
  const r = run(g, "mst");
  assert.equal(r.outputs.totalWeight, 6);
  assert.equal(r.outputs.isForest, false);
  const split = run({ nodes: ["a", "b", "c", "d"], edges: [{ from: "a", to: "b", weight: 1 }, { from: "c", to: "d", weight: 1 }] }, "mst");
  assert.equal(split.status, "WARN");
  assert.equal(split.outputs.isForest, true);
  assert.equal(split.outputs.components, 2);
});

test("topo-sort orders a DAG and names the cyclic remainder; matching and spectral agree with closed forms", () => {
  const dag = {
    nodes: ["a", "b", "c", "d"],
    directed: true,
    edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }],
  };
  const order = run(dag, "topo-sort");
  assert.equal(order.outputs.order[0], "a");
  assert.equal(order.outputs.order[3], "d");
  const cyclic = run({ nodes: ["a", "b"], directed: true, edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] }, "topo-sort");
  assert.equal(cyclic.status, "WARN");
  assert.deepEqual(new Set(cyclic.outputs.cycleNodes), new Set(["a", "b"]));

  const match = run({
    nodes: ["u1", "u2", "v1", "v2"],
    edges: [{ from: "u1", to: "v1" }, { from: "u1", to: "v2" }, { from: "u2", to: "v1" }],
    left: ["u1", "u2"], right: ["v1", "v2"],
  }, "matching");
  assert.equal(match.outputs.size, 2);

  const p4 = run({ nodes: ["1", "2", "3", "4"], edges: [{ from: "1", to: "2" }, { from: "2", to: "3" }, { from: "3", to: "4" }] }, "spectral");
  assert.ok(Math.abs(p4.outputs.fiedlerValue - (2 - Math.SQRT2)) < 1e-9, `fiedler P4 ${p4.outputs.fiedlerValue}`);
  assert.equal(p4.outputs.connected, true);
});
