// server/tests/graph-algorithms.test.js
// Pins server/lib/compute/graph-algorithms.js — the UnionFind disjoint-set
// primitive (path compression + union by rank). Run: node --test tests/graph-algorithms.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnionFind, createUnionFind } from "../lib/compute/graph-algorithms.js";

// deterministic LCG, same convention as tests/probability-stochastic.test.js
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

describe("UnionFind — basics", () => {
  it("disjoint sets stay disjoint until unioned", () => {
    const uf = new UnionFind([1, 2, 3, 4, 5]);
    assert.equal(uf.connected(1, 2), false);
    assert.equal(uf.connected(3, 4), false);
    assert.equal(uf.componentCount(), 5);
    uf.union(1, 2);
    assert.equal(uf.connected(1, 2), true);
    assert.equal(uf.connected(1, 3), false);
    assert.equal(uf.connected(3, 4), false);
    assert.equal(uf.componentCount(), 4);
  });

  it("transitive union: a-b, b-c ⇒ a connected to c", () => {
    const uf = new UnionFind();
    uf.union("a", "b");
    uf.union("b", "c");
    assert.equal(uf.connected("a", "c"), true);
    assert.equal(uf.connected("a", "b"), true);
    assert.equal(uf.connected("b", "c"), true);
    uf.union("x", "y");
    assert.equal(uf.connected("a", "x"), false);
  });

  it("componentCount decrements only on a genuine merge, never on a redundant union", () => {
    const uf = new UnionFind([1, 2, 3]);
    assert.equal(uf.componentCount(), 3);
    assert.equal(uf.union(1, 2), true);
    assert.equal(uf.componentCount(), 2);
    assert.equal(uf.union(1, 2), false); // already same set
    assert.equal(uf.componentCount(), 2);
    assert.equal(uf.union(2, 1), false); // still already same set, either order
    assert.equal(uf.componentCount(), 2);
    assert.equal(uf.union(2, 3), true);
    assert.equal(uf.componentCount(), 1);
  });

  it("makeSet is idempotent and find auto-creates unseen elements", () => {
    const uf = new UnionFind();
    uf.makeSet(1);
    uf.makeSet(1);
    assert.equal(uf.size(), 1);
    assert.equal(uf.find(1), 1);
    // find on a never-seen element auto-creates a singleton
    assert.equal(uf.find(99), 99);
    assert.equal(uf.size(), 2);
  });

  it("components() groups members by root correctly", () => {
    const uf = new UnionFind([1, 2, 3, 4, 5]);
    uf.union(1, 2);
    uf.union(2, 3);
    uf.union(4, 5);
    const comps = uf.components();
    assert.equal(comps.size, 2);
    const sizes = [...comps.values()].map((arr) => arr.length).sort();
    assert.deepEqual(sizes, [2, 3]);
    // every member of {1,2,3} shares a root
    const rootOf1 = uf.find(1);
    for (const m of [1, 2, 3]) assert.equal(uf.find(m), rootOf1);
  });
});

describe("UnionFind — path compression preserves semantics", () => {
  it("compresses a multi-level chain to point directly at the true root, without changing connectivity", () => {
    const uf = new UnionFind([1, 2, 3, 4]);
    uf.union(1, 2); // rank tie: parent[2] = 1, rank[1] = 1
    uf.union(3, 4); // rank tie: parent[4] = 3, rank[3] = 1
    uf.union(2, 3); // find(2)=1 (rank1), find(3)=3 (rank1) tie: parent[3] = 1, rank[1] = 2
    // Node 4's pointer was never touched by that last union (only roots 2→1 and
    // 3 were resolved) — it should still be pointing at the old root 3, a
    // genuine multi-level chain: 4 -> 3 -> 1.
    assert.equal(uf.parent.get(4), 3);
    const root = uf.find(4);
    assert.equal(root, 1);
    // Path compression must have flattened node 4 straight to the true root.
    assert.equal(uf.parent.get(4), 1);
    // Semantics unchanged: everything is still one connected component.
    assert.equal(uf.connected(1, 4), true);
    assert.equal(uf.connected(2, 4), true);
    assert.equal(uf.connected(3, 4), true);
    assert.equal(uf.componentCount(), 1);
  });

  it("repeated find() calls are stable and idempotent after compression", () => {
    const uf = new UnionFind();
    for (let i = 0; i < 50; i++) uf.union(i, i + 1); // long chain 0-1-2-...-50
    const root = uf.find(0);
    for (let i = 0; i <= 50; i++) {
      assert.equal(uf.find(i), root);
      // after visiting, every node on the original chain should now be flat
      assert.equal(uf.parent.get(i), root);
    }
    assert.equal(uf.componentCount(), 1);
  });
});

describe("UnionFind — randomized differential test vs. a naive O(n²) reference", () => {
  // Naive reference disjoint-set: relabels every member of one group to the
  // other's group id on every union — O(n) per union, O(n²) total — but is
  // transparently correct, giving us an independent oracle.
  class NaiveDSU {
    constructor(n) {
      this.group = new Array(n).fill(0).map((_, i) => i);
    }
    union(a, b) {
      const ga = this.group[a], gb = this.group[b];
      if (ga === gb) return;
      for (let i = 0; i < this.group.length; i++) {
        if (this.group[i] === gb) this.group[i] = ga;
      }
    }
    connected(a, b) {
      return this.group[a] === this.group[b];
    }
    componentCount() {
      return new Set(this.group).size;
    }
  }

  it("agrees with the naive reference over many random operation sequences", () => {
    const n = 60;
    const rng = lcg(20260724);
    const randInt = (max) => Math.floor(rng() * max);

    for (let trial = 0; trial < 8; trial++) {
      const uf = new UnionFind(Array.from({ length: n }, (_, i) => i));
      const naive = new NaiveDSU(n);
      for (let op = 0; op < 400; op++) {
        const a = randInt(n);
        const b = randInt(n);
        const kind = rng();
        if (kind < 0.6) {
          uf.union(a, b);
          naive.union(a, b);
        } else if (kind < 0.9) {
          assert.equal(uf.connected(a, b), naive.connected(a, b), `mismatch at trial ${trial} op ${op} for (${a},${b})`);
        } else {
          assert.equal(uf.componentCount(), naive.componentCount(), `component count mismatch at trial ${trial} op ${op}`);
        }
      }
      // final full pairwise sweep for this trial
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          assert.equal(uf.connected(a, b), naive.connected(a, b), `final mismatch trial ${trial} (${a},${b})`);
        }
      }
      assert.equal(uf.componentCount(), naive.componentCount());
    }
  });
});

describe("createUnionFind factory", () => {
  it("mirrors the class constructor", () => {
    const uf = createUnionFind([1, 2, 3]);
    assert.ok(uf instanceof UnionFind);
    assert.equal(uf.componentCount(), 3);
  });
});
