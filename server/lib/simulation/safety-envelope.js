// server/lib/simulation/safety-envelope.js
//
// W1-C — Deterministic safety-envelope compiler.
//
// ---------------------------------------------------------------------------
// Concord does not and cannot execute real-time control. This engine performs
// OFFLINE design and verification only. Node.js has no real-time guarantees —
// garbage-collection pauses alone are milliseconds, orders of magnitude above
// a sub-millisecond actuator deadline — so nothing here is a controller and
// nothing here should be placed in a control loop. The output is a static
// data artifact: a lookup table plus its bounds and provenance, intended to
// be compiled into, and executed by, real RT hardware (PLC / FPGA /
// microcontroller) whose timing guarantees are established by that platform
// and its own certification process, not by this engine.
//
// The envelope is computed by gridded forward reachability with a Grönwall
// growth-bound inflation. It is conservative if and only if the supplied
// Lipschitz constant is a true upper bound over the state box. When the
// bound is declared by the caller or exact for a linear plant, the artifact
// is tagged certified_modulo_declared_bound. When it is estimated by
// sampling the Jacobian, it is tagged empirical_sampled and only empirical
// evidence language is used, never certification wording — a sup over
// samples is not a bound over a continuum. Fixed-step RK4 truncation error
// is reported, not eliminated.
// ---------------------------------------------------------------------------
//
// Method: gridded forward reachability (SCOTS-style abstraction). For every
// grid cell centre we forward-integrate (rk4ODE) under every candidate
// constant input in a gridded admissible-input box. A cell is labeled SAFE
// only if the *inflated tube* around the trajectory — radius
// r(t) = r0 * e^(L*t), r0 = half the cell's diagonal, L = a Lipschitz bound
// on the vector field's state-Jacobian — stays inside every declared
// constraint for the whole horizon. That inflation is what makes the label
// mean something about the CONTINUUM between grid points, not just about
// the sampled centre.
//
// `adversarialInput` selects which quantifier is used over the gridded
// input candidates:
//   - false (default): SAFE iff there EXISTS an admissible constant input
//     whose inflated trajectory stays inside the constraints for the whole
//     horizon. This is "is there a way to stay safe within the actuator's
//     authority" — for affine-in-u dynamics the extreme points of the input
//     box dominate (the reachable trajectory is affine in a constant u), so
//     a coarse two-point input grid ({min,max}) is already exact for linear
//     plants.
//   - true: SAFE iff EVERY admissible constant input's inflated trajectory
//     stays inside the constraints — i.e. safe no matter what the
//     downstream (unverified, possibly worst-case) real-time controller
//     actually commands within its admissible range. Strictly more
//     conservative: SAFE(adversarial=true) is always a subset of
//     SAFE(adversarial=false).
//
// Plant model is DATA, never code — two shapes only:
//   { kind: 'linear', A, B, c }
//   { kind: 'symbolic', vars, input, dynamics, params }
// Symbolic dynamics parse via server/lib/compute/symbolic-math.js#parse,
// which we verified contains no eval/new Function; `evaluate` accepts a
// pre-parsed AST so we parse once and evaluate the AST per RK4 stage.

import { rk4ODE, solveLinearSystem } from '../compute/numerical.js';
import { parse, evaluate, differentiate, getVariables } from '../compute/symbolic-math.js';

// A measured 100x100 grid x 200 RK4 steps x 2 states runs in ~600ms (see
// server/tests/safety-envelope.test.js for the measured number on this box).
// Refuse rather than hang a request beyond this many cells.
export const MAX_GRID_CELLS = 250000;

function mkErr(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// ---------------------------------------------------------------------------
// Vector-field construction — plant model (data) -> f(t, x, u) -> dx/dt
// ---------------------------------------------------------------------------

function buildLinearField(plant) {
  const { A, B, c } = plant;
  const n = A.length;
  return function f(_t, x, u) {
    const dx = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = c ? Number(c[i] || 0) : 0;
      for (let j = 0; j < n; j++) s += A[i][j] * x[j];
      const bi = Array.isArray(B[i]) ? Number(B[i][0] || 0) : Number(B[i] || 0);
      s += bi * u;
      dx[i] = s;
    }
    return dx;
  };
}

