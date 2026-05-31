// server/lib/game-theory/normal-form.js
//
// Engine N1 — game theory = COMPETING viability (the user's framing: "you have
// individual viability; you don't have competing viability"). Where the
// viability spine asks "does one agent stay in its set," this asks "what does a
// rational agent do when another agent's choice changes its payoff." The core
// primitives for faction-war resolution + NPC negotiation + auction/mechanism
// design: best response, pure-strategy Nash equilibria, dominant strategy, and
// the 2×2 cooperation-game taxonomy (prisoner's dilemma / stag hunt / chicken /
// harmony). Pure, deterministic, zero-dep.
//
// Convention: a game is two payoff matrices A, B (rows = player-1 actions,
// cols = player-2 actions). A[i][j] = P1's payoff, B[i][j] = P2's payoff.

/** Player 1's best-response row(s) to P2 playing column `j` (argmax over rows). */
export function bestResponseRow(A, j) {
  let best = -Infinity;
  const rows = [];
  for (let i = 0; i < A.length; i++) {
    const v = A[i][j];
    if (v > best) { best = v; rows.length = 0; rows.push(i); }
    else if (v === best) rows.push(i);
  }
  return rows;
}

/** Player 2's best-response col(s) to P1 playing row `i` (argmax over cols). */
export function bestResponseCol(B, i) {
  let best = -Infinity;
  const cols = [];
  const row = B[i];
  for (let j = 0; j < row.length; j++) {
    const v = row[j];
    if (v > best) { best = v; cols.length = 0; cols.push(j); }
    else if (v === best) cols.push(j);
  }
  return cols;
}

/**
 * All pure-strategy Nash equilibria — cells (i,j) that are a MUTUAL best
 * response (neither player can unilaterally improve). Returns [{ row, col,
 * payoffs:[a,b] }].
 */
export function pureNashEquilibria(A, B) {
  const eq = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < A[i].length; j++) {
      const p1ok = bestResponseRow(A, j).includes(i);
      const p2ok = bestResponseCol(B, i).includes(j);
      if (p1ok && p2ok) eq.push({ row: i, col: j, payoffs: [A[i][j], B[i][j]] });
    }
  }
  return eq;
}

/** Index of player 1's strictly dominant strategy (a row that beats every other
 * row in every column), or null. */
export function dominantStrategyRow(A) {
  for (let i = 0; i < A.length; i++) {
    let dominant = true;
    for (let k = 0; k < A.length && dominant; k++) {
      if (k === i) continue;
      for (let j = 0; j < A[i].length; j++) {
        if (!(A[i][j] > A[k][j])) { dominant = false; break; }
      }
    }
    if (dominant) return i;
  }
  return null;
}

/**
 * Classify a SYMMETRIC 2×2 cooperation game from its four payoffs (player's own
 * view): R = reward (both cooperate), T = temptation (defect vs cooperator),
 * S = sucker (cooperate vs defector), P = punishment (both defect).
 *   prisoner's dilemma : T > R > P > S   (defection dominant, tragic)
 *   chicken            : T > R > S > P   (mutual defection worst)
 *   stag hunt          : R > T ≥ P > S   (cooperation is risky-but-best)
 *   harmony            : R > T and R > P (cooperation dominant)
 * Returns the game name + whether mutual cooperation is a Nash equilibrium.
 */
export function classifyCooperationGame({ R, T, S, P }) {
  let name = "other";
  if (T > R && R > P && P > S) name = "prisoners_dilemma";
  else if (T > R && R > S && S > P) name = "chicken";
  else if (R > T && T >= P && P > S) name = "stag_hunt";
  else if (R >= T && R >= P) name = "harmony";
  // 2×2 symmetric: build the matrices (action 0 = cooperate, 1 = defect).
  const A = [[R, S], [T, P]];
  const B = [[R, T], [S, P]];
  const nash = pureNashEquilibria(A, B);
  const cooperationIsNash = nash.some((e) => e.row === 0 && e.col === 0);
  const defectionIsNash = nash.some((e) => e.row === 1 && e.col === 1);
  return { name, cooperationIsNash, defectionIsNash, nash };
}
