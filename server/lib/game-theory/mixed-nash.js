// server/lib/game-theory/mixed-nash.js
//
// Mixed-strategy Nash equilibria via SUPPORT ENUMERATION (Nisan, Roughgarden,
// Tardos & Vazirani, "Algorithmic Game Theory", §3.4). Extends normal-form.js's
// pure-equilibrium primitives (bestResponseRow / pureNashEquilibria) to the
// general case: games like matching pennies have NO pure equilibrium at all —
// only a mixed one — and normal-form.js on its own cannot find it.
//
// Exact Nash-equilibrium computation is PPAD-complete (Daskalakis, Goldberg &
// Papadimitriou, "The Complexity of Computing a Nash Equilibrium", 2009) — no
// polynomial algorithm is known, and none is claimed here. Support enumeration
// IS exact, but it is exponential in the number of strategies: for every
// candidate pair of supports (a subset of each player's actions, restricted to
// equal size — the standard restriction, since non-degenerate games always have
// |supp(p)| = |supp(q)|) it solves the indifference conditions as a linear
// system — reusing compute/numerical.js#solveLinearSystem rather than adding a
// fifth Gaussian elimination to the repo — and keeps solutions that are valid
// probability distributions AND mutual best responses. A game whose candidate
// count exceeds `maxCandidates` is refused outright (`support_enumeration_
// exhausted`) rather than left to enumerate forever.
//
// Convention (matches normal-form.js): a game is two payoff matrices A, B
// (rows = player-1 actions, cols = player-2 actions). A[i][j] = P1's payoff,
// B[i][j] = P2's payoff, for P1 playing row i against P2 playing col j.

import { solveLinearSystem } from "../compute/numerical.js";

const DEFAULT_MAX_CANDIDATES = 20000;
const DEFAULT_TOLERANCE = 1e-7;
const NONNEG_SLACK = 1e-6;