function validateSymbolicVars(asts, known) {
  for (const ast of asts) {
    const used = getVariables(ast);
    const bad = used.filter((v) => !known.has(v));
    if (bad.length) {
      throw mkErr('unbound_variable', `symbolic dynamics reference undeclared symbol(s): ${bad.join(', ')}`, { variables: bad });
    }
  }
}

function buildSymbolicField(plant) {
  const { vars, input, dynamics, params = {} } = plant;
  if (!Array.isArray(vars) || vars.length === 0) throw mkErr('unsupported_plant_kind', 'symbolic plant requires a non-empty vars[]');
  if (typeof input !== 'string' || !input) throw mkErr('unsupported_plant_kind', 'symbolic plant requires an input variable name');
  if (!Array.isArray(dynamics) || dynamics.length !== vars.length) {
    throw mkErr('unsupported_plant_kind', 'symbolic plant requires one dynamics expression per state var');
  }
  const asts = dynamics.map((expr) => parse(expr));
  const known = new Set([...vars, input, ...Object.keys(params)]);
  validateSymbolicVars(asts, known);
  const f = function (_t, x, u) {
    const env = { ...params };
    for (let i = 0; i < vars.length; i++) env[vars[i]] = x[i];
    env[input] = u;
    return asts.map((ast) => evaluate(ast, env));
  };
  return { f, asts, known };
}

/** Build the { f, dim } vector field from a plant data spec. Never eval()s. */
export function buildVectorField(plant) {
  if (!plant || typeof plant !== 'object' || !plant.kind) {
    throw mkErr('unsupported_plant_kind', 'plant.kind is required ("linear" | "symbolic")');
  }
  if (plant.kind === 'linear') {
    if (!Array.isArray(plant.A) || !Array.isArray(plant.B) || plant.A.length !== plant.B.length) {
      throw mkErr('unsupported_plant_kind', 'linear plant requires A (n x n) and B (n x 1) of matching dimension');
    }
    return { f: buildLinearField(plant), dim: plant.A.length };
  }
  if (plant.kind === 'symbolic') {
    const { f } = buildSymbolicField(plant);
    return { f, dim: plant.vars.length };
  }
  throw mkErr('unsupported_plant_kind', `unsupported plant kind: "${plant.kind}"`);
}

// ---------------------------------------------------------------------------
// Spectral norm via power iteration on M^T M (no reimplementation of
// solveLinearSystem — a different algorithm, dominant-eigenvalue power
// iteration, used only to bound the Jacobian's operator norm).
// ---------------------------------------------------------------------------

function spectralNormPowerIteration(M, iters = 60) {
  const n = M.length;
  const m = n > 0 ? M[0].length : 0;
  if (n === 0 || m === 0) return 0;
  const matVec = (vec) => {
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += M[i][j] * vec[j];
      out[i] = s;
    }
    return out;
  };
  const matTVec = (vec) => {
    const out = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += M[i][j] * vec[i];
      out[j] = s;
    }
    return out;
  };
  let v = new Array(m).fill(1 / Math.sqrt(m));
  let lambda = 0;
  for (let k = 0; k < iters; k++) {
    const w = matTVec(matVec(v));
    const norm = Math.sqrt(w.reduce((a, b) => a + b * b, 0));
    if (norm < 1e-300) return 0;
    v = w.map((x) => x / norm);
    lambda = norm;
  }
  return Math.sqrt(Math.max(0, lambda));
}

// ---------------------------------------------------------------------------
// Jacobian / Lipschitz bound — the two-tier claim.
// ---------------------------------------------------------------------------

