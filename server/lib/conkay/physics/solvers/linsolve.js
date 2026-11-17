// server/lib/conkay/physics/solvers/linsolve.js
//
// math.linsolve — SX-NUM-03 (ConKay solver catalogue, Wave 0).
//
// Dense linear systems at the JS tier: LU with partial pivoting
// (Golub & Van Loan, Matrix Computations 4e) and Cholesky for
// symmetric positive definite systems. Every solve is verified by
// substitution — the residual ||Ax - b||inf is computed against the
// ORIGINAL system and a residual beyond tolerance FAILs the result
// rather than serving it quietly.
//
// Condition discipline is the row's own validity envelope: the
// 1-norm condition estimate (from the LU factors, the LAPACK way)
// is computed on every call; cond > 1e12 is REFUSED
// (condition_above_envelope) unless the caller declares acceptance
// (acceptIllConditioned), in which case the answer is served with
// a warning, labelled. Singular matrices are NOT_COMPUTED
// singular_matrix with the failing pivot named.
//
// The engine class — QR, sparse direct (SuperLU), Krylov iterators
// (CG/GMRES/BiCGSTAB via PETSc) — is refused by name as
// requires_engine_tier:lapack-petsc. Dense size cap n <= 128 at
// this tier; larger systems name the same engine tier.

import { registerSolver } from "../registry.js";

const COND_LIMIT = 1e12;
const MAX_N = 128;
const RESID_RTOL = 1e-8;

function validateMatrix(A) {
  if (!Array.isArray(A) || A.length === 0) return "A must be a non-empty array of rows";
  const n = A.length;
  if (n > MAX_N) return `system size ${n} exceeds the dense JS tier cap ${MAX_N} (engine tier)`;
  for (const row of A) {
    if (!Array.isArray(row) || row.length !== n) return "A must be square (every row has n entries)";
    for (const v of row) if (!Number.isFinite(v)) return "A contains a non-finite entry";
  }
  return null;
}

/** LU with partial pivoting. Returns {lu, perm, sign, singularAt} — lu packs L (unit) and U. */
export function luFactor(A) {
  const n = A.length;
  const lu = A.map((row) => row.slice());
  const perm = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  for (let k = 0; k < n; k += 1) {
    let piv = k;
    for (let i = k + 1; i < n; i += 1) if (Math.abs(lu[i][k]) > Math.abs(lu[piv][k])) piv = i;
    if (lu[piv][k] === 0) return { singularAt: k };
    if (piv !== k) {
      [lu[k], lu[piv]] = [lu[piv], lu[k]];
      [perm[k], perm[piv]] = [perm[piv], perm[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i += 1) {
      lu[i][k] /= lu[k][k];
      const lik = lu[i][k];
      for (let j = k + 1; j < n; j += 1) lu[i][j] -= lik * lu[k][j];
    }
  }
  return { lu, perm, sign };
}

function luSolve({ lu, perm }, b) {
  const n = lu.length;
  const y = perm.map((p) => b[p]);
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) y[i] -= lu[i][j] * y[j];
  }
  const x = y.slice();
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < n; j += 1) x[i] -= lu[i][j] * x[j];
    x[i] /= lu[i][i];
  }
  return x;
}

function luInverse(fact) {
  const n = fact.lu.length;
  const inv = [];
  for (let c = 0; c < n; c += 1) {
    const e = Array.from({ length: n }, (_, i) => (i === c ? 1 : 0));
    const col = luSolve(fact, e);
    for (let r = 0; r < n; r += 1) {
      inv[r] = inv[r] || [];
      inv[r][c] = col[r];
    }
  }
  return inv;
}

const norm1 = (A) => {
  const n = A.length;
  let best = 0;
  for (let j = 0; j < n; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Math.abs(A[i][j]);
    best = Math.max(best, s);
  }
  return best;
};

const matVec = (A, x) => A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
const residualInf = (A, x, b) => {
  const ax = matVec(A, x);
  return Math.max(...ax.map((v, i) => Math.abs(v - b[i])));
};

/** Cholesky factor L (lower) for SPD A; returns {L} or {notSpdAt}. */
export function choleskyFactor(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i][j];
      for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return { notSpdAt: i };
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return { L };
}

function choleskySolve(L, b) {
  const n = L.length;
  const y = b.slice();
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) y[i] -= L[i][j] * y[j];
    y[i] /= L[i][i];
  }
  const x = y.slice();
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < n; j += 1) x[i] -= L[j][i] * x[j];
    x[i] /= L[i][i];
  }
  return x;
}

const isSymmetric = (A) => A.every((row, i) => row.every((v, j) => v === A[j][i]));

