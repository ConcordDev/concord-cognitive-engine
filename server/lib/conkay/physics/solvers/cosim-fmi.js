// server/lib/conkay/physics/solvers/cosim-fmi.js
//
// cosim.fmi — SX-XC-08 (ConKay solver catalogue, Wave 0).
//
// The FMI co-simulation master algorithm at the JS tier
// (catalogue engine: SXE-15 + JS): two subsystems integrated
// independently over each macro-step, exchanging coupling
// values under Jacobi (parallel) or Gauss-Seidel
// (sequential) scheduling, with optional fixed-point
// iteration on the coupling and step-doubling step-size
// control. Coupling inputs are held constant across a
// macro-step (zero-order hold — the FMI co-simulation
// default). Real FMU import and coupling (Modelica, Chrono,
// CFD/FEA binaries) is SXE-15's tier and refuses by name:
// requires_engine_tier:sxe-15.
//
// The verification discipline mirrors verify.mms: the
// coupled run ships with its own split-vs-monolithic
// deviation, measured in the same run against a fine-step
// monolithic integration of the assembled system — the
// number a master algorithm is judged by, reported, never
// hidden.
//
// Catalogue reference case (FMI standard): the two-mass
// oscillator, split vs monolithic, within tolerance.

import { registerSolver } from "../registry.js";

/* Subsystem derivatives. State y = [x1, v1, x2, v2].
 * A (mass 1) sees B's exchanged (x2, v2); B sees A's (x1, v1). */
