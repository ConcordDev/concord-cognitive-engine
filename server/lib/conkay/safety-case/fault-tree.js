// server/lib/conkay/safety-case/fault-tree.js
//
// Deterministic minimal cut sets for coherent fault trees (AND / OR /
// at-least-k-of-n gates, no NOT gates).
//
// Algorithm: bottom-up Boolean substitution, as in NUREG-0492 (Fault Tree
// Handbook) Chapter VII, section 4: every gate's cut sets are computed from
// its inputs' cut sets (memoised), then reduced with the idempotent law
// (X·X = X) and the law of absorption (X + X·Y = X).
//   OR  : union of the inputs' cut-set lists, then absorption.
//   AND : pairwise products (set unions) folded across the inputs, then
//         absorption after each step.
//   k-of-n (ATLEAST): OR over every k-combination of the inputs of their AND.
// Truncation at `maxOrder`: a product with more than maxOrder events is
// dropped as soon as it appears. For a coherent tree this never loses a
// minimal cut set of order <= maxOrder (products only grow under AND, OR
// passes sets through unchanged, and a dropped set could only have absorbed
// supersets of itself, which are larger still).
// Determinism: events inside a set are sorted; sets are sorted by order,
// then lexicographically.

export const FT_VERSION = "1.0.0";

function key(s) { return s.join("\u0000"); }

function sortSets(sets) {
  return sets.sort((a, b) => a.length - b.length || key(a).localeCompare(key(b)));
}

/** Absorption + dedupe. Input sets must be sorted arrays. */
export function minimize(sets) {
  const seen = new Set();
  const uniq = [];
  for (const s of sortSets([...sets])) {
    const k = key(s);
    if (!seen.has(k)) { seen.add(k); uniq.push(s); }
  }
  const kept = [];
  for (const s of uniq) {
    const ss = new Set(s);
    if (!kept.some((k) => k.every((e) => ss.has(e)))) kept.push(s);
  }
  return kept;
}

function product(A, B, maxOrder) {
  const out = [];
  for (const a of A) {for (const b of B) {
    const u = [...new Set([...a, ...b])].sort();
    if (u.length <= maxOrder) out.push(u);
  }}
  return minimize(out);
}

function combinations(arr, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

/**
 * ft: { gates: { [id]: { type: "or"|"and"|"atleast", k?, inputs: [id] } } }
 * Any id that is not a gate is a basic event.
 * Returns sorted minimal cut sets (arrays of basic-event ids) of `top`.
 */
export function minimalCutSets(ft, top, { maxOrder = Infinity } = {}) {
  const gates = ft.gates || {};
  const memo = new Map();
  const visiting = new Set();
  const solve = (id) => {
    if (memo.has(id)) return memo.get(id);
    const g = gates[id];
    if (!g) { const r = [[id]]; memo.set(id, r); return r; }
    if (visiting.has(id)) throw new Error(`fault tree has a cycle through ${id}`);
    visiting.add(id);
    if (!Array.isArray(g.inputs) || !g.inputs.length) throw new Error(`gate ${id} has no inputs`);
    let r;
    if (g.type === "or") r = minimize(g.inputs.flatMap(solve));
    else if (g.type === "and") r = g.inputs.reduce((acc, i) => product(acc, solve(i), maxOrder), [[]]);
    else if (g.type === "atleast") {
      if (!Number.isInteger(g.k) || g.k < 1 || g.k > g.inputs.length) throw new Error(`gate ${id}: k must be 1..${g.inputs.length}`);
      if (g.inputs.length > 16) throw new Error(`gate ${id}: at-least gate with > 16 inputs is not supported`);
      r = minimize(combinations(g.inputs, g.k).flatMap((c) => c.reduce((acc, i) => product(acc, solve(i), maxOrder), [[]])));
    } else throw new Error(`gate ${id}: unknown type "${g.type}"`);
    r = r.filter((s) => s.length <= maxOrder);
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };
  return sortSets(solve(top).map((s) => [...s]));
}

/** Rare-event approximation Σ Π p (NUREG-0492 eq. VI-7) and the min-cut upper bound. */
export function quantify(cutSets, p) {
  const terms = cutSets.map((s) => {
    for (const e of s) if (!Number.isFinite(p[e])) throw new Error(`no probability for basic event ${e}`);
    return { cutSet: s, probability: s.reduce((x, e) => x * p[e], 1) };
  });
  const rareEvent = terms.reduce((x, t) => x + t.probability, 0);
  const mcub = 1 - terms.reduce((x, t) => x * (1 - t.probability), 1);
  return { terms: terms.map((t) => ({ ...t, importance: rareEvent ? t.probability / rareEvent : 0 })), rareEvent, minCutUpperBound: mcub };
}

// ── Published benchmarks (NUREG-0492) ───────────────────────────────────────

export const BENCHMARKS = Object.freeze({
  "nureg-0492-fig-VII-10": {
    title: "NUREG-0492 Figure VII-10 example fault tree (pp. VII-16–17)",
    ft: { gates: {
      T: { type: "and", inputs: ["E1", "E2"] },
      E1: { type: "or", inputs: ["A", "E3"] },
      E3: { type: "or", inputs: ["B", "C"] },
      E2: { type: "or", inputs: ["C", "E4"] },
      E4: { type: "and", inputs: ["A", "B"] },
    } },
    top: "T",
    published: { cutSets: [["C"], ["A", "B"]], text: "The minimal cut sets of the top event are thus C and A·B" },
  },
  "nureg-0492-pressure-tank": {
    title: "NUREG-0492 Chapter VIII pressure tank example, basic (reduced) fault tree Figure VIII-14 (pp. VIII-12–14)",
    // Boolean equations as printed on p. VIII-12: E1 = T + E2; E2 = K2 + E3;
    // E3 = S·E4; E4 = S1 + E5; E5 = K1 + R.
    ft: { gates: {
      E1: { type: "or", inputs: ["T", "E2"] },
      E2: { type: "or", inputs: ["K2", "E3"] },
      E3: { type: "and", inputs: ["S", "E4"] },
      E4: { type: "or", inputs: ["S1", "E5"] },
      E5: { type: "or", inputs: ["K1", "R"] },
    } },
    top: "E1",
    // Table VIII-1 failure probabilities.
    probabilities: { T: 5e-6, K2: 3e-5, S: 1e-4, K1: 3e-5, R: 1e-4, S1: 3e-5 },
    published: {
      cutSets: [["K2"], ["T"], ["S", "S1"], ["S", "K1"], ["S", "R"]],
      text: "five minimal cut sets-two singles and three doubles: K2, T, S·S1, S·K1, S·R",
      topProbability: 3.4e-5,
      importance: { T: 0.14, K2: 0.86 },
    },
  },
});
