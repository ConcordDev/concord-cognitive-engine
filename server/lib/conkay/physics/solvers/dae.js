// server/lib/conkay/physics/solvers/dae.js
//
// math.dae — SX-NUM-08 (ConKay solver catalogue, Wave 0).
//
// Differential-algebraic equations at the JS tier, in the
// semi-explicit index-1 form
//
//     y' = f(t, y, z),   0 = g(t, y, z),
//
// with f and g as DATA — expression lists over the math.symbolic
// grammar (variables t, y0.., z0..). Integration is by SDIRK2
// (Alexander 1977: singly diagonally implicit, L-stable, order
// 2) with Newton stage solves over a finite-difference Jacobian
// (labelled as such), adaptive step control, and consistent
// initialization: the algebraic state at t0 is SOLVED from
// g = 0 and reported, never assumed. A constraint whose Jacobian
// in z is singular is not index-1 here and is refused by name —
// general index reduction (Pantelides) and IDA are the SUNDIALS
// engine tier.
//
// The reference problem is the Hairer & Wanner Cartesian
// pendulum (index-3 as posed). It is decided through its
// twice-differentiated constraint — the standard analytic
// reduction — which is exactly an index-1 system in
// (x, y, vx, vy; lambda); the solver reports the ORIGINAL
// constraint drift and the energy drift over the run, which is
// the reference case's acceptance quantity.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";
import { luFactor } from "./linsolve.js";

const GAMMA = 1 - Math.SQRT1_2; // 1 - sqrt(2)/2, SDIRK2 coefficient

function compileSystem(inputs) {
  const { f, g } = inputs;
  if (!Array.isArray(f) || f.length === 0 || f.some((s) => typeof s !== "string")) {
    return { refusal: "missing_input:f (a non-empty list of expressions for y')" };
  }
  if (!Array.isArray(g) || g.some((s) => typeof s !== "string")) {
    return { refusal: "invalid_input:g must be a list of expressions (possibly empty for a pure ODE)" };
  }
  let fAsts;
  let gAsts;
  try {
    fAsts = f.map((s) => parse(s));
    gAsts = g.map((s) => parse(s));
  } catch (err) {
    return { refusal: `invalid_input:expression ${err.message}` };
  }
  const ny = f.length;
  const nz = g.length;
  const env = (t, y, z) => {
    const e = { t };
    y.forEach((v, i) => { e[`y${i}`] = v; });
    (z || []).forEach((v, i) => { e[`z${i}`] = v; });
    return e;
  };
  const evalAll = (asts, t, y, z) => {
    const e = env(t, y, z);
    return asts.map((ast) => {
      const v = evaluateAst(ast, e);
      if (!Number.isFinite(v)) throw new Error("system evaluation is not finite");
      return v;
    });
  };
  return {
    ny,
    nz,
    F: (t, y, z) => evalAll(fAsts, t, y, z),
    G: (t, y, z) => evalAll(gAsts, t, y, z),
  };
}

function luSolve(fact, b) {
  const { lu, perm } = fact;
  const n = lu.length;
  const y = perm.map((p) => b[p]);
  for (let i = 1; i < n; i += 1) for (let j = 0; j < i; j += 1) y[i] -= lu[i][j] * y[j];
  const x = y.slice();
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < n; j += 1) x[i] -= lu[i][j] * x[j];
    x[i] /= lu[i][i];
  }
  return x;
}

/**
 * Modified Newton with a finite-difference Jacobian: the Jacobian
 * is built once and its LU factors reused across iterations (one
 * residual evaluation per iteration instead of n + 1), rebuilt
 * once if convergence stalls. Returns null on failure.
 */
function newtonFd(residual, w0, tol = 1e-11, maxIter = 12) {
  let w = w0.slice();
  let R = residual(w);
  let norm = Math.max(...R.map(Math.abs));
  let fact = null;
  let prevNorm = Infinity;
  let stalls = 0;
  for (let iter = 0; iter < maxIter; iter += 1) {
    if (norm <= tol) return { w, residual: norm, iterations: iter };
    if (norm > prevNorm * 0.9) stalls += 1; else stalls = 0;
    prevNorm = norm;
    if (fact === null || stalls >= 2) {
      const n = w.length;
      const J = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j += 1) {
        const step = Math.sqrt(Number.EPSILON) * Math.max(1, Math.abs(w[j]));
        const wp = w.slice();
        wp[j] += step;
        const Rp = residual(wp);
        for (let i = 0; i < n; i += 1) J[i][j] = (Rp[i] - R[i]) / step;
      }
      fact = luFactor(J);
      if (fact.singularAt !== undefined) return null;
      stalls = 0;
    }
    const dw = luSolve(fact, R);
    w = w.map((v, i) => v - dw[i]);
    if (w.some((v) => !Number.isFinite(v))) return null;
    R = residual(w);
    norm = Math.max(...R.map(Math.abs));
  }
  return norm <= tol * 100 ? { w, residual: norm, iterations: maxIter } : null;
}

