// server/lib/collusion-detector.js
//
// F3 — multi-account collusion detection (the ring case the pairwise
// wash-trade check misses).
//
// detectWashTrading (server.js) flags a single buyer↔seller PAIR trading too
// often. Collusion rings are bigger: A→B→C→A loops that launder value/royalties
// in a cycle no pairwise check sees. This reads the same `_washTradeHistory`
// graph (Map<"buyer:seller", [{ts}]>) and finds the cycles via Tarjan SCC, plus
// the reciprocal 2-account pairs.
//
// OBSERVE-ONLY + advisory — like E2, it counts + (via bug-triage) pages, but
// NEVER blocks a trade or mutates a balance. Pure, never throws. The history is
// injectable (Map or plain object) so it's unit-testable without globals.

const THIRTY_DAYS_MS = 30 * 86400000;

/** Build a directed adjacency from a wash-trade history map, gated by recency + min trades. */
function buildEdges(history, { minEdgeTrades, windowMs, nowMs }) {
  const entries = history instanceof Map ? history.entries() : Object.entries(history || {});
  const adj = new Map();      // a -> Set<b>
  const edgeTrades = new Map(); // "a:b" -> count (in window)
  for (const [key, val] of entries) {
    const sep = String(key).indexOf(":");
    if (sep <= 0) continue;
    const a = String(key).slice(0, sep);
    const b = String(key).slice(sep + 1);
    if (!a || !b || a === b) continue;
    const count = Array.isArray(val)
      ? val.filter((t) => !nowMs || !t?.ts || nowMs - t.ts < windowMs).length
      : Number(val) || 0;
    if (count < minEdgeTrades) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
    edgeTrades.set(`${a}:${b}`, count);
  }
  return { adj, edgeTrades };
}

/** Tarjan strongly-connected components over the adjacency. */
function tarjanSCC(adj) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let idx = 0;
  const nodes = new Set();
  for (const [a, outs] of adj) { nodes.add(a); for (const b of outs) nodes.add(b); }

  const strongconnect = (v) => {
    // Iterative to avoid blowing the stack on a big graph.
    const work = [[v, 0]];
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [node, i] = top;
      const outs = adj.get(node) ? [...adj.get(node)] : [];
      if (i < outs.length) {
        top[1]++;
        const w = outs[i];
        if (!index.has(w)) {
          index.set(w, idx); low.set(w, idx); idx++; stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node), index.get(w)));
        }
      } else {
        if (low.get(node) === index.get(node)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== node);
          sccs.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
      }
    }
  };

  for (const n of nodes) if (!index.has(n)) strongconnect(n);
  return sccs;
}

/**
 * Detect collusion rings + reciprocal pairs in a wash-trade history graph.
 * @param {Map|object} history  Map<"a:b",[{ts}]>  (or "a:b" -> count)
 * @param {object} [opts]
 * @returns {{ok:boolean, rings:Array, reciprocalPairs:Array, edgeCount:number, nodeCount:number}}
 */
export function detectCollusionRings(history, { minEdgeTrades = 3, minRingSize = 3, windowMs = THIRTY_DAYS_MS, nowMs = Date.now() } = {}) {
  try {
    const { adj, edgeTrades } = buildEdges(history, { minEdgeTrades, windowMs, nowMs });
    const sccs = tarjanSCC(adj);

    const rings = [];
    for (const comp of sccs) {
      if (comp.length < minRingSize) continue;
      const members = new Set(comp);
      let totalTrades = 0;
      for (const [edge, n] of edgeTrades) {
        const sep = edge.indexOf(":");
        if (members.has(edge.slice(0, sep)) && members.has(edge.slice(sep + 1))) totalTrades += n;
      }
      rings.push({ accounts: comp.slice().sort(), size: comp.length, totalTrades });
    }
    rings.sort((a, b) => b.totalTrades - a.totalTrades);

    // Reciprocal 2-account pairs (a→b AND b→a both above threshold).
    const reciprocalPairs = [];
    const seen = new Set();
    for (const [edge, n] of edgeTrades) {
      const sep = edge.indexOf(":");
      const a = edge.slice(0, sep), b = edge.slice(sep + 1);
      const rev = `${b}:${a}`;
      if (edgeTrades.has(rev)) {
        const canon = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(canon)) continue;
        seen.add(canon);
        reciprocalPairs.push({ a, b, trades: n + edgeTrades.get(rev) });
      }
    }
    reciprocalPairs.sort((x, y) => y.trades - x.trades);

    const nodes = new Set();
    for (const [a, outs] of adj) { nodes.add(a); for (const b of outs) nodes.add(b); }
    return { ok: true, rings, reciprocalPairs, edgeCount: edgeTrades.size, nodeCount: nodes.size };
  } catch (e) {
    return { ok: false, rings: [], reciprocalPairs: [], edgeCount: 0, nodeCount: 0, reason: String(e?.message || e) };
  }
}

export default detectCollusionRings;