function condGate(ctx, A, fact) {
  const inv = luInverse(fact);
  const cond = norm1(A) * norm1(inv);
  if (cond > COND_LIMIT && ctx?.inputs?.acceptIllConditioned !== true) {
    return { refusal: `condition_above_envelope:cond_1 = ${cond.toExponential(3)} exceeds the declared envelope limit ${COND_LIMIT} (declare acceptIllConditioned to proceed, labelled)` };
  }
  return { cond, inv };
}

function runLinsolve(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (["qr", "sparse", "iterative"].includes(target)) {
    return { notComputed: `requires_engine_tier:lapack-petsc (${target} rides the engine framework; the JS tier is dense LU/Cholesky)` };
  }
  if (!["solve", "inverse", "det"].includes(target)) return { notComputed: `unknown_operation:${target}` };
  const bad = validateMatrix(inputs.A);
  if (bad) return { notComputed: `invalid_input:A ${bad}` };
  const A = inputs.A;
  const n = A.length;
  const fact = luFactor(A);
  if (fact.singularAt !== undefined) {
    return { notComputed: `singular_matrix:zero pivot at column ${fact.singularAt} under partial pivoting (rank < ${n})` };
  }
  if (target === "det") {
    let det = fact.sign;
    for (let i = 0; i < n; i += 1) det *= fact.lu[i][i];
    return { inputs: { n }, outputs: { determinant: det }, margins: [], covers: [target] };
  }
  const gate = condGate(ctx, A, fact);
  if (gate.refusal) return { notComputed: gate.refusal };
  const warnings = gate.cond > COND_LIMIT
    ? [`ill-conditioned system served under declared acceptance: cond_1 = ${gate.cond.toExponential(3)} > ${COND_LIMIT}; forward error may be large even with a small residual`]
    : [];
  if (target === "inverse") {
    return {
      inputs: { n },
      outputs: { inverse: gate.inv, condition1: gate.cond },
      margins: [],
      ...(warnings.length ? { warnings } : {}),
      covers: [target],
    };
  }
  // solve
  const b = inputs.b;
  if (!Array.isArray(b) || b.length !== n || b.some((v) => !Number.isFinite(v))) {
    return { notComputed: `invalid_input:b must be an array of ${n} finite numbers` };
  }
  const method = inputs.method === undefined ? "lu" : inputs.method;
  let x;
  let methodUsed = "lu-partial-pivoting";
  if (method === "cholesky") {
    if (!isSymmetric(A)) return { notComputed: "invalid_input:method cholesky requires a symmetric matrix" };
    const cf = choleskyFactor(A);
    if (cf.notSpdAt !== undefined) {
      return { notComputed: `not_positive_definite:cholesky pivot ${cf.notSpdAt} is not positive — the matrix is not SPD` };
    }
    x = choleskySolve(cf.L, b);
    methodUsed = "cholesky";
  } else if (method !== "lu") {
    return { notComputed: `invalid_input:method ${method} (the JS tier offers lu and cholesky)` };
  } else {
    x = luSolve(fact, b);
  }
  const resid = residualInf(A, x, b);
  const bScale = Math.max(1, Math.max(...b.map(Math.abs)));
  if (resid > RESID_RTOL * bScale) {
    return {
      inputs: { n, method: methodUsed },
      outputs: { x, residualInf: resid, condition1: gate.cond },
      margins: [],
      failures: [{ name: "residual_check", detail: `||Ax - b||inf = ${resid} exceeds ${RESID_RTOL} * ||b|| scale — the computed solution fails substitution` }],
      covers: [target],
    };
  }
  return {
    inputs: { n, method: methodUsed },
    outputs: { x, residualInf: resid, condition1: gate.cond, determinant: (() => { let d = fact.sign; for (let i = 0; i < n; i += 1) d *= fact.lu[i][i]; return d; })() },
    margins: [],
    ...(warnings.length ? { warnings } : {}),
    covers: [target],
  };
}

export const linsolve = registerSolver({
  id: "math.linsolve",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "dense LU with partial pivoting and Cholesky (JS tier); QR / sparse direct / Krylov via the LAPACK-PETSc engine tier, refused by name here",
  reference: "Golub & Van Loan, Matrix Computations 4e; NIST Matrix Market reference cases",
  regime: "dense systems n <= 128 at this tier; condition envelope: cond_1 > 1e12 refused unless declared (acceptIllConditioned)",
  units: { inputs: "dimensionless coefficient matrix A and right-hand side b", outputs: "solution x, determinant, inverse, condition estimate, residual" },
  tolerance: "residual ||Ax-b||inf <= 1e-8 * max(1, ||b||inf), verified by substitution on every solve",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runLinsolve,
});