/** Solve g(t, y, z) = 0 for z (the index-1 consistency condition). */
function solveAlgebraic(sys, t, y, zGuess) {
  if (sys.nz === 0) return { z: [] };
  const solved = newtonFd((z) => sys.G(t, y, z), zGuess || new Array(sys.nz).fill(0), 1e-12);
  if (!solved) {
    return { refusal: `not_index_1_or_inconsistent:g could not be solved for z at t = ${t} (singular d g/d z or no consistent algebraic state) — index reduction is the SUNDIALS tier` };
  }
  return { z: solved.w };
}

function integrateDae(sys, t0, t1, y0, z0, tol) {
  let t = t0;
  let y = y0.slice();
  let z = z0.slice();
  let h = Math.min(Math.abs(t1 - t0) / 10, 0.05) * Math.sign(t1 - t0);
  const samples = [{ t, y: y.slice(), z: z.slice() }];
  let accepted = 0;
  let guard = 0;
  while ((t1 - t) * Math.sign(t1 - t0) > 1e-13) {
    if ((guard += 1) > 100000) return { refusal: "step_failed:step budget exhausted before reaching t1 (the problem may be stiffer than this tier decides — IDA is the SUNDIALS tier)" };
    if (Math.abs(h) < 1e-12) return { refusal: "step_failed:step size underflow under repeated Newton failure (the problem may be stiffer than this tier decides — IDA is the SUNDIALS tier)" };
    if ((t + h - t1) * Math.sign(t1 - t0) > 0) h = t1 - t;
    // stage 1: unknowns w = [k1 (ny), z1 (nz)]; y_stage = y + h*GAMMA*k1
    const stageSolve = (coeffSelf, yBase, tStage, kGuess, zGuess) => {
      const residual = (w) => {
        const k = w.slice(0, sys.ny);
        const zs = w.slice(sys.ny);
        const yStage = yBase.map((v, i) => v + h * coeffSelf * k[i]);
        const fv = sys.F(tStage, yStage, zs);
        const gv = sys.nz ? sys.G(tStage, yStage, zs) : [];
        return [...k.map((v, i) => v - fv[i]), ...gv];
      };
      return newtonFd(residual, [...kGuess, ...zGuess], 1e-11);
    };
    let k1Guess = sys.F(t, y, z);
    const s1 = stageSolve(GAMMA, y, t + GAMMA * h, k1Guess, z);
    if (!s1) { h /= 2; continue; }
    const k1 = s1.w.slice(0, sys.ny);
    const z1 = s1.w.slice(sys.ny);
    // stage 2: y_stage = y + h*((1-GAMMA)*k1 + GAMMA*k2)
    const yBase2 = y.map((v, i) => v + h * (1 - GAMMA) * k1[i]);
    const s2 = stageSolve(GAMMA, yBase2, t + h, k1, z1);
    if (!s2) { h /= 2; continue; }
    const k2 = s2.w.slice(0, sys.ny);
    const z2 = s2.w.slice(sys.ny);
    const yNext = y.map((v, i) => v + h * ((1 - GAMMA) * k1[i] + GAMMA * k2[i]));
    // embedded estimate: y + h*k1 (the first stage alone)
    const yLow = y.map((v, i) => v + h * k1[i]);
    const err = Math.max(...yNext.map((v, i) => Math.abs(v - yLow[i]) / (tol + tol * Math.abs(v))));
    if (err <= 1 || Math.abs(h) <= 1e-13) {
      t += h;
      y = yNext;
      z = z2;
      accepted += 1;
      samples.push({ t, y: y.slice(), z: z.slice() });
    }
    const factor = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * err ** (-1 / 2)));
    h *= factor;
    if (Math.abs(h) < 1e-14) return { refusal: "step_failed:step size underflow (the problem may be stiffer than this tier decides — IDA is the SUNDIALS tier)" };
  }
  return { samples, steps: accepted };
}

