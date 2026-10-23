// server/lib/conkay/physics/solvers/mass-inertia-moment.js
//
// mass.inertia-moment: per-part + assembly inertia tensor (mass second moment).
//
// The existing mass.cg aggregator reports the full 6-component inertia tensor
// for the assembly as a whole; this solver does the same physics (parallel
// axis theorem in 3D) but works per-part AND produces a rollup, so a caller
// can inspect the contribution of each body separately.
//
// Pipeline:
//   1. For each part, compute the inertia tensor about its own COM in
//      principal axes:
//        - box      (full extents x, y, z): Ixx = m/12·(y²+z²),
//                                          Iyy = m/12·(x²+z²),
//                                          Izz = m/12·(x²+y²),
//                                          products zero by symmetry.
//        - cylinder (radius r, height h, axis along local z):
//                                          Izz = m/2·r²,
//                                          Ixx = Iyy = m/12·(3r²+h²),
//                                          products zero by symmetry.
//        - sphere   (radius r):            Ixx = Iyy = Izz = 2/5·m·r²,
//                                          products zero.
//   2. If a rotation matrix R is supplied for the part, rotate the own
//      tensor into world axes: I_local→world = R · I_local · Rᵀ. Otherwise
//      use the identity.
//   3. Translate each part's rotated tensor to the assembly frame via the
//      parallel-axis theorem: I_world = I_part + m·(|d|²·I₃ − d⊗d), where
//      d = (worldPos − assemblyCom). The outer-product term contributes to
//      the off-diagonal entries (products of inertia) whenever the parts do
//      not share the assembly's principal axes.
//   4. Sum the per-part world tensors to get the assembly tensor. It is
//      symmetric by construction.
//   5. Report the principal moments: eigenvalues of the (symmetric real)
//      assembly tensor, computed via the closed-form Cardano/trigonometric
//      method (never an iterative eigendecomposition, so the result is
//      reproducible bit-for-bit). If the closed form ever failed, fall
//      back to { notComputed: true, reason } and expose invariants only.
//
// Inputs:
//   parts: [{ id, massKg, shape: "box"|"cylinder"|"sphere", dims, comLocal:[x,y,z] }]
//     box:      dims = { x, y, z }    (full extents, m)
//     cylinder: dims = { r, h }       (radius, height, m; axis along local z)
//     sphere:   dims = { r }          (radius, m)
//   transforms?: { [partId]: { rotation3x3: [[3x3]], position:[x,y,z] } }
//   totalMassKg?: number              (cross-check; massErrorPct = 100·|M − total|/total)
//
// Output envelope:
//   {
//     status: "ok" | "not_computed",
//     reason?: string,
//     assemblyCom: [x,y,z],
//     totalMassKg: number,
//     massErrorPct: number|null,
//     parts: [{ id, massKg, worldPos:[x,y,z],
//               ownCom:[{ Ixx,Iyy,Izz,Ixy,Ixz,Iyz }],
//               worldTensor:[3x3] }],
//     assemblyTensor: [3x3],
//     principalMoments: { I1,I2,I3, eigenvalues, diagonal } | { notComputed, reason },
//     invariants: { trace, frobenius },
//   }

import { registerSolver } from "../registry.js";
import { graphTargets, graphRunner, envelope } from "./graph-adapter.js";

const IDENTITY3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ZERO3 = [0, 0, 0];

// partOwnInertia(shape, dims, m) -> { Ixx, Iyy, Izz, Ixy, Ixz, Iyz } | null
// Returns the inertia tensor of a single part about its own COM, in the
// part's principal axes (so the off-diagonal entries are zero for these
// shapes). Returns null on a shape we don't recognise or non-finite dims,
// so the caller can short-circuit with a labelled not_computed — we never
// silently fabricate a default.
function partOwnInertia(shape, dims, m) {
  if (!Number.isFinite(m) || m <= 0) return null;
  if (shape === "box") {
    const { x, y, z } = dims || {};
    if (![x, y, z].every(Number.isFinite)) return null;
    return {
      Ixx: (m / 12) * (y * y + z * z),
      Iyy: (m / 12) * (x * x + z * z),
      Izz: (m / 12) * (x * x + y * y),
      Ixy: 0, Ixz: 0, Iyz: 0,
    };
  }
  if (shape === "cylinder") {
    const { r, h } = dims || {};
    if (![r, h].every(Number.isFinite)) return null;
    return {
      Ixx: (m / 12) * (3 * r * r + h * h),
      Iyy: (m / 12) * (3 * r * r + h * h),
      Izz: (m / 2) * r * r,
      Ixy: 0, Ixz: 0, Iyz: 0,
    };
  }
  if (shape === "sphere") {
    const { r } = dims || {};
    if (!Number.isFinite(r)) return null;
    const v = (2 * m * r * r) / 5;
    return { Ixx: v, Iyy: v, Izz: v, Ixy: 0, Ixz: 0, Iyz: 0 };
  }
  return null;
}

