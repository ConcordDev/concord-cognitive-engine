// server/lib/network/graph.js
//
// Engine N3 — network/graph theory = viability over a TOPOLOGY. Contagion,
// cascade, and percolation are how a state (disease, rumor, market shock,
// faction allegiance) propagates through a graph — the general theory behind
// disease-engine contagion, SL2 gossip-spread, economic contagion, and the
// Concord Link. Pure, deterministic, zero-dep. Adjacency = { node: [neighbors] }
// (undirected unless noted); deterministic cascades take an injectable rng.

function neighbors(adj, n) { return adj[n] || []; }
function nodes(adj) { return Object.keys(adj); }

/** Connected components of an undirected graph (BFS). Returns array of node arrays. */
export function connectedComponents(adj) {
  const seen = new Set();
  const comps = [];
  for (const start of nodes(adj)) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const n = queue.shift();
      comp.push(n);
      for (const m of neighbors(adj, n)) {
        if (!seen.has(m)) { seen.add(m); queue.push(m); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** Size of the largest connected component — the percolation "giant component"
 * (the worst-case reach of any cascade). */
export function giantComponentSize(adj) {
  const comps = connectedComponents(adj);
  return comps.reduce((mx, c) => Math.max(mx, c.length), 0);
}

/** Degree per node — degreeCentrality; the hubs (superspreaders / Link gateways). */
export function degreeCentrality(adj) {
  const out = {};
  for (const n of nodes(adj)) out[n] = neighbors(adj, n).length;
  return out;
}

/** The most-connected node (the hub a cascade should seed from / a defender should cut). */
export function topHub(adj) {
  let best = null, deg = -1;
  for (const [n, d] of Object.entries(degreeCentrality(adj))) {
    if (d > deg) { deg = d; best = n; }
  }
  return best == null ? null : { node: best, degree: deg };
}

/**
 * Independent-cascade contagion (the disease/rumor primitive). From `seeds`,
 * each newly-active node gets ONE chance to activate each neighbor with
 * probability `prob`. Deterministic with an injected rng. prob=1 floods the
 * seeds' components; prob=0 activates only the seeds.
 * Returns { activated: string[], steps }.
 */
export function independentCascade(adj, seeds, prob = 0.5, rng = Math.random) {
  const active = new Set(seeds);
  let frontier = [...seeds];
  let steps = 0;
  const p = Math.max(0, Math.min(1, prob));
  while (frontier.length) {
    steps++;
    const next = [];
    for (const n of frontier) {
      for (const m of neighbors(adj, n)) {
        if (active.has(m)) continue;
        if (rng() < p) { active.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return { activated: [...active], steps };
}

/**
 * Linear-threshold cascade (the allegiance/adoption primitive). A node flips
 * active when the FRACTION of its neighbors that are active ≥ its threshold.
 * Iterates to a fixpoint. Low threshold → floods; high threshold → stalls.
 * Returns { activated: string[], rounds }.
 */
export function linearThresholdCascade(adj, seeds, threshold = 0.5) {
  const active = new Set(seeds);
  const th = Math.max(0, Math.min(1, threshold));
  let changed = true;
  let rounds = 0;
  while (changed) {
    changed = false;
    rounds++;
    for (const n of nodes(adj)) {
      if (active.has(n)) continue;
      const nb = neighbors(adj, n);
      if (nb.length === 0) continue;
      const activeFrac = nb.filter((m) => active.has(m)).length / nb.length;
      if (activeFrac >= th) { active.add(n); changed = true; }
    }
  }
  return { activated: [...active], rounds };
}
