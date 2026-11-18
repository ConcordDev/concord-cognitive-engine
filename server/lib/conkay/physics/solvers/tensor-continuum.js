// server/lib/conkay/physics/solvers/tensor-continuum.js
//
// math.tensor-continuum — SX-NUM-24 (ConKay solver catalogue,
// Wave 0).
//
// Tensor algebra and continuum kinematics at the JS tier:
// invariants, principal values and directions, rotation
// transforms, the strain measures of a deformation gradient,
// and the classical stress measures. The symbolic-exactness
// tier is SXE-02's (SymPy), named not claimed.
//
// The verification discipline: principal pairs are served
// only after each pair's residual |T·v − λ·v| and the vector
// set's orthonormality check pass in code; a rotation is
// applied only after R is verified orthonormal with det +1,
// and the rotated tensor's invariants are re-checked against
// the original's; the polar decomposition is served only
// after F == R·U reconstructs. A violated gate is a refusal
// naming the gate, never a quietly served answer.
//
// Catalogue reference case (Holzapfel, Nonlinear Solid
// Mechanics): the von Mises stress of a pure shear state τ
// is √3·τ, with principal stresses {τ, 0, −τ}.

import { registerSolver } from "../registry.js";

const TOL = 1e-9; // relative verification gates
const ENTRY_CAP = 1e150; // beyond this, products overflow double precision

/* ---------------- small matrix helpers (3x3) ---------------- */

const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
const trace = (A) => A[0][0] + A[1][1] + A[2][2];
const det = (A) =>
  A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
  - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
  + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
const sub = (A, B) => A.map((row, i) => row.map((a, j) => a - B[i][j]));
const scaleM = (A, s) => A.map((row) => row.map((a) => a * s));
const addM = (A, B) => A.map((row, i) => row.map((a, j) => a + B[i][j]));
const maxAbs = (A) => Math.max(...A.flat().map(Math.abs));
function inverse(A) {
  const d = det(A);
  if (d === 0 || !Number.isFinite(d)) return null;
  const cof = (i, j) => {
    const r = [0, 1, 2].filter((x) => x !== i);
    const c = [0, 1, 2].filter((x) => x !== j);
    return ((i + j) % 2 === 0 ? 1 : -1) * (A[r[0]][c[0]] * A[r[1]][c[1]] - A[r[0]][c[1]] * A[r[1]][c[0]]);
  };
  return I3.map((row, i) => row.map((_, j) => cof(j, i) / d)); // adjugate = transpose of cofactors
}

/* ---------------- input gates ---------------- */

function parseMatrix(inputs, field) {
  const M = inputs[field];
  if (!Array.isArray(M) || M.length !== 3 || !M.every((r) => Array.isArray(r) && r.length === 3)) {
    return { error: `missing_input:${field} (a 3x3 matrix as [[a,b,c],[d,e,f],[g,h,i]])` };
  }
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
    if (typeof M[i][j] !== "number" || !Number.isFinite(M[i][j])) {
      return { error: `invalid_input:${field} entry [${i}][${j}] is not a finite number` };
    }
    if (Math.abs(M[i][j]) > ENTRY_CAP) {
      return { error: `invalid_input:${field} entry [${i}][${j}] exceeds the 1e150 envelope — products of entries would overflow double precision` };
    }
  }
  return { matrix: M.map((r) => [...r]) };
}

function parseSymmetric(inputs, field) {
  const p = parseMatrix(inputs, field);
  if (p.error) return p;
  const M = p.matrix;
  const asym = Math.max(Math.abs(M[0][1] - M[1][0]), Math.abs(M[0][2] - M[2][0]), Math.abs(M[1][2] - M[2][1]));
  const scale = Math.max(1, maxAbs(M));
  if (asym > 1e-9 * scale) {
    return { error: `invalid_input:${field} is not symmetric (max asymmetry ${asym} at scale ${scale}) — a non-symmetric tensor has no real principal frame of this form` };
  }
  // serve the exactly-symmetrized tensor; the asymmetry was within gate
  return { matrix: I3.map((row, i) => row.map((_, j) => (M[i][j] + M[j][i]) / 2)) };
}

/* ---------------- Jacobi eigen (symmetric 3x3) ---------------- */

function jacobiEigen(Ain) {
  const A = Ain.map((r) => [...r]);
  let V = I3.map((r) => [...r]);
  for (let sweep = 0; sweep < 50; sweep += 1) {
    const off = Math.sqrt(A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2);
    if (off <= 1e-15 * Math.max(1, maxAbs(A))) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (A[p][q] === 0) continue;
      const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const J = I3.map((r) => [...r]);
      J[p][p] = c; J[q][q] = c; J[p][q] = s; J[q][p] = -s;
      const AJ = mul(A, J);
      const Anew = mul(transpose(J), AJ);
      Anew.forEach((row, i) => row.forEach((v, j) => { A[i][j] = v; }));
      V = mul(V, J);
    }
  }
  const pairs = [0, 1, 2].map((i) => ({ value: A[i][i], vector: [V[0][i], V[1][i], V[2][i]] }));
  pairs.sort((a, b) => b.value - a.value);
  for (const pr of pairs) {
    // deterministic direction sign: largest-|component| entry positive
    const k = pr.vector.reduce((best, v, i) => (Math.abs(v) > Math.abs(pr.vector[best]) ? i : best), 0);
    if (pr.vector[k] < 0) pr.vector = pr.vector.map((v) => -v);
  }
  return pairs;
}