function matMul3(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  }
  return C;
}

function applyRotationToTensor(R, I) {
  // Pack the 6-component tensor into a 3x3 matrix (symmetric) and conjugate
  // by R: I' = R · I · Rᵀ. Rᵀ is just the transpose since R is real.
  const I9 = [
    [I.Ixx, I.Ixy, I.Ixz],
    [I.Ixy, I.Iyy, I.Iyz],
    [I.Ixz, I.Iyz, I.Izz],
  ];
  const RI = matMul3(R, I9);
  const Rt = [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  return matMul3(RI, Rt);
}

function addTensors(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) C[i][j] = A[i][j] + B[i][j];
  return C;
}

function scaleTensor(A, s) {
  return A.map((row) => row.map((v) => v * s));
}

// parallelAxisTensor(worldPos, assemblyCom, mass, ownMat)
// Build the parallel-axis increment m·(|d|²·I₃ − d⊗d) and add it to ownMat.
function parallelAxisTensor(worldPos, assemblyCom, mass, ownMat) {
  const d = [worldPos[0] - assemblyCom[0], worldPos[1] - assemblyCom[1], worldPos[2] - assemblyCom[2]];
  const dNorm2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  // |d|²·I₃ − d⊗d
  const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      T[i][j] = (i === j ? dNorm2 : 0) - d[i] * d[j];
    }
  }
  return addTensors(ownMat, scaleTensor(T, mass));
}

function frobeniusNorm(M) {
  let s = 0;
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) s += M[i][j] * M[i][j];
  return Math.sqrt(s);
}

// symmetricEigenvalues3x3(M)
// Closed-form Cardano/trigonometric eigenvalues of a real symmetric 3x3.
// For a symmetric real matrix the characteristic polynomial has three real
// roots, which we recover without iteration:
//
//   characteristic poly: λ³ − e₁λ² + e₂λ − e₃ = 0
//     e₁ = tr(M)
//     e₂ = sum of 2×2 principal minors
//     e₃ = det(M)
//   decenter:   λ = t + e₁/3  →  t³ + p·t + q = 0
//     p = e₂ − e₁²/3          (≤ 0 for symmetric real M)
//     q = e₁·e₂/3 − 2·e₁³/27 − e₃
//   trig form:  let r = √(−p/3),  θ = acos(clamp(−q / (2·r³), −1, 1))
//     tₖ = 2r·cos((θ + 2πk)/3),  k = 0, 1, 2
//     λₖ = tₖ + e₁/3
//
// Returns an array [λ₀, λ₁, λ₂] in unsorted order, or null on failure.
function symmetricEigenvalues3x3(M) {
  const a = M[0][0], b = M[0][1], c = M[0][2], d = M[1][1], e = M[1][2], f = M[2][2];
  const e1 = a + d + f;
  const e2 = a * d + a * f + d * f - b * b - c * c - e * e;
  const e3 = a * d * f + 2 * b * c * e - a * e * e - d * c * c - f * b * b;

  const p = e2 - (e1 * e1) / 3;
  const q = (e1 * e2) / 3 - (2 * e1 * e1 * e1) / 27 - e3;

  // Symmetric real M ⇒ p ≤ 0 in exact arithmetic. Floating-point
  // cancellation can leave p as a tiny positive number (e.g. on an
  // isotropic tensor where p should be exactly zero), so the absolute
  // tolerance must be generous relative to |e1| but small relative to
  // typical e2 values. We treat |p| ≤ 1e-9·max(1,|e1|) as effectively
  // zero and recast as the triple / near-triple case.
  const pAbsTol = 1e-9 * Math.max(1, Math.abs(e1));
  const pEff = Math.abs(p) <= pAbsTol ? 0 : p;
  const qEff = Math.abs(q) <= pAbsTol ? 0 : q;

  if (pEff > 0) return null; // true violation (asymmetric noise) — refuse

  const negPover3 = -pEff / 3;

  if (negPover3 === 0) {
    // Triple (or near-triple) root: all eigenvalues equal tr(M)/3 when q ≈ 0.
    if (Math.abs(qEff) <= pAbsTol) {
      const v = e1 / 3;
      return [v, v, v];
    }
    // p = 0, q ≠ 0: cubic reduces to t³ = −q. For real symmetric M this is
    // not reachable in theory, but if it ever happens (numerical edge) we
    // refuse rather than ship a non-real branch.
    return null;
  }

  const r = Math.sqrt(negPover3);
  let arg = -q / (2 * r * r * r);
  if (arg < -1) arg = -1; else if (arg > 1) arg = 1;
  const theta = Math.acos(arg);
  const t0 = 2 * r * Math.cos(theta / 3) + e1 / 3;
  const t1 = 2 * r * Math.cos((theta + 2 * Math.PI) / 3) + e1 / 3;
  const t2 = 2 * r * Math.cos((theta + 4 * Math.PI) / 3) + e1 / 3;
  return [t0, t1, t2];
}

