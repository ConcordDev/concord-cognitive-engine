// server/lib/invariant-geometry.js
//
// Invariant Geometry Mapper (#20) — turns the LIVE invariant telemetry
// (emergent/atlas-invariants.js: real pass/fail counts + the real failure log)
// into a graph for GraphView: one node per invariant, an edge between two
// invariants that FAILED close together in time (co-violation), plus a
// lightweight topological (Betti-style) summary of the resulting graph. Reads
// real process state only — no fabricated nodes, no mock edges.

import { getInvariantMetrics, getInvariantLog } from "../emergent/atlas-invariants.js";

const DEFAULT_WINDOW_MS = 5000;

/** Severity from real pass/fail counts: failure ratio scaled by volume. */
function severityFor(pass, fail) {
  const total = pass + fail;
  if (!total) return 0;
  return Math.round((fail / total) * 1000) / 1000;
}

/**
 * Build the invariant co-violation graph from live telemetry.
 * @param {object} [opts]
 * @param {number} [opts.windowMs] two failures within this gap form an edge
 * @returns {{ok, nodes, edges, summary}}
 */
export function invariantGraph({ windowMs = DEFAULT_WINDOW_MS } = {}) {
  const metrics = getInvariantMetrics();
  const log = getInvariantLog(500); // real recent failures, oldest→newest

  const nodes = Object.entries(metrics.byName).map(([name, c]) => ({
    id: name,
    pass: c.pass || 0,
    fail: c.fail || 0,
    severity: severityFor(c.pass || 0, c.fail || 0),
  }));
  const known = new Set(nodes.map((n) => n.id));

  // Co-violation edges: consecutive failures (sorted by ts) within windowMs.
  const fails = log.filter((e) => e && e.ok === false && known.has(e.name)).sort((a, b) => a.ts - b.ts);
  const edgeWeight = new Map(); // "a|b" -> count
  for (let i = 1; i < fails.length; i++) {
    const a = fails[i - 1], b = fails[i];
    if (a.name === b.name) continue;
    if (b.ts - a.ts > windowMs) continue;
    const key = a.name < b.name ? `${a.name}|${b.name}` : `${b.name}|${a.name}`;
    edgeWeight.set(key, (edgeWeight.get(key) || 0) + 1);
  }
  const edges = [...edgeWeight.entries()].map(([key, weight]) => {
    const [source, target] = key.split("|");
    return { source, target, weight };
  });

  return { ok: true, nodes, edges, summary: bettiSummary(nodes, edges), totals: { totalAssertions: metrics.totalAssertions, passed: metrics.passed, failed: metrics.failed } };
}

/**
 * Topological summary of the co-violation graph (TDA-flavoured): b0 = connected
 * components, b1 = independent cycles (edges − nodes + components) on the
 * non-isolated subgraph. Pure graph computation.
 */
export function bettiSummary(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const touched = new Set();
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    union(e.source, e.target);
    touched.add(e.source); touched.add(e.target);
  }
  // components over the WHOLE node set (isolated nodes count as components)
  const roots = new Set(ids.map((id) => find(id)));
  const b0 = roots.size;
  // independent cycles on the connected (touched) subgraph
  const connectedComponents = new Set([...touched].map((id) => find(id))).size;
  const b1 = Math.max(0, edges.length - touched.size + connectedComponents);
  return { nodes: ids.length, edges: edges.length, components: b0, cycles: b1 };
}

export default { invariantGraph, bettiSummary };
