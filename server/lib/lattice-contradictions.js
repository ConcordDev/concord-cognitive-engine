// server/lib/lattice-contradictions.js
//
// The lattice audit's "directly opposing claims" check, in one pass.
//
// The audit (emergent/index.js, repair.agent.tick) used to compare every claim
// with every other claim: for 60,000 DTUs × 4 claims that is ~2.9e10 string
// comparisons, run synchronously every 5 minutes. Profiled on a seeded box
// (CONCORD_LAG_PROFILER, 2026-11-28) it held the event loop for ~184 s per run —
// the sustained lag that makes the load shedder 503 anonymous traffic such as
// /api/metrics/vitals. On a healthy lattice it never found the 5 contradictions
// that would have stopped it early, so it always did the full quadratic scan.
//
// The rule is unchanged. Two claims (from different DTUs) contradict when one is
// the other with its first "not " removed:
//   (a.includes("not ") && b === a.replace("not ", "")) ||
//   (b.includes("not ") && a === b.replace("not ", ""))
// That only ever matches an exact string, so an index of claim text finds every
// such pair in one pass. Pairs are returned in the same order the nested loop
// produced them (by first index, then second), capped at `limit`.

/**
 * @param {Array<{ id: string, claim: string }>} claims  lower-cased claims, in audit order
 * @param {number} [limit=5]
 * @returns {Array<[number, number]>} index pairs [i, j] with i < j
 */
export function findNegationContradictions(claims, limit = 5) {
  if (!Array.isArray(claims) || claims.length < 2 || !(limit > 0)) return [];
  const byText = new Map();
  claims.forEach((c, i) => {
    const list = byText.get(c.claim);
    if (list) list.push(i); else byText.set(c.claim, [i]);
  });
  const pairs = [];
  const seen = new Set();
  claims.forEach((c, i) => {
    if (!c.claim.includes("not ")) return;
    const stripped = c.claim.replace("not ", "");
    const others = byText.get(stripped);
    if (!others) return;
    for (const k of others) {
      if (claims[k].id === c.id) continue;
      const a = Math.min(i, k), b = Math.max(i, k);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
  });
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return pairs.slice(0, limit);
}