export function inertiaMoment({ parts, transforms, totalMassKg } = {}) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return { status: "not_computed", reason: "parts required" };
  }

  // Validate up front. Any failure short-circuits with the offending part id.
  for (const p of parts) {
    if (!p || typeof p.id !== "string") {
      return { status: "not_computed", reason: "part missing id" };
    }
    if (!Number.isFinite(p.massKg) || p.massKg <= 0) {
      return { status: "not_computed", reason: `part ${p.id}: invalid massKg` };
    }
    if (p.shape !== "box" && p.shape !== "cylinder" && p.shape !== "sphere") {
      return { status: "not_computed", reason: `part ${p.id}: unknown shape "${p.shape}"` };
    }
  }

  // World positions (3 vectors) and total mass.
  const worldPos = parts.map((p) => {
    const t = transforms && transforms[p.id];
    if (t && Array.isArray(t.position) && t.position.length === 3
      && t.position.every(Number.isFinite)) return [t.position[0], t.position[1], t.position[2]];
    if (Array.isArray(p.comLocal) && p.comLocal.length === 3
      && p.comLocal.every(Number.isFinite)) return [p.comLocal[0], p.comLocal[1], p.comLocal[2]];
    return [ZERO3[0], ZERO3[1], ZERO3[2]];
  });

  const M = parts.reduce((s, p) => s + p.massKg, 0);
  const com = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    let s = 0;
    for (let k = 0; k < parts.length; k += 1) s += parts[k].massKg * worldPos[k][i];
    com[i] = s / M;
  }

  // Per-part: own (diagonal, principal axes) → rotated into world axes →
  // translated to the assembly COM via the parallel-axis theorem.
  const outParts = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    const own = partOwnInertia(p.shape, p.dims, p.massKg);
    if (!own) {
      return { status: "not_computed", reason: `part ${p.id}: own inertia could not be computed` };
    }
    const t = transforms && transforms[p.id];
    const R = (t && Array.isArray(t.rotation3x3) && t.rotation3x3.length === 3
      && t.rotation3x3.every((row) => Array.isArray(row) && row.length === 3))
      ? t.rotation3x3
      : IDENTITY3;
    const ownMat = applyRotationToTensor(R, own);
    const worldMat = parallelAxisTensor(worldPos[i], com, p.massKg, ownMat);
    outParts.push({
      id: p.id,
      massKg: p.massKg,
      worldPos: worldPos[i],
      ownCom: [own],
      worldTensor: worldMat,
    });
  }

  // Sum: I_assembly = Σ I_world[i].
  const Iassy = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const op of outParts) {
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) Iassy[i][j] += op.worldTensor[i][j];
    }
  }

  const trace = Iassy[0][0] + Iassy[1][1] + Iassy[2][2];
  const frobenius = frobeniusNorm(Iassy);

  // Principal moments: closed-form symmetric 3x3 eigenvalues, then sort ascending.
  const eig = symmetricEigenvalues3x3(Iassy);
  let principalMoments;
  if (eig === null) {
    principalMoments = { notComputed: true, reason: "symmetric 3x3 eigenvalue solver failed (closed-form)" };
  } else {
    const sorted = eig.slice().sort((x, y) => x - y);
    principalMoments = {
      I1: sorted[0],
      I2: sorted[1],
      I3: sorted[2],
      eigenvalues: sorted,
      diagonal: [Iassy[0][0], Iassy[1][1], Iassy[2][2]],
    };
  }

  let massErrorPct = null;
  if (Number.isFinite(totalMassKg) && totalMassKg > 0) {
    massErrorPct = (100 * Math.abs(M - totalMassKg)) / totalMassKg;
  }

  return {
    status: "ok",
    assemblyCom: com,
    totalMassKg: M,
    massErrorPct,
    parts: outParts,
    assemblyTensor: Iassy,
    principalMoments,
    invariants: { trace, frobenius },
  };
}

registerSolver({
  id: "mass.inertia-moment",
  version: "1.0.0",
  domain: "mass",
  domains: ["mass"],
  method: "mass.inertia-tensor",
  fidelity: 1,
    // Graph-native: runs when any node carries props.mass.inertiaMoment.
  // The props subtree is passed straight through to inertiaMoment.
  targets: graphTargets("mass.inertiaMoment"),
  run: graphRunner("mass.inertiaMoment", (ctx, id, props) => envelope(inertiaMoment(props))),});