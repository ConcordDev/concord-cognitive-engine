// Engine N3 — network/graph theory (viability over a topology). Pins connected
// components + giant-component percolation, degree centrality / hub finding,
// and the two cascade models (independent-cascade contagion + linear-threshold
// adoption) the disease/gossip/contagion systems read.
//
// Run: node --test tests/network-graph.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  connectedComponents, giantComponentSize, degreeCentrality, topHub,
  independentCascade, linearThresholdCascade,
} from "../lib/network/graph.js";

// a 4-node cluster + a disjoint 2-node pair
const adj = {
  a: ["b", "c"], b: ["a", "c", "d"], c: ["a", "b"], d: ["b"],
  x: ["y"], y: ["x"],
};

describe("components + percolation", () => {
  it("finds the two disjoint components", () => {
    const comps = connectedComponents(adj);
    assert.equal(comps.length, 2);
  });
  it("giant component is the 4-node cluster", () => {
    assert.equal(giantComponentSize(adj), 4);
  });
});

describe("centrality", () => {
  it("b is the hub (degree 3)", () => {
    assert.equal(degreeCentrality(adj).b, 3);
    assert.equal(topHub(adj).node, "b");
    assert.equal(topHub(adj).degree, 3);
  });
});

describe("independent-cascade contagion", () => {
  it("prob=1 floods the seed's component, not the disjoint one", () => {
    const r = independentCascade(adj, ["a"], 1, () => 0); // rng 0 < 1 → always infect
    assert.ok(["a", "b", "c", "d"].every((n) => r.activated.includes(n)));
    assert.ok(!r.activated.includes("x")); // disconnected — never reached
  });
  it("prob=0 activates only the seeds", () => {
    const r = independentCascade(adj, ["a"], 0, () => 0.9);
    assert.deepEqual(r.activated.sort(), ["a"]);
  });
});

describe("linear-threshold adoption", () => {
  it("a low threshold floods the component", () => {
    const r = linearThresholdCascade(adj, ["a", "b"], 0.34); // c has 2/2 active → flips, d 1/1 → flips
    assert.ok(["a", "b", "c", "d"].every((n) => r.activated.includes(n)));
  });
  it("a high threshold stalls (no node reaches it)", () => {
    const r = linearThresholdCascade(adj, ["a"], 0.99);
    // only a is active; c has 1/2 active (0.5 < 0.99) → no spread
    assert.deepEqual(r.activated.sort(), ["a"]);
  });
});