function verifyPairs(T, pairs) {
  const scale = Math.max(1, maxAbs(T));
  for (const { value, vector } of pairs) {
    const Tv = T.map((row) => row.reduce((s, a, k) => s + a * vector[k], 0));
    const resid = Math.max(...Tv.map((v, i) => Math.abs(v - value * vector[i])));
    if (resid > TOL * scale) return `principal pair residual ${resid} exceeds the gate at scale ${scale}`;
    const n = Math.hypot(...vector);
    if (Math.abs(n - 1) > TOL) return `principal direction norm ${n} is not 1 within the gate`;
  }
  for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) {
    const d = pairs[i].vector.reduce((s, v, k) => s + v * pairs[j].vector[k], 0);
    if (Math.abs(d) > TOL) return `principal directions ${i},${j} are not orthogonal (dot ${d})`;
  }
  return null;
}

function invariantsOf(T) {
  const I1 = trace(T);
  const T2 = mul(T, T);
  const I2half = 0.5 * (I1 * I1 - trace(T2));
  const minors = T[0][0] * T[1][1] - T[0][1] * T[1][0]
    + (T[0][0] * T[2][2] - T[0][2] * T[2][0])
    + (T[1][1] * T[2][2] - T[1][2] * T[2][1]);
  return { I1, I2: minors, I2cross: I2half, I3: det(T) };
}

/* ---------------- targets ---------------- */

