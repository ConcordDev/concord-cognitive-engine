// server/lib/compute/graph-algorithms.js
//
// Shared graph-algorithm primitives. The repo's only prior graph tooling was
// BFS in server/domains/graph.js — no union-find/disjoint-set, no Dijkstra, no
// MST, no max-flow, no matching anywhere in the tree (verified by audit before
// this file was added). This module starts closing that gap generally, not
// just for the QEC decoder that motivated it: `UnionFind` is a clean,
// dependency-free, general-purpose disjoint-set structure — path compression
// + union by rank, O(α(n)) amortized per operation — usable by any future
// caller that needs connectivity tracking (MST, clustering, percolation,
// component counting, decoder cluster-growth, etc).
//
// Keyed, not index-only: elements are arbitrary hashable values (numbers,
// strings, or anything usable as a Map key) rather than requiring callers to
// pre-map their domain onto [0, n). `makeSet` is implicit-on-first-use via
// `find`/`union` as well as explicit, so callers can grow the universe
// incrementally (the QEC decoder adds lattice-node ids to fresh clusters as
// its growth frontier expands).

/**
 * Disjoint-set / union-find over arbitrary keys, with path compression and
 * union by rank. All operations are amortized O(α(n)) — effectively constant
 * for any n that fits in memory (α is the inverse Ackermann function).
 */
export class UnionFind {
  constructor(elements = []) {
    this.parent = new Map();
    this.rank = new Map();
    this.count = 0; // number of distinct components
    for (const e of elements) this.makeSet(e);
  }

  /** Ensure `x` exists as its own singleton set. Idempotent. Returns x. */
  makeSet(x) {
    if (this.parent.has(x)) return x;
    this.parent.set(x, x);
    this.rank.set(x, 0);
    this.count++;
    return x;
  }

  /**
   * Find the representative (root) of x's set, with path compression.
   * Auto-creates x as a singleton set if it hasn't been seen before, so
   * `find` alone is always safe to call.
   */
  find(x) {
    if (!this.parent.has(x)) this.makeSet(x);
    // Walk to the root.
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    // Path compression: repoint every node on the walked path directly at root.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  /**
   * Union the sets containing x and y (union by rank). Returns true if a
   * merge happened, false if they were already in the same set.
   */
  union(x, y) {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;
    const rankX = this.rank.get(rx);
    const rankY = this.rank.get(ry);
    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
    this.count--;
    return true;
  }

  /** True iff x and y are currently in the same set. Auto-creates both. */
  connected(x, y) {
    return this.find(x) === this.find(y);
  }

  /** Number of distinct components currently tracked. O(1). */
  componentCount() {
    return this.count;
  }

  /** Total number of elements ever added (via makeSet, find, or union). */
  size() {
    return this.parent.size;
  }

  /** Map of root -> array of members, for inspection/debugging/consumers that need cluster contents. */
  components() {
    const out = new Map();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      if (!out.has(r)) out.set(r, []);
      out.get(r).push(x);
    }
    return out;
  }
}

/** Convenience factory mirroring the class constructor. */
export function createUnionFind(elements = []) {
  return new UnionFind(elements);
}
