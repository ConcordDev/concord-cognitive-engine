// server/lib/conkay/physics/solvers/graph.js
//
// math.graph — SX-NUM-21 (ConKay solver catalogue, Wave 0).
//
// Graph algorithms over an explicit {nodes, edges} input:
// Dijkstra and Bellman-Ford shortest paths, Kruskal MST,
// Kahn topological order, Dinic max-flow, Hopcroft-Karp
// bipartite matching, and the Laplacian spectrum (via the
// stack's own Jacobi eigensolver, SX-NUM-04).
//
// The honesty shapes: Dijkstra refuses negative weights by
// name rather than answering wrongly; a negative cycle and
// a topo-sort cycle are served as NAMED FINDINGS (WARN with
// the cycle nodes), never dressed as distances or an
// ordering; a disconnected MST request returns the forest,
// labelled as a forest with its component count; and the
// max-flow result carries its min cut, whose capacity equals
// the flow value — the certificate a checker can verify
// without trusting the algorithm.
//
// Catalogue reference case: max flow on the CLRS textbook
// network = 23, with the {s,v1,v2,v4}|{v3,t} cut of the same
// capacity.

import { registerSolver } from "../registry.js";
import { jacobiEigen } from "./eigen.js";

function buildGraph(inputs) {
  const nodes = inputs.nodes;
  const edges = inputs.edges;
  if (!Array.isArray(nodes) || nodes.length === 0 || !nodes.every((n) => typeof n === "string")) {
    return { error: "missing_input:nodes (a non-empty array of node id strings)" };
  }
  if (!Array.isArray(edges)) return { error: "missing_input:edges (an array of {from, to, weight?, capacity?})" };
  const nodeSet = new Set(nodes);
  for (const [i, e] of edges.entries()) {
    if (!e || !nodeSet.has(e.from) || !nodeSet.has(e.to)) {
      return { error: `invalid_input:edges[${i}] names a node outside the declared node set` };
    }
  }
  if (nodes.length > 5000 || edges.length > 50000) {
    return { error: "size_above_envelope:graphs are capped at 5000 nodes / 50000 edges (declared envelope)" };
  }
  const directed = inputs.directed === true;
  const adj = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) {
    adj.get(e.from).push({ to: e.to, weight: e.weight, capacity: e.capacity });
    if (!directed) adj.get(e.to).push({ to: e.from, weight: e.weight, capacity: e.capacity });
  }
  return { nodes, edges, nodeSet, directed, adj };
}

