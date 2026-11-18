// server/lib/conkay/physics/solvers/dde.js
//
// math.dde — SX-NUM-18 (ConKay solver catalogue, Wave 0).
//
// Delay differential equations y'(t) = f(t, y(t), y(t - tau))
// by the method of steps (Bellen & Zennaro): RK4 on a uniform
// grid, delayed values from the cubic Hermite dense output
// over the stored grid (values + slopes), the history
// function supplying everything before t0. Every answer is
// gated by a step-doubling estimate: the problem is solved
// at m and 2m steps per delay and the two solutions must
// agree at the output points within the declared tolerance,
// or the call refuses with the estimate named.
//
// The catalogue reference case is the textbook problem
// y' = -y(t - 1), y = 1 on [-1, 0], whose solution is known
// in closed form on [0, 2]: 1 - t on [0, 1] and
// t^2/2 - 2t + 3/2 on [1, 2].
//
// Envelope: constant delays. State-dependent delays are
// named follow-on scope, never silently treated as constant.

import { registerSolver } from "../registry.js";
import { parse, evaluateAst } from "./math-symbolic.js";

function solveDde({ fAsts, histAsts, tau, t0, t1, stepsPerDelay }) {
  const n = fAsts.length;
  const m = stepsPerDelay;
  const h = tau / m;
  const nSteps = Math.max(1, Math.round((t1 - t0) / h));
  const hh = (t1 - t0) / nSteps;
  const ts = [t0];
  const Y = [histAsts.map((ast) => evaluateAst(ast, { t: t0 }))];
  const F = [null]; // slopes per grid point, filled as we go

  const histAt = (t) => histAsts.map((ast) => evaluateAst(ast, { t }));
  // Hermite interpolation over stored grid + history region
  const valueAt = (t) => {
    if (t <= t0) return histAt(t);
    const idx = Math.min(nSteps - 1, Math.max(0, Math.floor((t - t0) / hh)));
    const ta = ts[idx];
    const tb = ts[idx + 1];
    if (tb === undefined) return Y[Y.length - 1].slice();
    const s = (t - ta) / (tb - ta);
    const out = new Array(n);
    for (let c = 0; c < n; c += 1) {
      const yA = Y[idx][c];
      const yB = Y[idx + 1][c];
      const fA = F[idx][c] * (tb - ta);
      const fB = F[idx + 1][c] * (tb - ta);
      const s2 = s * s;
      const s3 = s2 * s;
      out[c] = (2 * s3 - 3 * s2 + 1) * yA + (s3 - 2 * s2 + s) * fA + (-2 * s3 + 3 * s2) * yB + (s3 - s2) * fB;
    }
    return out;
  };
  const evalF = (t, y, yd) => {
    const env = { t };
    y.forEach((v, i) => { env[`x${i}`] = v; });
    yd.forEach((v, i) => { env[`d${i}`] = v; });
    return fAsts.map((ast) => evaluateAst(ast, env));
  };

  F[0] = evalF(t0, Y[0], valueAt(t0 - tau));
  for (let step = 0; step < nSteps; step += 1) {
    const t = ts[step];
    const y = Y[step];
    const k1 = F[step];
    const y2 = y.map((v, i) => v + (hh / 2) * k1[i]);
    const k2 = evalF(t + hh / 2, y2, valueAt(t + hh / 2 - tau));
    const y3 = y.map((v, i) => v + (hh / 2) * k2[i]);
    const k3 = evalF(t + hh / 2, y3, valueAt(t + hh / 2 - tau));
    const y4 = y.map((v, i) => v + hh * k3[i]);
    const k4 = evalF(t + hh, y4, valueAt(t + hh - tau));
    const yNext = y.map((v, i) => v + (hh / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    ts.push(t + hh);
    Y.push(yNext);
    F.push(evalF(t + hh, yNext, valueAt(t + hh - tau)));
  }
  return { valueAt, steps: nSteps, h: hh };
}

function runDde(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target !== "solve") {
    return { notComputed: `unknown_operation:${target} (state-dependent delays: follow-on scope — the served envelope is constant delays)` };
  }
  const fList = Array.isArray(inputs.f) ? inputs.f : [inputs.f];
  if (fList.some((f) => typeof f !== "string" || !f.trim())) {
    return { notComputed: "missing_input:f (an expression, or array of expressions, over t, x0.., d0.. where d_i = x_i(t - tau))" };
  }
  const tau = inputs.tau;
  if (!(tau > 0)) return { notComputed: "missing_input:tau (a positive constant delay)" };
  const t0 = inputs.t0 === undefined ? 0 : inputs.t0;
  const t1 = inputs.t1;
  if (!Number.isFinite(t0) || !(t1 > t0)) return { notComputed: "missing_input:t1 after t0" };
  let histAsts;
  try {
    if (typeof inputs.history === "string" || Array.isArray(inputs.history)) {
      const hList = Array.isArray(inputs.history) ? inputs.history : fList.map(() => inputs.history);
      if (hList.length !== fList.length) return { notComputed: "invalid_input:history must give one expression per component" };
      histAsts = hList.map((h) => parse(h));
    } else if (Number.isFinite(inputs.historyValue) || Array.isArray(inputs.historyValue)) {
      const vals = Array.isArray(inputs.historyValue) ? inputs.historyValue : fList.map(() => inputs.historyValue);
      if (vals.length !== fList.length || !vals.every(Number.isFinite)) return { notComputed: "invalid_input:historyValue must give one finite value per component" };
      histAsts = vals.map((v) => parse(String(v)));
    } else {
      return { notComputed: "missing_input:history (an expression over t, or historyValue) — a DDE without its history is a different problem for every reader (SC-03)" };
    }
  } catch (err) {
    return { notComputed: `invalid_input:history ${err.message}` };
  }
  let fAsts;
  try {
    fAsts = fList.map((f) => parse(f));
  } catch (err) {
    return { notComputed: `invalid_input:f ${err.message}` };
  }
  const outTimes = inputs.points;
  if (!Array.isArray(outTimes) || outTimes.length === 0 || !outTimes.every((t) => Number.isFinite(t) && t >= t0 && t <= t1)) {
    return { notComputed: "missing_input:points (output times inside [t0, t1])" };
  }
  const m = inputs.stepsPerDelay === undefined ? 100 : inputs.stepsPerDelay;
  if (!Number.isInteger(m) || m < 4 || m > 2000) return { notComputed: "invalid_input:stepsPerDelay must be an integer 4..2000" };
  const tol = inputs.tol === undefined ? 1e-5 : inputs.tol;
  const coarse = solveDde({ fAsts, histAsts, tau, t0, t1, stepsPerDelay: m });
  const fine = solveDde({ fAsts, histAsts, tau, t0, t1, stepsPerDelay: 2 * m });
  let estimate = 0;
  const values = outTimes.map((t) => {
    const a = coarse.valueAt(t);
    const b = fine.valueAt(t);
    for (let c = 0; c < a.length; c += 1) estimate = Math.max(estimate, Math.abs(a[c] - b[c]));
    return { t, y: b };
  });
  if (estimate > tol) {
    return { notComputed: `step_doubling_estimate:${estimate} exceeds the declared tolerance ${tol} at ${2 * m} steps per delay — raise stepsPerDelay or loosen tol; the solver does not serve an estimate it cannot stand behind` };
  }
  return {
    inputs: { tau, stepsPerDelay: 2 * m, components: fList.length },
    outputs: { values, stepDoublingEstimate: estimate },
    margins: [],
    covers: [target],
  };
}

export const dde = registerSolver({
  id: "math.dde",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "method of steps with RK4 and cubic Hermite dense output for delayed values; step-doubling estimate gates every answer",
  reference: "Bellen & Zennaro, Numerical Methods for Delay Differential Equations — reference case: y' = -y(t-1) with its known piecewise solution on [0, 2]",
  regime: "constant delays; the history function is a required declared input; state-dependent delays are named follow-on scope",
  units: { inputs: "f expressions over (t, x*, d*), tau, history expression or value, output points", outputs: "solution values at the output points with the step-doubling estimate" },
  tolerance: "declared per call (default 1e-5); the step-doubling estimate must fit inside it or the call refuses",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runDde,
});
