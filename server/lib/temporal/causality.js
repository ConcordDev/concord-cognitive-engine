// server/lib/temporal/causality.js
//
// Engine N10 — time/causality = temporal logic over the dynamics layer. Two
// kinds of question the game keeps asking informally: (1) over a forward-sim
// TIMELINE, "will X eventually happen / does X hold until Y" — that's LTL, the
// math under the prediction engine; (2) over a CAUSAL graph, "does cause precede
// effect / is there a loop" — topological order + cycle detection, the math
// under the time-loop mechanic (a paradox is a causal cycle). Pure, zero-dep.
//
// timeline = array of states; pred = (state) => boolean. causal edges = [[cause, effect], …].

/** LTL ◇ — pred holds in SOME state of the timeline. */
export function eventually(pred, timeline) {
  return timeline.some((s) => !!pred(s));
}

/** LTL □ — pred holds in EVERY state. */
export function always(pred, timeline) {
  return timeline.every((s) => !!pred(s));
}

/** LTL ○ — pred holds in the state after index i. */
export function nextHolds(pred, timeline, i) {
  return i + 1 < timeline.length ? !!pred(timeline[i + 1]) : false;
}

/**
 * LTL p U q — q becomes true at some step, and p holds at every step strictly
 * before that. (Strong until: q must eventually hold.)
 */
export function until(p, q, timeline) {
  for (let i = 0; i < timeline.length; i++) {
    if (q(timeline[i])) return true;       // q satisfied, p held up to here
    if (!p(timeline[i])) return false;     // p broke before q → fails
  }
  return false;                            // q never held
}

function _adjacency(edges) {
  const adj = new Map();
  const indeg = new Map();
  for (const [c, e] of edges) {
    if (!adj.has(c)) adj.set(c, []);
    if (!adj.has(e)) adj.set(e, []);
    adj.get(c).push(e);
    indeg.set(e, (indeg.get(e) || 0) + 1);
    if (!indeg.has(c)) indeg.set(c, indeg.get(c) || 0);
  }
  return { adj, indeg };
}

/**
 * Topological causal order (Kahn) — returns an ordering where every cause
 * precedes its effect, or null if a causal CYCLE exists (a paradox). `nodes`
 * optionally seeds isolated events.
 */
export function topoCausalOrder(edges, nodes = []) {
  const { adj, indeg } = _adjacency(edges);
  for (const n of nodes) { if (!adj.has(n)) adj.set(n, []); if (!indeg.has(n)) indeg.set(n, 0); }
  const queue = [];
  for (const [n, d] of indeg) if (d === 0) queue.push(n);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of adj.get(n) || []) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  return order.length === adj.size ? order : null; // null ⇔ cycle (paradox)
}

/** Is there a causal cycle (effect that loops back to precede its own cause)? */
export function hasCausalCycle(edges, nodes = []) {
  return topoCausalOrder(edges, nodes) === null;
}

/** Transitive causal precedence: can you reach `b` from `a` along cause→effect edges? */
export function happensBefore(a, b, edges) {
  const { adj } = _adjacency(edges);
  const seen = new Set();
  const stack = [a];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adj.get(n) || []) {
      if (m === b) return true;
      if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
  }
  return false;
}
