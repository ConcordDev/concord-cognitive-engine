// Wave 5 #11 — adjacent-feasibility topology. Pins "worlds connect through a
// shared core": worlds are adjacent iff their habitable-biome sets overlap, and
// reachability is the connected component of that graph. Composes #24 biome +
// the N3 network core. Pure.
//
// Run: node --test tests/viability/world-topology.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  worldsAdjacent,
  buildWorldAdjacency,
  reachableClusters,
  worldsReachableFrom,
} from "../../lib/viability/world-topology.js";

const ARCTIC = { temperature: -30, humidity: 40 }; // habitable: {arctic}
const TEMPERATE = { temperature: 18, humidity: 60 }; // {temperate, cave, tropical}
const TROPICAL = { temperature: 35, humidity: 70 };  // {tropical, aquatic, volcanic}

describe("worldsAdjacent", () => {
  it("worlds sharing a habitable biome are adjacent; disjoint ones are not", () => {
    assert.equal(worldsAdjacent(TEMPERATE, TROPICAL), true); // both share 'tropical'
    assert.equal(worldsAdjacent(ARCTIC, TROPICAL), false);   // {arctic} ∩ {tropical,…} = ∅
  });
  it("a world with no habitable core is adjacent to nothing", () => {
    assert.equal(worldsAdjacent({ temperature: 300 }, TEMPERATE), false);
  });
});

describe("reachability topology", () => {
  const worlds = { arctica: ARCTIC, midgard: TEMPERATE, junglia: TROPICAL };

  it("builds a symmetric adjacency graph", () => {
    const adj = buildWorldAdjacency(worlds);
    assert.deepEqual(adj.midgard, ["junglia"]);
    assert.deepEqual(adj.junglia, ["midgard"]);
    assert.deepEqual(adj.arctica, []); // isolated
  });

  it("reachable clusters separate the isolated world from the connected pair", () => {
    const clusters = reachableClusters(worlds).map((c) => c.slice().sort());
    assert.equal(clusters.length, 2);
    assert.ok(clusters.some((c) => c.length === 1 && c[0] === "arctica"));
    assert.ok(clusters.some((c) => c.length === 2 && c.includes("midgard") && c.includes("junglia")));
  });

  it("worldsReachableFrom returns the rest of the origin's component", () => {
    assert.deepEqual(worldsReachableFrom(worlds, "midgard"), ["junglia"]);
    assert.deepEqual(worldsReachableFrom(worlds, "arctica"), []); // isolated
    assert.deepEqual(worldsReachableFrom(worlds, "nowhere"), []); // unknown origin
  });
});