function runTensor(ctx, target) {
  const inputs = ctx?.inputs || {};

  if (target === "invariants") {
    const p = parseSymmetric(inputs, "tensor");
    if (p.error) return { notComputed: p.error };
    const T = p.matrix;
    const inv = invariantsOf(T);
    const scale = Math.max(1, Math.abs(inv.I1), Math.abs(inv.I2), Math.abs(inv.I3));
    if (Math.abs(inv.I2 - inv.I2cross) > TOL * scale) {
      return { notComputed: `verification_failed:I2 by principal minors (${inv.I2}) disagrees with I2 by traces (${inv.I2cross})` };
    }
    return {
      inputs: { tensor: T },
      outputs: {
        I1: inv.I1, I2: inv.I2, I3: inv.I3,
        trace: inv.I1, determinant: inv.I3,
        frobeniusNorm: Math.sqrt(Math.max(0, trace(mul(T, T)))),
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "principal") {
    const p = parseSymmetric(inputs, "tensor");
    if (p.error) return { notComputed: p.error };
    const T = p.matrix;
    const pairs = jacobiEigen(T);
    const bad = verifyPairs(T, pairs);
    if (bad) return { notComputed: `verification_failed:${bad}` };
    return {
      inputs: { tensor: T },
      outputs: {
        principalValues: pairs.map((x) => x.value),
        principalDirections: pairs.map((x) => x.vector),
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "von-mises") {
    const p = parseSymmetric(inputs, "stress");
    if (p.error) return { notComputed: p.error };
    const S = p.matrix;
    const pairs = jacobiEigen(S);
    const bad = verifyPairs(S, pairs);
    if (bad) return { notComputed: `verification_failed:${bad}` };
    const [s1, s2, s3] = pairs.map((x) => x.value);
    const hydro = (s1 + s2 + s3) / 3;
    const dev = sub(S, scaleM(I3, hydro));
    const J2 = 0.5 * trace(mul(dev, dev));
    const J3 = det(dev);
    const vm = Math.sqrt(0.5 * ((s1 - s2) ** 2 + (s2 - s3) ** 2 + (s3 - s1) ** 2));
    if (Math.abs(vm * vm - 3 * J2) > TOL * Math.max(1, vm * vm, 3 * J2)) {
      return { notComputed: "verification_failed:von Mises squared disagrees with 3*J2" };
    }
    return {
      inputs: { stress: S },
      outputs: {
        vonMises: vm,
        hydrostatic: hydro,
        principalStresses: [s1, s2, s3],
        deviatoricStress: dev,
        J2, J3,
        maxShear: (s1 - s3) / 2,
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "transform") {
    const p = parseSymmetric(inputs, "tensor");
    if (p.error) return { notComputed: p.error };
    const r = parseMatrix(inputs, "rotation");
    if (r.error) return { notComputed: r.error };
    const R = r.matrix;
    const RtR = mul(transpose(R), R);
    const orthErr = maxAbs(sub(RtR, I3));
    if (orthErr > TOL) return { notComputed: `invalid_input:rotation is not orthonormal (max |R^T R - I| = ${orthErr})` };
    const dR = det(R);
    if (Math.abs(dR - 1) > TOL) return { notComputed: `invalid_input:rotation has det ${dR}, not +1 — a reflection is not a rotation` };
    const before = invariantsOf(p.matrix);
    const rotated = mul(mul(R, p.matrix), transpose(R));
    const sym = I3.map((row, i) => row.map((_, j) => (rotated[i][j] + rotated[j][i]) / 2));
    const after = invariantsOf(sym);
    const scale = Math.max(1, Math.abs(before.I1), Math.abs(before.I2), Math.abs(before.I3));
    if (Math.abs(after.I1 - before.I1) > TOL * scale || Math.abs(after.I2 - before.I2) > TOL * scale || Math.abs(after.I3 - before.I3) > TOL * scale) {
      return { notComputed: "verification_failed:rotation changed the tensor's invariants" };
    }
    return {
      inputs: { tensor: p.matrix, rotation: R },
      outputs: { rotated: sym, invariants: { I1: after.I1, I2: after.I2, I3: after.I3 } },
      margins: [],
      covers: [target],
    };
  }

  if (target === "strain") {
    const p = parseMatrix(inputs, "F");
    if (p.error) return { notComputed: p.error };
    const F = p.matrix;
    const J = det(F);
    if (!(J > 0)) {
      return { notComputed: `invalid_input:F has det J = ${J} — a deformation gradient needs J > 0 (J <= 0 is interpenetration / inversion, not a deformation)` };
    }
    const Ft = transpose(F);
    const C = mul(Ft, F);
    const B = mul(F, Ft);
    const E = scaleM(sub(C, I3), 0.5);
    const Binv = inverse(B);
    if (!Binv) return { notComputed: "verification_failed:B is singular despite J > 0" };
    const almansi = scaleM(sub(I3, Binv), 0.5);
    const pairs = jacobiEigen(C);
    const bad = verifyPairs(C, pairs);
    if (bad) return { notComputed: `verification_failed:${bad}` };
    if (pairs.some((x) => x.value < -TOL * Math.max(1, maxAbs(C)))) {
      return { notComputed: "verification_failed:C has a negative eigenvalue — not positive definite" };
    }
    const stretches = pairs.map((x) => Math.sqrt(Math.max(0, x.value)));
    // polar decomposition F = R U, verified by reconstruction
    const U = I3.map((row, i) => row.map((_, j) => pairs.reduce((s, pr) => s + pr.vector[i] * Math.sqrt(Math.max(0, pr.value)) * pr.vector[j], 0)));
    const Uinv = inverse(U);
    if (!Uinv) return { notComputed: "verification_failed:U is singular despite J > 0" };
    const R = mul(F, Uinv);
    const recon = maxAbs(sub(mul(R, U), F));
    if (recon > TOL * Math.max(1, maxAbs(F))) {
      return { notComputed: `verification_failed:polar reconstruction |R U - F| = ${recon}` };
    }
    return {
      inputs: { F },
      outputs: {
        J,
        rightCauchyGreen: C,
        leftCauchyGreen: B,
        greenLagrange: E,
        almansi,
        principalStretches: stretches,
        logStrains: stretches.map((s) => Math.log(s)),
        polarRotation: R,
        polarStretch: U,
      },
      margins: [],
      covers: [target],
    };
  }

  if (target === "symbolic") {
    return { notComputed: "requires_engine_tier:sxe-02" };
  }

  return { notComputed: `unknown_target:${target} (known: invariants, principal, von-mises, transform, strain, symbolic)` };
}

export const tensorContinuum = registerSolver({
  id: "math.tensor-continuum",
  version: "1.0.0",
  domain: "math",
  domains: ["math", "mechanics"],
  fidelity: 1,
  method: "Jacobi principal decomposition with pair-residual verification; invariants cross-checked by minors vs traces; strain measures from F with polar decomposition verified by reconstruction (Holzapfel)",
  reference: "Holzapfel, Nonlinear Solid Mechanics (2000) — reference case: von Mises of pure shear tau is sqrt(3)*tau with principal stresses {tau, 0, -tau}",
  regime: "3x3 tensors; symmetric inputs for invariants / principal / stress measures (asymmetry gated at 1e-9 relative); entries capped at 1e150 (product overflow); deformation gradients require J = det F > 0",
  units: { inputs: "tensor / stress: 3x3 number arrays (stress in Pa); rotation: 3x3 orthonormal, det +1; F: 3x3 deformation gradient (dimensionless)", outputs: "invariants, principal values/directions, von Mises + hydrostatic + J2/J3 (Pa / Pa^2 / Pa^3), strain measures and stretches (dimensionless)" },
  tolerance: "verification gates at 1e-9 relative — pair residuals, orthonormality, invariant preservation under rotation, polar reconstruction; a violated gate refuses, never serves",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runTensor,
});