function dijkstra(g, source) {
  const dist = new Map(g.nodes.map((n) => [n, Infinity]));
  const prev = new Map();
  dist.set(source, 0);
  const visited = new Set();
  while (visited.size < g.nodes.length) {
    let u = null;
    let best = Infinity;
    for (const n of g.nodes) {
      if (!visited.has(n) && dist.get(n) < best) { best = dist.get(n); u = n; }
    }
    if (u === null) break;
    visited.add(u);
    for (const e of g.adj.get(u)) {
      const nd = best + e.weight;
      if (nd < dist.get(e.to)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  return { dist, prev };
}

function bellmanFord(g, source) {
  const dist = new Map(g.nodes.map((n) => [n, Infinity]));
  const prev = new Map();
  dist.set(source, 0);
  const directedEdges = [];
  for (const e of g.edges) {
    directedEdges.push(e);
    if (!g.directed) directedEdges.push({ from: e.to, to: e.from, weight: e.weight });
  }
  for (let i = 0; i < g.nodes.length - 1; i += 1) {
    let changed = false;
    for (const e of directedEdges) {
      if (dist.get(e.from) + e.weight < dist.get(e.to)) {
        dist.set(e.to, dist.get(e.from) + e.weight);
        prev.set(e.to, e.from);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // negative-cycle check: one more relaxation round
  for (const e of directedEdges) {
    if (dist.get(e.from) + e.weight < dist.get(e.to)) {
      // walk predecessors to extract the cycle
      let x = e.to;
      for (let i = 0; i < g.nodes.length; i += 1) x = prev.get(x) ?? e.from;
      const cycle = [x];
      let y = prev.get(x);
      while (y !== undefined && y !== x && cycle.length <= g.nodes.length) { cycle.push(y); y = prev.get(y); }
      return { negativeCycle: cycle.reverse() };
    }
  }
  return { dist, prev };
}

function dinic(g, source, sink) {
  const idx = new Map(g.nodes.map((n, i) => [n, i]));
  const N = g.nodes.length;
  const graph = Array.from({ length: N }, () => []);
  const addEdge = (u, v, cap) => {
    graph[u].push({ to: v, cap, rev: graph[v].length });
    graph[v].push({ to: u, cap: 0, rev: graph[u].length - 1 });
  };
  for (const e of g.edges) {
    const cap = e.capacity === undefined ? e.weight : e.capacity;
    addEdge(idx.get(e.from), idx.get(e.to), cap);
    if (!g.directed) addEdge(idx.get(e.to), idx.get(e.from), cap);
  }
  const s = idx.get(source);
  const t = idx.get(sink);
  let flow = 0;
  const level = new Array(N);
  const bfs = () => {
    level.fill(-1);
    level[s] = 0;
    const queue = [s];
    while (queue.length > 0) {
      const u = queue.shift();
      for (const e of graph[u]) {
        if (e.cap > 0 && level[e.to] < 0) { level[e.to] = level[u] + 1; queue.push(e.to); }
      }
    }
    return level[t] >= 0;
  };
  const it = new Array(N);
  const dfs = (u, f) => {
    if (u === t) return f;
    for (; it[u] < graph[u].length; it[u] += 1) {
      const e = graph[u][it[u]];
      if (e.cap > 0 && level[e.to] === level[u] + 1) {
        const pushed = dfs(e.to, Math.min(f, e.cap));
        if (pushed > 0) {
          e.cap -= pushed;
          graph[e.to][e.rev].cap += pushed;
          return pushed;
        }
      }
    }
    return 0;
  };
  while (bfs()) {
    it.fill(0);
    let pushed;
    while ((pushed = dfs(s, Infinity)) > 0) flow += pushed;
  }
  // min cut: nodes reachable from s in the residual graph
  const seen = new Array(N).fill(false);
  const stack = [s];
  seen[s] = true;
  while (stack.length > 0) {
    const u = stack.pop();
    for (const e of graph[u]) {
      if (e.cap > 0 && !seen[e.to]) { seen[e.to] = true; stack.push(e.to); }
    }
  }
  const sideS = g.nodes.filter((_, i) => seen[i]);
  let cutCapacity = 0;
  for (const e of g.edges) {
    const cap = e.capacity === undefined ? e.weight : e.capacity;
    if (seen[idx.get(e.from)] && !seen[idx.get(e.to)]) cutCapacity += cap;
    if (!g.directed && seen[idx.get(e.to)] && !seen[idx.get(e.from)]) cutCapacity += cap;
  }
  return { flow, sideS, sideT: g.nodes.filter((_, i) => !seen[i]), cutCapacity };
}

function runGraph(ctx, target) {
  const inputs = ctx?.inputs || {};
  const g = buildGraph(inputs);
  if (g.error) return { notComputed: g.error };
  const needWeight = (e) => (e.weight === undefined ? 1 : e.weight);

  switch (target) {
    case "shortest-path": {
      const { source, dest } = inputs;
      if (!g.nodeSet.has(source)) return { notComputed: "missing_input:source (a declared node)" };
      for (const e of g.edges) {
        if ((e.weight ?? 1) < 0) return { notComputed: "negative_weights:Dijkstra's envelope is non-negative weights — use target bellman-ford, which handles them and detects negative cycles" };
      }
      const gg = { ...g, edges: g.edges.map((e) => ({ ...e, weight: needWeight(e) })) };
      gg.adj = new Map(g.nodes.map((n) => [n, []]));
      for (const e of gg.edges) {
        gg.adj.get(e.from).push({ to: e.to, weight: e.weight });
        if (!gg.directed) gg.adj.get(e.to).push({ to: e.from, weight: e.weight });
      }
      const { dist, prev } = dijkstra(gg, source);
      const distances = {};
      for (const n of g.nodes) distances[n] = dist.get(n) === Infinity ? null : dist.get(n);
      const out = { distances };
      if (dest !== undefined) {
        if (!g.nodeSet.has(dest)) return { notComputed: "missing_input:dest (a declared node)" };
        if (dist.get(dest) === Infinity) {
          out.path = null;
          out.unreachable = dest;
        } else {
          const path = [dest];
          let cur = dest;
          while (cur !== source) { cur = prev.get(cur); path.unshift(cur); }
          out.path = path;
          out.distance = dist.get(dest);
        }
      }
      return { inputs: { nodes: g.nodes.length, edges: g.edges.length }, outputs: out, margins: [], covers: [target] };
    }
    case "bellman-ford": {
      const { source } = inputs;
      if (!g.nodeSet.has(source)) return { notComputed: "missing_input:source (a declared node)" };
      const gg = { ...g, edges: g.edges.map((e) => ({ ...e, weight: needWeight(e) })) };
      const r = bellmanFord(gg, source);
      if (r.negativeCycle) {
        return {
          inputs: {},
          outputs: { negativeCycle: r.negativeCycle },
          warnings: [`negative_cycle:${r.negativeCycle.join("->")} — distances are undefined on and downstream of this cycle`],
          margins: [], covers: [target],
        };
      }
      const distances = {};
      for (const n of g.nodes) distances[n] = r.dist.get(n) === Infinity ? null : r.dist.get(n);
      return { inputs: {}, outputs: { distances }, margins: [], covers: [target] };
    }
    case "mst": {
      const sorted = [...g.edges].map((e) => ({ ...e, weight: needWeight(e) })).sort((a, b) => a.weight - b.weight);
      const parent = new Map(g.nodes.map((n) => [n, n]));
      const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      const chosen = [];
      let totalWeight = 0;
      for (const e of sorted) {
        const ra = find(e.from);
        const rb = find(e.to);
        if (ra !== rb) {
          parent.set(ra, rb);
          chosen.push({ from: e.from, to: e.to, weight: e.weight });
          totalWeight += e.weight;
        }
      }
      const roots = new Set(g.nodes.map((n) => find(n)));
      return {
        inputs: {},
        outputs: { edges: chosen, totalWeight, components: roots.size, isForest: roots.size > 1 },
        warnings: roots.size > 1 ? [`forest_not_tree:the graph has ${roots.size} components — the result is the minimum spanning FOREST, labelled as such`] : [],
        margins: [], covers: [target],
      };
    }
    case "topo-sort": {
      if (!g.directed) return { notComputed: "invalid_input:topo-sort needs a directed graph (directed: true)" };
      const indeg = new Map(g.nodes.map((n) => [n, 0]));
      for (const e of g.edges) indeg.set(e.to, indeg.get(e.to) + 1);
      const queue = g.nodes.filter((n) => indeg.get(n) === 0);
      const order = [];
      while (queue.length > 0) {
        const u = queue.shift();
        order.push(u);
        for (const e of g.adj.get(u)) {
          indeg.set(e.to, indeg.get(e.to) - 1);
          if (indeg.get(e.to) === 0) queue.push(e.to);
        }
      }
      if (order.length < g.nodes.length) {
        const cyclic = g.nodes.filter((n) => !order.includes(n));
        return {
          inputs: {},
          outputs: { partialOrder: order, cycleNodes: cyclic },
          warnings: [`cyclic_remainder:${cyclic.join(",")} cannot be ordered — they sit on or downstream of a directed cycle`],
          margins: [], covers: [target],
        };
      }
      return { inputs: {}, outputs: { order }, margins: [], covers: [target] };
    }
    case "max-flow": {
      const { source, sink } = inputs;
      if (!g.nodeSet.has(source) || !g.nodeSet.has(sink)) return { notComputed: "missing_input:source and sink (declared nodes)" };
      for (const e of g.edges) {
        const cap = e.capacity === undefined ? e.weight : e.capacity;
        if (!(cap >= 0)) return { notComputed: "invalid_input:capacities must be non-negative numbers" };
      }
      const r = dinic(g, source, sink);
      return {
        inputs: {},
        outputs: { maxFlow: r.flow, minCut: { sideS: r.sideS, sideT: r.sideT, capacity: r.cutCapacity } },
        margins: [], covers: [target],
      };
    }
    case "matching": {
      const { left, right } = inputs;
      if (!Array.isArray(left) || !Array.isArray(right)) return { notComputed: "missing_input:left and right (the bipartition, as node id arrays)" };
      const leftSet = new Set(left);
      const rightSet = new Set(right);
      for (const n of [...left, ...right]) if (!g.nodeSet.has(n)) return { notComputed: `invalid_input:partition names undeclared node ${n}` };
      const adjL = new Map(left.map((u) => [u, []]));
      for (const e of g.edges) {
        if (leftSet.has(e.from) && rightSet.has(e.to)) adjL.get(e.from).push(e.to);
        else if (leftSet.has(e.to) && rightSet.has(e.from)) adjL.get(e.to).push(e.from);
        else return { notComputed: `invalid_input:edge ${e.from}-${e.to} crosses outside the declared bipartition` };
      }
      // Hopcroft-Karp
      const pairU = new Map(left.map((u) => [u, null]));
      const pairV = new Map(right.map((v) => [v, null]));
      const distU = new Map();
      const bfs = () => {
        const queue = [];
        for (const u of left) {
          if (pairU.get(u) === null) { distU.set(u, 0); queue.push(u); } else distU.set(u, Infinity);
        }
        let found = false;
        while (queue.length > 0) {
          const u = queue.shift();
          for (const v of adjL.get(u)) {
            const pu = pairV.get(v);
            if (pu !== null && distU.get(pu) === distU.get(u) + 1) continue;
            if (pu !== null && distU.get(pu) === Infinity) { distU.set(pu, distU.get(u) + 1); queue.push(pu); }
            if (pu === null) found = true;
          }
        }
        return found;
      };
      const dfs = (u) => {
        for (const v of adjL.get(u)) {
          const pu = pairV.get(v);
          if (pu === null || (distU.get(pu) === distU.get(u) + 1 && dfs(pu))) {
            pairU.set(u, v);
            pairV.set(v, u);
            return true;
          }
        }
        distU.set(u, Infinity);
        return false;
      };
      let size = 0;
      while (bfs()) {
        for (const u of left) if (pairU.get(u) === null && dfs(u)) size += 1;
      }
      const pairs = [];
      for (const u of left) if (pairU.get(u) !== null) pairs.push({ left: u, right: pairU.get(u) });
      return { inputs: {}, outputs: { size, pairs }, margins: [], covers: [target] };
    }
    case "spectral": {
      const n = g.nodes.length;
      if (n > 64) return { notComputed: "size_above_envelope:spectral rides the dense Jacobi eigensolver, capped at 64 nodes" };
      const idx = new Map(g.nodes.map((node, i) => [node, i]));
      const L = Array.from({ length: n }, () => new Array(n).fill(0));
      for (const e of g.edges) {
        const i = idx.get(e.from);
        const j = idx.get(e.to);
        L[i][i] += 1;
        L[j][j] += 1;
        L[i][j] -= 1;
        L[j][i] -= 1;
      }
      const { values } = jacobiEigen(L);
      const sorted = [...values].sort((a, b) => a - b);
      return {
        inputs: {},
        outputs: {
          laplacianEigenvalues: sorted,
          fiedlerValue: n > 1 ? sorted[1] : 0,
          connected: n === 1 || sorted[1] > 1e-9,
        },
        margins: [], covers: [target],
      };
    }
    default:
      return { notComputed: `unknown_operation:${target}` };
  }
}

export const graph = registerSolver({
  id: "math.graph",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "Dijkstra, Bellman-Ford, Kruskal, Kahn, Dinic max-flow with min-cut certificate, Hopcroft-Karp matching, Laplacian spectrum via the stack's Jacobi eigensolver",
  reference: "closed-form small graphs (catalogue) — reference case: the CLRS textbook flow network, max flow 23 with its min cut of equal capacity",
  regime: "explicit node/edge inputs to 5000 nodes / 50000 edges (spectral capped at 64 by the dense eigensolver); cycles and negative cycles are served as named findings, never dressed as results",
  units: { inputs: "nodes, edges with weight/capacity, directed flag, per-target source/sink/partitions", outputs: "distances, paths, flow + cut, matching, order, spectrum — as declared per target" },
  tolerance: "exact combinatorial results; the max-flow value is certified by the returned min cut of equal capacity",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runGraph,
});
