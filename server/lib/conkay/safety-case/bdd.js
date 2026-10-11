// server/lib/conkay/safety-case/bdd.js
//
// Reduced ordered binary decision diagrams (Bryant 1986) for fault-tree and
// event-tree logic. A BDD represents the Boolean function exactly, so the
// probability of the top event is exact for independent basic events (no
// rare-event or min-cut-upper-bound approximation), events shared between
// trees are handled correctly, and NOT (an event-tree success branch) is
// allowed. Deterministic: the variable order is the depth-first order in
// which basic events are first met from the roots, in input order.
//
// Node ids: 0 = false, 1 = true, others index into this.nodes ({ v, lo, hi }).

export const BDD_VERSION = "1.0.0";
const MAX_NODES = 2_000_000;

export class Bdd {
  constructor(order) {
    this.order = [...order];
    this.level = new Map(this.order.map((v, i) => [v, i]));
    this.nodes = [null, null];
    this.unique = new Map();
    this.cache = new Map();
  }

  var(name) {
    const i = this.level.get(name);
    if (i == null) throw new Error(`BDD: ${name} is not in the variable order`);
    return this.mk(i, 0, 1);
  }

  mk(v, lo, hi) {
    if (lo === hi) return lo;
    const k = `${v},${lo},${hi}`;
    const hit = this.unique.get(k);
    if (hit != null) return hit;
    if (this.nodes.length >= MAX_NODES) throw new Error(`BDD exceeds ${MAX_NODES} nodes`);
    this.nodes.push({ v, lo, hi });
    const id = this.nodes.length - 1;
    this.unique.set(k, id);
    return id;
  }

  top(u) { return u < 2 ? Infinity : this.nodes[u].v; }

  apply(op, a, b) {
    if (op === "and") { if (a === 0 || b === 0) return 0; if (a === 1) return b; if (b === 1) return a; if (a === b) return a; }
    else if (op === "or") { if (a === 1 || b === 1) return 1; if (a === 0) return b; if (b === 0) return a; if (a === b) return a; }
    else throw new Error(`BDD: unknown op ${op}`);
    if (a > b) [a, b] = [b, a];
    const k = `${op},${a},${b}`;
    const hit = this.cache.get(k);
    if (hit != null) return hit;
    const va = this.top(a), vb = this.top(b), v = Math.min(va, vb);
    const [a0, a1] = va === v ? [this.nodes[a].lo, this.nodes[a].hi] : [a, a];
    const [b0, b1] = vb === v ? [this.nodes[b].lo, this.nodes[b].hi] : [b, b];
    const r = this.mk(v, this.apply(op, a0, b0), this.apply(op, a1, b1));
    this.cache.set(k, r);
    return r;
  }

  not(a) {
    if (a < 2) return 1 - a;
    const k = `not,${a}`;
    const hit = this.cache.get(k);
    if (hit != null) return hit;
    const n = this.nodes[a];
    const r = this.mk(n.v, this.not(n.lo), this.not(n.hi));
    this.cache.set(k, r);
    return r;
  }

  /** u with variable `name` fixed to val (0 or 1). */
  restrict(u, name, val) {
    const lv = this.level.get(name);
    const memo = new Map();
    const go = (x) => {
      if (x < 2) return x;
      const n = this.nodes[x];
      if (n.v > lv) return x;
      if (memo.has(x)) return memo.get(x);
      const r = n.v === lv ? go(val ? n.hi : n.lo) : this.mk(n.v, go(n.lo), go(n.hi));
      memo.set(x, r);
      return r;
    };
    return go(u);
  }

  /** Exact probability of u being true, basic events independent with probabilities p (by name). */
  probability(u, p) {
    const q = this.order.map((v) => {
      const x = p[v];
      if (!Number.isFinite(x) || x < 0 || x > 1) throw new Error(`BDD: probability of ${v} must be in [0, 1] (got ${x})`);
      return x;
    });
    const memo = new Map();
    const go = (x) => {
      if (x < 2) return x;
      const m = memo.get(x);
      if (m != null) return m;
      const n = this.nodes[x];
      const r = q[n.v] * go(n.hi) + (1 - q[n.v]) * go(n.lo);
      memo.set(x, r);
      return r;
    };
    return go(u);
  }

  /** Evaluate u on a full assignment (name -> boolean). */
  evaluate(u, assignment) {
    let x = u;
    while (x > 1) { const n = this.nodes[x]; x = assignment[this.order[n.v]] ? n.hi : n.lo; }
    return x === 1;
  }

  /** Variables u depends on. */
  support(u) {
    const seen = new Set(), vars = new Set();
    const st = [u];
    while (st.length) {
      const x = st.pop();
      if (x < 2 || seen.has(x)) continue;
      seen.add(x);
      const n = this.nodes[x];
      vars.add(this.order[n.v]);
      st.push(n.lo, n.hi);
    }
    return [...vars].sort((a, b) => this.level.get(a) - this.level.get(b));
  }

  size(u) {
    const seen = new Set();
    const st = [u];
    while (st.length) { const x = st.pop(); if (x < 2 || seen.has(x)) continue; seen.add(x); st.push(this.nodes[x].lo, this.nodes[x].hi); }
    return seen.size;
  }
}

/** Basic events of a set of gates reachable from roots, in depth-first first-visit order. */
export function variableOrder(gates, roots) {
  const order = [], seen = new Set(), visited = new Set();
  const walk = (id) => {
    const g = gates[id];
    if (!g) { if (!seen.has(id)) { seen.add(id); order.push(id); } return; }
    if (visited.has(id)) return;
    visited.add(id);
    for (const i of g.inputs) walk(i);
  };
  for (const r of roots) walk(r);
  return order;
}

/**
 * Build the BDDs of the given roots of a gate map. Gates: { type: "or" | "and" | "atleast" (k) | "not", inputs }.
 * Returns { bdd, roots: { id: node } }.
 */
export function buildBdd(gates, roots, { order } = {}) {
  const bdd = new Bdd(order || variableOrder(gates, roots));
  const memo = new Map();
  const visiting = new Set();
  const build = (id) => {
    if (memo.has(id)) return memo.get(id);
    const g = gates[id];
    if (!g) return bdd.var(id);
    if (visiting.has(id)) throw new Error(`fault tree has a cycle through ${id}`);
    visiting.add(id);
    if (!Array.isArray(g.inputs) || !g.inputs.length) throw new Error(`gate ${id} has no inputs`);
    const xs = g.inputs.map(build);
    let r;
    if (g.type === "or") r = xs.reduce((a, b) => bdd.apply("or", a, b), 0);
    else if (g.type === "and") r = xs.reduce((a, b) => bdd.apply("and", a, b), 1);
    else if (g.type === "not") { if (xs.length !== 1) throw new Error(`gate ${id}: not takes one input`); r = bdd.not(xs[0]); }
    else if (g.type === "atleast") {
      const k = g.k;
      if (!Number.isInteger(k) || k < 1 || k > xs.length) throw new Error(`gate ${id}: k must be 1..${xs.length}`);
      // T[j] = at least j of the inputs seen so far (dynamic programming over the inputs)
      let T = [1, ...Array(k).fill(0)];
      for (const x of xs) {
        const N = [1];
        for (let j = 1; j <= k; j++) N.push(bdd.apply("or", T[j], bdd.apply("and", x, T[j - 1])));
        T = N;
      }
      r = T[k];
    } else throw new Error(`gate ${id}: unknown type "${g.type}"`);
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };
  return { bdd, roots: Object.fromEntries(roots.map((r) => [r, build(r)])) };
}