function derivA(y, exchB, P) {
  const f = -P.k1 * y[0] - P.c1 * y[1] + P.kc * (exchB[0] - y[0]) + P.cc * (exchB[1] - y[1]);
  return [y[1], f / P.m1];
}
function derivB(y, exchA, P) {
  const f = -P.c2 * y[3] - P.kc * (y[2] - exchA[0]) - P.cc * (y[3] - exchA[1]);
  return [y[3], f / P.m2];
}
function derivMono(y, P) {
  const a = derivA(y, [y[2], y[3]], P);
  const b = derivB(y, [y[0], y[1]], P);
  return [a[0], a[1], b[0], b[1]];
}
function rk4Step(y, h, deriv) {
  const k1 = deriv(y);
  const y2 = y.map((v, i) => v + (h / 2) * k1[i]);
  const k2 = deriv(y2);
  const y3 = y.map((v, i) => v + (h / 2) * k2[i]);
  const k3 = deriv(y3);
  const y4 = y.map((v, i) => v + h * k3[i]);
  const k4 = deriv(y4);
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/* RK4 with a time-varying coupling input (first-order hold):
 * derivT(y, tau) sees the input interpolated at local time tau. */
function rk4StepT(y, h, derivT) {
  const k1 = derivT(y, 0);
  const y2 = y.map((v, i) => v + (h / 2) * k1[i]);
  const k2 = derivT(y2, h / 2);
  const y3 = y.map((v, i) => v + (h / 2) * k2[i]);
  const k3 = derivT(y3, h / 2);
  const y4 = y.map((v, i) => v + h * k3[i]);
  const k4 = derivT(y4, h);
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

const lerp2 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/* One coupled macro-step of size H from state y, zero-order hold:
 * each subsystem sees the other's exchanged values as constants. */
function coupledStep(y, H, P, method) {
  const exchA0 = [y[0], y[1]];
  const exchB0 = [y[2], y[3]];
  let out;
  if (method === "jacobi") {
    const yA = rk4Step([y[0], y[1]], H, (yy) => derivA([yy[0], yy[1], 0, 0], exchB0, P));
    const yB = rk4Step([y[2], y[3]], H, (yy) => derivB([0, 0, yy[0], yy[1]], exchA0, P));
    out = [yA[0], yA[1], yB[0], yB[1]];
  } else {
    // gauss-seidel: A steps on B's start values, B steps on A's NEW values
    const yA = rk4Step([y[0], y[1]], H, (yy) => derivA([yy[0], yy[1], 0, 0], exchB0, P));
    const newA = [yA[0], yA[1]];
    const yB = rk4Step([y[2], y[3]], H, (yy) => derivB([0, 0, yy[0], yy[1]], newA, P));
    out = [yA[0], yA[1], yB[0], yB[1]];
  }
  return { y: out, exch: [[out[0], out[1]], [out[2], out[3]]] };
}

/* One coupled macro-step under fixed-point iteration with
 * first-order hold: each subsystem's coupling input is the
 * linear interpolation between the start-of-step value and
 * the current iterate's end value, and the sweep repeats
 * until the end values stop moving. (Iterating the ZOH map
 * instead — end values held constant — is a dissipative
 * implicit scheme with a worse error constant; measured
 * during this build and rejected for that reason.) */
function coupledStepIterated(y, H, P, method, iterate) {
  const startA = [y[0], y[1]];
  const startB = [y[2], y[3]];
  let endA = [...startA];
  let endB = [...startB];
  let out = null;
  for (let it = 1; it <= iterate.maxIterations; it += 1) {
    let yA;
    let yB;
    if (method === "jacobi") {
      yA = rk4StepT([y[0], y[1]], H, (yy, tau) => derivA([yy[0], yy[1], 0, 0], lerp2(startB, endB, tau / H), P));
      yB = rk4StepT([y[2], y[3]], H, (yy, tau) => derivB([0, 0, yy[0], yy[1]], lerp2(startA, endA, tau / H), P));
    } else {
      yA = rk4StepT([y[0], y[1]], H, (yy, tau) => derivA([yy[0], yy[1], 0, 0], lerp2(startB, endB, tau / H), P));
      const newEndA = [yA[0], yA[1]];
      yB = rk4StepT([y[2], y[3]], H, (yy, tau) => derivB([0, 0, yy[0], yy[1]], lerp2(startA, newEndA, tau / H), P));
    }
    out = [yA[0], yA[1], yB[0], yB[1]];
    const newEndA = [out[0], out[1]];
    const newEndB = [out[2], out[3]];
    const change = Math.max(
      Math.abs(newEndA[0] - endA[0]), Math.abs(newEndA[1] - endA[1]),
      Math.abs(newEndB[0] - endB[0]), Math.abs(newEndB[1] - endB[1]),
    );
    endA = newEndA;
    endB = newEndB;
    if (change <= iterate.tolerance) return { y: out, iters: it, converged: true };
  }
  return { y: out, iters: iterate.maxIterations, converged: false };
}

function energy(y, P) {
  return 0.5 * P.m1 * y[1] ** 2 + 0.5 * P.m2 * y[3] ** 2
    + 0.5 * P.k1 * y[0] ** 2 + 0.5 * P.kc * (y[2] - y[0]) ** 2;
}

function runCosim(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "fmu") return { notComputed: "requires_engine_tier:sxe-15" };
  if (target !== "cosim") {
    return { notComputed: `unknown_target:${target} (known: cosim, fmu)` };
  }
  const num = (v, name, ok, why) => (typeof v === "number" && Number.isFinite(v) && ok(v) ? null : `invalid_input:${name} ${why}`);
  const P = {
    m1: inputs.m1, m2: inputs.m2, k1: inputs.k1, kc: inputs.kc,
    cc: inputs.cc ?? 0, c1: inputs.c1 ?? 0, c2: inputs.c2 ?? 0,
  };
  for (const [name, v, ok, why] of [
    ["m1", P.m1, (x) => x > 0, "must be a positive mass"],
    ["m2", P.m2, (x) => x > 0, "must be a positive mass"],
    ["k1", P.k1, (x) => x >= 0, "must be a non-negative stiffness"],
    ["kc", P.kc, (x) => x > 0, "must be a positive coupling stiffness"],
    ["cc", P.cc, (x) => x >= 0, "must be non-negative"],
    ["c1", P.c1, (x) => x >= 0, "must be non-negative"],
    ["c2", P.c2, (x) => x >= 0, "must be non-negative"],
  ]) {
    const bad = num(v, name, ok, why);
    if (bad) return { notComputed: bad };
  }
  const init = inputs.initial;
  if (!init || ![init.x1, init.v1, init.x2, init.v2].every(Number.isFinite)) {
    return { notComputed: "missing_input:initial {x1, v1, x2, v2} — all four initial states are required (SC-03: no assumed values)" };
  }
  const tEnd = inputs.tEnd;
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { notComputed: "invalid_input:tEnd must be a positive finite time" };
  const method = inputs.method ?? "gauss-seidel";
  if (!["jacobi", "gauss-seidel"].includes(method)) {
    return { notComputed: `invalid_input:method '${method}' (one of: jacobi, gauss-seidel)` };
  }
  let H = inputs.stepSize;
  if (!Number.isFinite(H) || H <= 0 || H > tEnd) return { notComputed: "invalid_input:stepSize must be positive and no larger than tEnd" };
  const adaptive = inputs.adaptive ?? null;
  if (adaptive !== null && (!Number.isFinite(adaptive.tolerance) || adaptive.tolerance <= 0)) {
    return { notComputed: "invalid_input:adaptive.tolerance must be a positive finite number" };
  }
  const iterate = inputs.iterate ?? null;
  if (iterate !== null && (!Number.isFinite(iterate.tolerance) || iterate.tolerance <= 0
    || !Number.isInteger(iterate.maxIterations) || iterate.maxIterations < 1 || iterate.maxIterations > 100)) {
    return { notComputed: "invalid_input:iterate needs tolerance > 0 and integer maxIterations in [1, 100]" };
  }

  const warnings = [];
  let y = [init.x1, init.v1, init.x2, init.v2];
  let yMono = [...y];
  const E0 = energy(y, P);
  let t = 0;
  let accepted = 0;
  let rejected = 0;
  let minH = H;
  let maxH = H;
  let iterTotal = 0;
  let iterNonConverged = 0;
  let maxDeviation = 0;
  const samples = [{ t: 0, x1: y[0], v1: y[1], x2: y[2], v2: y[3] }];
  const monoStep = (from, to) => {
    let yy = from;
    const n = Math.max(1, Math.ceil((to - t) / (H / 20)));
    const h = (to - t) / n;
    for (let i = 0; i < n; i += 1) yy = rk4Step(yy, h, (s) => derivMono(s, P));
    return yy;
  };
  let guard = 0;
  while (t < tEnd - 1e-12) {
    guard += 1;
    if (guard > 200000) return { notComputed: "size_above_envelope:the run exceeded 200000 macro-steps at the JS tier (shorten tEnd or raise stepSize)" };
    const hTry = Math.min(H, tEnd - t);
    const stepOnce = (yy, hh) => {
      if (!iterate) return { y: coupledStep(yy, hh, P, method).y, iters: 1, converged: true };
      return coupledStepIterated(yy, hh, P, method, iterate);
    };
    let result;
    if (adaptive) {
      const one = stepOnce(y, hTry);
      const half1 = stepOnce(y, hTry / 2);
      const half2 = stepOnce(half1.y, hTry / 2);
      const err = Math.max(...half2.y.map((v, i) => Math.abs(v - one.y[i])));
      if (err > adaptive.tolerance && hTry > 1e-9) {
        rejected += 1;
        H = Math.max(1e-9, hTry * Math.max(0.25, 0.9 * Math.sqrt(adaptive.tolerance / err)));
        continue;
      }
      result = half2;
      iterTotal += half2.iters ?? 1;
      H = Math.min(inputs.stepSize, hTry * (err === 0 ? 2 : Math.min(2, Math.max(0.5, 0.9 * Math.sqrt(adaptive.tolerance / Math.max(err, 1e-300))))));
    } else {
      result = stepOnce(y, hTry);
      iterTotal += result.iters;
    }
    if (iterate && !result.converged) iterNonConverged += 1;
    y = result.y;
    const tNew = t + hTry;
    yMono = monoStep(yMono, tNew);
    t = tNew;
    accepted += 1;
    minH = Math.min(minH, hTry);
    maxH = Math.max(maxH, hTry);
    const dev = Math.max(...y.map((v, i) => Math.abs(v - yMono[i])));
    maxDeviation = Math.max(maxDeviation, dev);
    if (samples.length < 1001) samples.push({ t, x1: y[0], v1: y[1], x2: y[2], v2: y[3] });
  }
  if (iterNonConverged > 0) {
    warnings.push(`coupling iteration did not converge within maxIterations on ${iterNonConverged} macro-step(s) — the last iterate was used and is flagged, per master-algorithm practice`);
  }
  const undamped = P.cc === 0 && P.c1 === 0 && P.c2 === 0;
  const outputs = {
    method,
    finalState: { x1: y[0], v1: y[1], x2: y[2], v2: y[3] },
    monolithicFinalState: { x1: yMono[0], v1: yMono[1], x2: yMono[2], v2: yMono[3] },
    maxDeviation,
    deviationBasis: "max |split - monolithic| over all four states at macro-step boundaries; monolithic integrated at stepSize/20 RK4 in the same run",
    steps: { accepted, rejected, minStep: minH, maxStep: maxH },
    couplingIterations: iterate ? { total: iterTotal, nonConvergedSteps: iterNonConverged } : null,
    samples,
  };
  if (undamped && E0 !== 0) outputs.energyDrift = (energy(y, P) - E0) / Math.abs(E0);
  return {
    inputs: { m1: P.m1, m2: P.m2, k1: P.k1, kc: P.kc, cc: P.cc, c1: P.c1, c2: P.c2, initial: init, tEnd, method, stepSize: inputs.stepSize, ...(adaptive ? { adaptive } : {}), ...(iterate ? { iterate } : {}) },
    outputs,
    ...(warnings.length ? { warnings } : {}),
    margins: [],
    covers: [target],
  };
}

export const cosimFmi = registerSolver({
  id: "cosim.fmi",
  version: "1.0.0",
  domain: "cosim",
  domains: ["cosim", "mechanics"],
  fidelity: 3,
  method: "FMI co-simulation master algorithm: Jacobi / Gauss-Seidel scheduling, zero-order-hold coupling, fixed-point coupling iteration, step-doubling step-size control; split-vs-monolithic deviation measured in-run (FMI standard, fmi-standard.org)",
  reference: "FMI standard (fmi-standard.org) — reference case: two-mass oscillator (m1 = m2 = 1, k1 = 4, kc = 6) split vs monolithic within declared tolerance; analytic normal modes omega = sqrt(8 -/+ 2*sqrt(10))",
  regime: "the built-in two-mass reference system at the JS tier (catalogue engine 'SXE-15 + JS'); macro-steps capped at 200000, trajectory samples at 1001; real FMU import/coupling is requires_engine_tier:sxe-15",
  units: { inputs: "masses (kg), stiffnesses (N/m), dampings (N s/m), states (m, m/s), times (s) — FMI-compliant SI declarations", outputs: "trajectories and deviations in the same units" },
  tolerance: "declared per run: adaptive.tolerance (step-doubling) and iterate.tolerance (coupling fixed point); the reference case pins maxDeviation < 2e-3 at stepSize 0.005 with Gauss-Seidel + iteration",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runCosim,
});