function runDae(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "pendulum") return runPendulum(inputs);
  if (target !== "dae") {
    return { notComputed: `unknown_operation:${target} (general index reduction / IDA: requires_engine_tier:sundials)` };
  }
  const sys = compileSystem(inputs);
  if (sys.refusal) return { notComputed: sys.refusal };
  const { t0, t1 } = inputs;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 === t1) {
    return { notComputed: "missing_input:finite t0 and t1 with t0 != t1" };
  }
  const y0 = inputs.y0;
  if (!Array.isArray(y0) || y0.length !== sys.ny || y0.some((v) => !Number.isFinite(v))) {
    return { notComputed: `missing_input:y0 (${sys.ny} finite numbers; SC-03: no initial state is assumed)` };
  }
  const tol = inputs.tol === undefined ? 1e-9 : inputs.tol;
  if (!(tol > 0)) return { notComputed: "invalid_input:tol must be positive" };
  let zInit;
  try {
    zInit = solveAlgebraic(sys, t0, y0, inputs.z0);
  } catch (err) {
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  if (zInit.refusal) return { notComputed: zInit.refusal };
  const z0Solved = zInit.z;
  const callerZNote = Array.isArray(inputs.z0)
    ? (inputs.z0.some((v, i) => Math.abs(v - z0Solved[i]) > 1e-6)
      ? "caller-supplied z0 was inconsistent with g = 0 and was replaced by the solved consistent value"
      : "caller-supplied z0 agrees with the solved consistent value")
    : "z0 solved from g(t0, y0, z) = 0";
  let out;
  try {
    out = integrateDae(sys, t0, t1, y0, z0Solved, tol);
  } catch (err) {
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  if (out.refusal) return { notComputed: out.refusal };
  const last = out.samples[out.samples.length - 1];
  return {
    inputs: { t0, t1, y0, tol, z0: z0Solved, initialization: callerZNote },
    outputs: {
      y: last.y,
      z: last.z,
      t: last.t,
      steps: out.steps,
      samples: inputs.outputSamples ? out.samples : undefined,
    },
    margins: [],
    covers: [target],
  };
}

function runPendulum(inputs) {
  const L = inputs.length === undefined ? 1 : inputs.length;
  const grav = inputs.gravity === undefined ? 9.81 : inputs.gravity;
  const theta0 = inputs.theta0;
  const omega0 = inputs.omega0 === undefined ? 0 : inputs.omega0;
  const t1 = inputs.t1;
  if (!Number.isFinite(theta0) || !Number.isFinite(t1)) {
    return { notComputed: "missing_input:theta0 and t1 (the pendulum's initial angle and end time; defaults cover length, gravity, omega0 only)" };
  }
  if (!(L > 0) || !(grav > 0)) return { notComputed: "invalid_input:length and gravity must be positive" };
  const tol = inputs.tol === undefined ? 1e-9 : inputs.tol;
  // state y = [x, y, vx, vy], algebraic z = [lambda]; the
  // twice-differentiated constraint x*x'' + y*y'' + vx^2 + vy^2 = 0
  // with x'' = -lambda*x, y'' = -gravity - lambda*y. The declared
  // gravity is substituted into the expressions as data (the
  // grammar carries plain decimals; exponent-form values are
  // refused rather than mis-parsed).
  const gStr = String(-grav);
  if (/e/i.test(gStr)) return { notComputed: "invalid_input:gravity is outside the expression grammar's plain-decimal range" };
  const sysG = compileSystem({
    f: ["y2", "y3", "-z0*y0", `${gStr} - z0*y1`],
    g: [`y0*(-z0*y0) + y1*(${gStr} - z0*y1) + y2^2 + y3^2`],
  });
  const y0 = [
    L * Math.sin(theta0),
    -L * Math.cos(theta0),
    L * omega0 * Math.cos(theta0),
    L * omega0 * Math.sin(theta0),
  ];
  const zInit = solveAlgebraic(sysG, 0, y0, [0]);
  if (zInit.refusal) return { notComputed: zInit.refusal };
  let out;
  try {
    out = integrateDae(sysG, 0, t1, y0, zInit.z, tol);
  } catch (err) {
    return { notComputed: `evaluation_failed:${err.message}` };
  }
  if (out.refusal) return { notComputed: out.refusal };
  const energy = (s) => 0.5 * (s.y[2] ** 2 + s.y[3] ** 2) + grav * s.y[1];
  const E0 = energy(out.samples[0]);
  let maxEnergyDrift = 0;
  let maxConstraintDrift = 0;
  for (const s of out.samples) {
    maxEnergyDrift = Math.max(maxEnergyDrift, Math.abs(energy(s) - E0));
    maxConstraintDrift = Math.max(maxConstraintDrift, Math.abs(s.y[0] ** 2 + s.y[1] ** 2 - L * L));
  }
  const last = out.samples[out.samples.length - 1];
  return {
    inputs: { length: L, gravity: grav, theta0, omega0, t1, tol },
    outputs: {
      state: { x: last.y[0], y: last.y[1], vx: last.y[2], vy: last.y[3], lambda: last.z[0] },
      energyDrift: maxEnergyDrift,
      energyRelativeDrift: maxEnergyDrift / Math.max(1, Math.abs(E0)),
      constraintDrift: maxConstraintDrift,
      steps: out.steps,
    },
    margins: [],
    covers: ["pendulum"],
  };
}

export const dae = registerSolver({
  id: "math.dae",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "SDIRK2 (Alexander) implicit integration of semi-explicit index-1 DAEs with Newton stage solves (finite-difference Jacobian) and solved consistent initialization; the Cartesian pendulum via its twice-differentiated constraint; IDA / Pantelides index reduction is the SUNDIALS engine tier",
  reference: "Hairer & Wanner, Solving Ordinary Differential Equations II — the Cartesian pendulum test problem; Alexander 1977 (SDIRK2)",
  regime: "semi-explicit index-1 systems (d g/d z nonsingular); validity envelope: index <= 3 as posed only via an analytic reduction the caller supplies (as the pendulum target does)",
  units: { inputs: "f/g expression lists over t, y*, z*; initial state; tolerances", outputs: "final state, solved algebraic state, step count; pendulum: energy and constraint drift" },
  tolerance: "declared per call (default 1e-9), applied as a mixed absolute/relative scale in the step controller",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runDae,
});