function nChooseK(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/** Yields index arrays [i0 < i1 < ... < i(k-1)] over range [0, n). */
function* combinations(n, k) {
  if (k > n || k < 0) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Solve "what distribution over `oppSupport` makes every action in `mySupport`
 * pay the same (value v)?" via the linear system
 *   [ getPayoff(i, j) for j in oppSupport ] · probs  −  v  =  0   for each i in mySupport
 *   sum(probs) = 1
 * `getPayoff(myIdx, oppIdx)` returns the payoff to the indifferent player of
 * playing `myIdx` against the opponent's `oppIdx` — the caller supplies the
 * right accessor for whichever player's payoff matrix applies (see below;
 * player 1's own matrix A is naturally [row][col], but player 2's matrix B is
 * naturally [row(opponent)][col(self)] — a transposed access pattern relative
 * to player 1's case, so a raw matrix indexing convention can't be shared).
 *
 * Returns { probs, value } (probs.length === oppSupport.length) or null if
 * the linear system is singular.
 */
function solveIndifference(getPayoff, mySupport, oppSupport) {
  const k = oppSupport.length;
  const M = [];
  const b = [];
  for (const i of mySupport) {
    const row = oppSupport.map((j) => getPayoff(i, j));
    row.push(-1); // coefficient of the shared value v
    M.push(row);
    b.push(0);
  }
  M.push([...new Array(k).fill(1), 0]); // normalization: probs sum to 1
  b.push(1);
  const x = solveLinearSystem(M, b);
  if (!x) return null;
  return { probs: x.slice(0, k), value: x[k] };
}

/**
 * All mixed-strategy Nash equilibria of a bimatrix game (A, B), found by
 * exhaustive support enumeration restricted to EQUAL support sizes for both
 * players — the standard restriction (non-degenerate games always satisfy
 * |supp(p)| = |supp(q)|; a degenerate game may have an additional equilibrium
 * with unequal support sizes that this function will not find).
 *
 * @param {number[][]} A  player 1's payoff matrix (rows = P1 actions, cols = P2 actions)
 * @param {number[][]} B  player 2's payoff matrix (same shape)
 * @param {object} [opts]
 * @param {number} [opts.maxSupportSize]  cap on support size searched (default min(rows,cols))
 * @param {number} [opts.maxCandidates]   refuse rather than enumerate beyond this many (support-pair) candidates (default 20000)
 * @param {number} [opts.tolerance]       numerical slack for best-response feasibility checks (default 1e-7)
 * @returns {{ok:true, equilibria:Array<{support1:number[],support2:number[],p:number[],q:number[],payoffs:[number,number]}>, candidatesExamined:number}
 *          |{ok:false, reason:'support_enumeration_exhausted', maxSupportSize:number, candidateCount:number}}
 */
export function mixedNashEquilibria(A, B, opts = {}) {
  if (!Array.isArray(A) || !A.length || !Array.isArray(A[0])) {
    return { ok: false, reason: "invalid_matrix" };
  }
  const m = A.length;
  const n = A[0].length;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const cap = Math.max(1, Math.min(opts.maxSupportSize ?? Math.min(m, n), Math.min(m, n)));

  let totalCandidates = 0;
  for (let k = 1; k <= cap; k++) totalCandidates += nChooseK(m, k) * nChooseK(n, k);
  if (totalCandidates > maxCandidates) {
    return {
      ok: false,
      reason: "support_enumeration_exhausted",
      maxSupportSize: cap,
      candidateCount: totalCandidates,
    };
  }

  const found = [];
  const seen = new Set();

  for (let k = 1; k <= cap; k++) {
    for (const R of combinations(m, k)) {
      for (const C of combinations(n, k)) {
        // q = opponent's (P2) mix over C that makes P1 indifferent across R,
        // using P1's own payoff matrix A[i][j] — natural indexing.
        const qSol = solveIndifference((i, j) => A[i][j], R, C);
        if (!qSol) continue;
        // p = opponent's (P1) mix over R that makes P2 indifferent across C,
        // using P2's own payoff matrix B[i][j] — but here the equation is
        // indexed by "my action" j (in C) against "opponent's action" i (in
        // R), i.e. getPayoff(myIdx=j, oppIdx=i) = B[i][j].
        const pSol = solveIndifference((j, i) => B[i][j], C, R);
        if (!pSol) continue;

        const q = qSol.probs;
        const p = pSol.probs;
        const v1 = qSol.value;
        const v2 = pSol.value;

        if (q.some((qi) => qi < -NONNEG_SLACK) || p.some((pi) => pi < -NONNEG_SLACK)) continue;
        const qSum = q.reduce((s, x) => s + x, 0);
        const pSum = p.reduce((s, x) => s + x, 0);
        if (Math.abs(qSum - 1) > 1e-6 || Math.abs(pSum - 1) > 1e-6) continue;

        // Best-response check: no action OUTSIDE the support beats the
        // indifference value achieved by the support.
        let ok = true;
        for (let i = 0; i < m && ok; i++) {
          if (R.includes(i)) continue;
          let payoff = 0;
          for (let t = 0; t < C.length; t++) payoff += A[i][C[t]] * q[t];
          if (payoff > v1 + tolerance) ok = false;
        }
        for (let j = 0; j < n && ok; j++) {
          if (C.includes(j)) continue;
          let payoff = 0;
          for (let t = 0; t < R.length; t++) payoff += B[R[t]][j] * p[t];
          if (payoff > v2 + tolerance) ok = false;
        }
        if (!ok) continue;

        const pFull = new Array(m).fill(0);
        R.forEach((i, t) => { pFull[i] = Math.max(0, p[t]); });
        const qFull = new Array(n).fill(0);
        C.forEach((j, t) => { qFull[j] = Math.max(0, q[t]); });

        const key = `${pFull.map((x) => x.toFixed(6)).join(",")}|${qFull.map((x) => x.toFixed(6)).join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);

        found.push({
          support1: R.slice(),
          support2: C.slice(),
          p: pFull,
          q: qFull,
          payoffs: [v1, v2],
        });
      }
    }
  }

  return { ok: true, equilibria: found, candidatesExamined: totalCandidates };
}

export default mixedNashEquilibria;