function cartesianSample(stateBox, inputBox, cap = 500) {
  const perAxisVals = stateBox.map((ax) => [ax.min, (ax.min + ax.max) / 2, ax.max]);
  let combos = [[]];
  for (const vals of perAxisVals) {
    const next = [];
    for (const combo of combos) {
      for (const v of vals) {
        next.push([...combo, v]);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    combos = next;
    if (combos.length >= cap) break;
  }
  const uVals = inputBox ? [inputBox.min, (inputBox.min + inputBox.max) / 2, inputBox.max] : [0];
  const samples = [];
  for (const x of combos) for (const u of uVals) samples.push({ x, u });
  return samples;
}

/**
 * Compute (or accept a declared) Lipschitz bound on the plant's state
 * Jacobian. Returns { value, basis } where basis is:
 *   'declared'                 — caller-supplied numeric bound.
 *   'exact_linear'              — the plant is linear; the Jacobian equals
 *                                  A everywhere, so its spectral norm IS the
 *                                  exact Lipschitz constant, not an estimate.
 *   'sampled_jacobian_estimate' — nonlinear (symbolic) plant with no
 *                                  declared bound; the value is a sup over
 *                                  sampled points, not a bound over the
 *                                  continuum. Callers MUST treat this as
 *                                  empirical (see buildArtifact).
 */
export function jacobianBound(plant, opts = {}) {
  const { stateBox = null, inputBox = null, declaredLipschitz = null } = opts;

  if (declaredLipschitz != null) {
    const L = Number(declaredLipschitz);
    if (!Number.isFinite(L) || L <= 0) {
      throw mkErr('lipschitz_bound_unavailable', 'declaredLipschitz must be a finite positive number');
    }
    return { value: L, basis: 'declared' };
  }

  if (!plant || typeof plant !== 'object' || !plant.kind) {
    throw mkErr('unsupported_plant_kind', 'plant.kind is required');
  }

  if (plant.kind === 'linear') {
    if (!Array.isArray(plant.A)) throw mkErr('unsupported_plant_kind', 'linear plant requires A');
    const L = spectralNormPowerIteration(plant.A);
    if (!Number.isFinite(L)) throw mkErr('lipschitz_bound_unavailable', 'spectral norm of A did not converge to a finite value');
    return { value: L, basis: 'exact_linear' };
  }

  if (plant.kind === 'symbolic') {
    const { vars, input, dynamics, params = {} } = plant;
    if (!Array.isArray(stateBox) || stateBox.length !== vars.length) {
      throw mkErr('invalid_spec', 'stateBox (matching plant.vars) is required to sample a symbolic Jacobian');
    }
    const asts = dynamics.map((expr) => parse(expr));
    const known = new Set([...vars, input, ...Object.keys(params)]);
    validateSymbolicVars(asts, known);
    const jac = asts.map((ast) => vars.map((v) => differentiate(ast, v)));
    const samples = cartesianSample(stateBox, inputBox);
    let maxNorm = 0;
    let any = false;
    for (const { x, u } of samples) {
      const env = { ...params };
      vars.forEach((v, i) => { env[v] = x[i]; });
      env[input] = u;
      let ok = true;
      const M = jac.map((row) => row.map((cellAst) => {
        let val;
        try { val = evaluate(cellAst, env); } catch (_e) { ok = false; return 0; }
        if (!Number.isFinite(val)) ok = false;
        return val;
      }));
      if (!ok) continue;
      const n = spectralNormPowerIteration(M);
      if (Number.isFinite(n)) { maxNorm = Math.max(maxNorm, n); any = true; }
    }
    if (!any) {
      throw mkErr('lipschitz_bound_unavailable', 'no finite Jacobian sample could be evaluated over the declared domain');
    }
    return { value: maxNorm, basis: 'sampled_jacobian_estimate', sampleCount: samples.length };
  }

  throw mkErr('unsupported_plant_kind', `unsupported plant kind: "${plant.kind}"`);
}

// ---------------------------------------------------------------------------
// Linear equilibrium — the ONLY linear solve in this unit, and it must be
// the existing solveLinearSystem (never a 5th independent Gaussian
// elimination). Purely descriptive metadata: the fixed point Ax+Bu0+c=0
// under the input box's midpoint, when A is invertible.
// ---------------------------------------------------------------------------

function computeLinearEquilibrium(plant, inputBox) {
  try {
    const { A, B, c } = plant;
    const u0 = inputBox ? (inputBox.min + inputBox.max) / 2 : 0;
    const rhs = A.map((_row, i) => {
      const bi = Array.isArray(B[i]) ? Number(B[i][0] || 0) : Number(B[i] || 0);
      const ci = c ? Number(c[i] || 0) : 0;
      return -(bi * u0 + ci);
    });
    const x = solveLinearSystem(A, rhs);
    return x || null;
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Input grid — constant candidate inputs over the admissible box.
// ---------------------------------------------------------------------------

function buildInputGrid(inputBox) {
  if (!inputBox) return [0];
  const n = Math.max(2, Math.floor(inputBox.n || 2));
  if (inputBox.max === inputBox.min) return [inputBox.min];
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(inputBox.min + (inputBox.max - inputBox.min) * i / (n - 1));
  return pts;
}

// ---------------------------------------------------------------------------
// Constraint checking under Grönwall inflation.
// coeffs · x <= rhs   (op '<=')   or   coeffs · x >= rhs   (op '>=')
// Worst point in the L2 ball of radius r around y maximizes/minimizes
// coeffs·x by +/- ||coeffs||_2 * r.
// ---------------------------------------------------------------------------

function trajectoryStaysSafe(traj, constraints, r0, L) {
  for (const { t, y } of traj) {
    const r = r0 * Math.exp(L * t);
    for (const c of constraints) {
      let dot = 0;
      let normSq = 0;
      for (let i = 0; i < c.coeffs.length; i++) {
        dot += c.coeffs[i] * y[i];
        normSq += c.coeffs[i] * c.coeffs[i];
      }
      const norm = Math.sqrt(normSq);
      if (c.op === '<=') {
        if (dot + norm * r > c.rhs + 1e-9) return false;
      } else {
        if (dot - norm * r < c.rhs - 1e-9) return false;
      }
    }
  }
  return true;
}

function isCellSafe(x0, uGrid, fieldFn, constraints, r0, L, tHorizon, dt, adversarialInput) {
  let anySafe = false;
  let allSafe = true;
  for (const u of uGrid) {
    const traj = rk4ODE((t, y) => fieldFn(t, y, u), x0, 0, tHorizon, dt);
    const safe = trajectoryStaysSafe(traj, constraints, r0, L);
    if (safe) anySafe = true; else allSafe = false;
    if (adversarialInput && !allSafe) return false; // short-circuit: forall failed
    if (!adversarialInput && anySafe) return true; // short-circuit: exists satisfied
  }
  return adversarialInput ? allSafe : anySafe;
}

// ---------------------------------------------------------------------------
// Integrator truncation-error estimate — Richardson step-doubling on a
// representative (domain-centre) trajectory. A real computed number, not a
// fabricated constant; reported, never used to "eliminate" the error.
// ---------------------------------------------------------------------------

function estimateIntegratorStepError(fieldFn, x0, uNominal, tHorizon, dt) {
  const f = (t, y) => fieldFn(t, y, uNominal);
  const trajFull = rk4ODE(f, x0, 0, tHorizon, dt);
  const trajHalf = rk4ODE(f, x0, 0, tHorizon, dt / 2);
  const yFull = trajFull[trajFull.length - 1].y;
  const yHalf = trajHalf[trajHalf.length - 1].y;
  const diff = Array.isArray(yFull)
    ? Math.sqrt(yFull.reduce((s, v, i) => s + (v - yHalf[i]) * (v - yHalf[i]), 0))
    : Math.abs(yFull - yHalf);
  // Classical Richardson estimate for a 4th-order method: the true error of
  // the coarser (dt) solution is approximately diff / (2^order - 1).
  const richardsonEstimate = diff / (Math.pow(2, 4) - 1);
  return { method: 'rk4', order: 4, dt, richardsonEstimate };
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

/**
 * @param {object} spec
 * @param {object} spec.plant - { kind:'linear', A,B,c } | { kind:'symbolic', vars, input, dynamics, params }
 * @param {Array<{name?:string,min:number,max:number,n:number}>} spec.stateBox
 * @param {{min:number,max:number,n?:number}|null} spec.inputBox
 * @param {Array<{coeffs:number[],op:'<='|'>=',rhs:number}>} spec.constraints
 * @param {{tHorizon:number, dt:number}} spec.horizon
 * @param {boolean} [spec.adversarialInput=false]
 * @param {number} [spec.declaredLipschitz]
 */
export function computeEnvelope(spec = {}) {
  const {
    plant,
    stateBox,
    inputBox = null,
    constraints = [],
    horizon = {},
    adversarialInput = false,
    declaredLipschitz = null,
  } = spec;

  const { tHorizon, dt } = horizon;
  if (!Number.isFinite(tHorizon) || tHorizon <= 0) throw mkErr('invalid_spec', 'horizon.tHorizon must be a positive finite number');
  if (!Number.isFinite(dt) || dt <= 0) throw mkErr('invalid_spec', 'horizon.dt must be a positive finite number');

  if (!Array.isArray(stateBox) || stateBox.length === 0) {
    throw mkErr('invalid_spec', 'stateBox (array of {min,max,n}) is required');
  }
  for (const ax of stateBox) {
    if (!Number.isFinite(ax.min) || !Number.isFinite(ax.max) || ax.max <= ax.min) {
      throw mkErr('invalid_spec', 'every stateBox axis needs finite min < max');
    }
  }

  const cellCounts = stateBox.map((ax) => Math.max(1, Math.floor(ax.n || 1)));
  const totalCells = cellCounts.reduce((a, b) => a * b, 1);
  if (totalCells > MAX_GRID_CELLS) {
    throw mkErr('state_space_too_large', `grid has ${totalCells} cells, exceeds MAX_GRID_CELLS=${MAX_GRID_CELLS}`, { cellCount: totalCells });
  }

  const { f: fieldFn, dim } = buildVectorField(plant);
  if (dim !== stateBox.length) {
    throw mkErr('invalid_spec', `plant state dimension ${dim} does not match stateBox length ${stateBox.length}`);
  }

  for (const c of constraints) {
    if (!Array.isArray(c.coeffs) || c.coeffs.length !== dim) throw mkErr('invalid_spec', 'constraint coeffs length must match state dimension');
    if (c.op !== '<=' && c.op !== '>=') throw mkErr('invalid_spec', 'constraint op must be "<=" or ">="');
    if (!Number.isFinite(c.rhs)) throw mkErr('invalid_spec', 'constraint rhs must be finite');
  }

  const lipschitz = jacobianBound(plant, { stateBox, inputBox, declaredLipschitz });
  if (!Number.isFinite(lipschitz.value) || lipschitz.value < 0) {
    throw mkErr('lipschitz_bound_unavailable', 'computed Lipschitz bound is not a finite non-negative number');
  }

  const equilibrium = plant.kind === 'linear' ? computeLinearEquilibrium(plant, inputBox) : null;

  const axes = stateBox.map((ax, i) => {
    const n = cellCounts[i];
    const step = (ax.max - ax.min) / n;
    return { name: ax.name || `x${i}`, min: ax.min, max: ax.max, n, step };
  });

  const r0 = 0.5 * Math.sqrt(axes.reduce((s, a) => s + a.step * a.step, 0));
  const uGrid = buildInputGrid(inputBox);

  const dims = axes.map((a) => a.n);
  const total = dims.reduce((a, b) => a * b, 1);
  const labels = new Int8Array(total);
  const idx = new Array(axes.length).fill(0);
  for (let flat = 0; flat < total; flat++) {
    let rem = flat;
    for (let d = axes.length - 1; d >= 0; d--) {
      idx[d] = rem % dims[d];
      rem = Math.floor(rem / dims[d]);
    }
    const x0 = axes.map((a, d) => a.min + (idx[d] + 0.5) * a.step);
    labels[flat] = isCellSafe(x0, uGrid, fieldFn, constraints, r0, lipschitz.value, tHorizon, dt, adversarialInput) ? 1 : 0;
  }

  let safeCount = 0;
  for (let i = 0; i < labels.length; i++) safeCount += labels[i];

  const domainCenter = axes.map((a) => (a.min + a.max) / 2);
  const uNominal = uGrid[Math.floor(uGrid.length / 2)];
  const integratorStepError = estimateIntegratorStepError(fieldFn, domainCenter, uNominal, tHorizon, dt);

  return {
    plant,
    constraints,
    adversarialInput,
    horizon: { tHorizon, dt },
    grid: { axes },
    labels,
    dims,
    safeCount,
    totalCells: total,
    coverageFraction: total > 0 ? safeCount / total : 0,
    lipschitz,
    growthInflation: { r0, formula: 'radius(t) = r0 * exp(L * t)' },
    integratorStepError,
    equilibrium,
  };
}
