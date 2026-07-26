// server/tests/safety-envelope.test.js
//
// Validation for the deterministic safety-envelope compiler
// (server/lib/simulation/safety-envelope.js) against REAL oracles:
//  1. Soundness/conservatism vs. a closed-form maximal safe set
//     (the double-integrator "braking barrier").
//  2. Non-vacuity — the engine must not simply label nothing safe.
//  3. Monotone refinement — coverage should not decrease as the grid
//     refines, and should converge toward the analytic fraction.
//  4. Integrator oracle — rk4ODE reproduces a closed-form exponential,
//     independent of the reachability logic.
//  5. Adversarial-input necessity — the worst-case branch is actually
//     exercised, not silently skipped.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rk4ODE } from '../lib/compute/numerical.js';
import { computeEnvelope, jacobianBound, MAX_GRID_CELLS } from '../lib/simulation/safety-envelope.js';

// ---------------------------------------------------------------------------
// Shared double-integrator scenario.
//
//   xdot = [v, u],  |u| <= uMax,  constraint: p <= pMax
//
// The exact maximal safe set (viability kernel under the existence of SOME
// admissible constant policy — full braking, u = -uMax, is the classical
// bang-bang optimum) is the textbook braking barrier:
//
//   v <= sqrt(2 * uMax * (pMax - p))     for v > 0
//   always safe                          for v <= 0 (moving away from pMax)
//   always unsafe                        for p > pMax
//
// Its Jacobian is exactly A = [[0,1],[0,0]] (independent of u, since the
// plant is linear/affine), whose spectral norm is exactly 1 — a genuinely
// true Lipschitz bound, not an estimate, so conservatism is provable here.
// ---------------------------------------------------------------------------

const U_MAX = 2;
const P_MAX = 10;
const V_MAX = 5; // domain upper bound for v
const PLANT = { kind: 'linear', A: [[0, 1], [0, 0]], B: [[0], [1]], c: [0, 0] };
const INPUT_BOX = { min: -U_MAX, max: U_MAX, n: 2 }; // extreme points suffice: affine-in-u dynamics + linear constraint => the reachable value at any t is affine in constant u, so the worst/best case is always at a box corner.
const CONSTRAINTS = [{ coeffs: [1, 0], op: '<=', rhs: P_MAX }];
// Horizon covers the worst-case time-to-peak under full braking (v/uMax),
// with a small buffer — long enough to observe every true kernel violation,
// short enough that the Grönwall inflation (which grows as e^{L t}) doesn't
// swamp the domain.
const T_HORIZON = (V_MAX / U_MAX) * 1.08;
const DT_200 = T_HORIZON / 200;

function analyticSafe(p, v) {
  if (p > P_MAX) return false;
  if (v <= 0) return true;
  return v <= Math.sqrt(2 * U_MAX * (P_MAX - p));
}

function analyticFraction(samplesPerAxis = 500) {
  let count = 0;
  const N = samplesPerAxis;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = ((i + 0.5) / N) * P_MAX;
      const v = ((j + 0.5) / N) * V_MAX;
      if (analyticSafe(p, v)) count++;
    }
  }
  return count / (N * N);
}

function cellCenters(envelopeResult) {
  const { axes } = envelopeResult.grid;
  const dims = envelopeResult.dims;
  const idx = new Array(dims.length).fill(0);
  const centers = [];
  for (let flat = 0; flat < envelopeResult.labels.length; flat++) {
    let rem = flat;
    for (let d = dims.length - 1; d >= 0; d--) {
      idx[d] = rem % dims[d];
      rem = Math.floor(rem / dims[d]);
    }
    const p = axes[0].min + (idx[0] + 0.5) * axes[0].step;
    const v = axes[1].min + (idx[1] + 0.5) * axes[1].step;
    centers.push({ p, v, safe: envelopeResult.labels[flat] === 1 });
  }
  return centers;
}

function runScenario(n, opts = {}) {
  const stateBox = [
    { name: 'p', min: 0, max: P_MAX, n },
    { name: 'v', min: 0, max: V_MAX, n },
  ];
  return computeEnvelope({
    plant: PLANT,
    stateBox,
    inputBox: INPUT_BOX,
    constraints: CONSTRAINTS,
    horizon: { tHorizon: T_HORIZON, dt: DT_200 },
    adversarialInput: false,
    ...opts,
  });
}

describe('safety-envelope — soundness vs. the double-integrator braking barrier', () => {
  it('exact_linear basis reports the true Lipschitz bound (spectral norm of A = 1)', () => {
    const jb = jacobianBound(PLANT, {});
    assert.equal(jb.basis, 'exact_linear');
    assert.ok(Math.abs(jb.value - 1) < 1e-9, `expected ||A||=1, got ${jb.value}`);
  });

  it('1. every cell labeled SAFE satisfies the analytic braking-barrier inequality (zero false-safe)', () => {
    const env = runScenario(100);
    assert.equal(env.lipschitz.basis, 'exact_linear');
    assert.equal(env.lipschitz.value, 1);
    const centers = cellCenters(env);
    let falseSafe = 0;
    let safeCount = 0;
    for (const { p, v, safe } of centers) {
      if (safe) {
        safeCount++;
        if (!analyticSafe(p, v)) falseSafe++;
      }
    }
    console.log(`[safety-envelope] n=100 measured coverageFraction=${env.coverageFraction} safeCount=${safeCount} falseSafe=${falseSafe}`);
    assert.equal(falseSafe, 0, 'engine labeled a cell SAFE that violates the analytic maximal safe set');
    assert.equal(safeCount, env.safeCount);
  });

  it('2. non-vacuity — at n=200 per axis, coverageFraction >= 0.8 x analytic fraction', () => {
    const t0 = Date.now();
    const env = runScenario(200);
    const elapsed = Date.now() - t0;
    const analytic = analyticFraction(500);
    const ratio = env.coverageFraction / analytic;
    console.log(`[safety-envelope] n=200 measured coverageFraction=${env.coverageFraction} analyticFraction=${analytic} ratio=${ratio} elapsedMs=${elapsed} totalCells=${env.totalCells}`);
    assert.ok(env.safeCount > 0, 'engine labeled ZERO cells safe — vacuously "sound"');
    assert.ok(ratio >= 0.8, `coverageFraction ratio ${ratio} < 0.8 (coverage=${env.coverageFraction}, analytic=${analytic})`);
  });

  it('3. monotone refinement — coverageFraction is non-decreasing as the grid refines, converging toward the analytic fraction', () => {
    const ns = [25, 50, 100, 150];
    const fractions = ns.map((n) => runScenario(n).coverageFraction);
    const analytic = analyticFraction(500);
    console.log(`[safety-envelope] refinement ${ns.map((n, i) => `n=${n}:${fractions[i].toFixed(4)}`).join(' ')} analytic=${analytic.toFixed(4)}`);
    for (let i = 1; i < fractions.length; i++) {
      assert.ok(fractions[i] >= fractions[i - 1] - 1e-12, `coverage decreased refining grid: ${fractions[i - 1]} -> ${fractions[i]}`);
    }
    // Converging toward (not overshooting past) the analytic fraction.
    assert.ok(fractions[fractions.length - 1] <= analytic + 1e-6, 'refined coverage exceeded the analytic fraction — unsound');
    assert.ok(analytic - fractions[fractions.length - 1] < analytic - fractions[0], 'refinement did not narrow the gap to the analytic fraction');
  });

  it('4. integrator oracle — rk4ODE reproduces xdot=a*x as x0*e^{a t} to <1e-9, independent of reachability logic', () => {
    const a = 1;
    const x0 = 1;
    const T = 1;
    const dt = 0.005; // 200 steps
    const traj = rk4ODE((_t, y) => a * y, x0, 0, T, dt);
    const final = traj[traj.length - 1];
    const closedForm = x0 * Math.exp(a * T);
    const err = Math.abs(final.y - closedForm);
    console.log(`[safety-envelope] rk4 oracle error=${err}`);
    assert.ok(err < 1e-9, `rk4ODE error ${err} exceeds 1e-9 vs closed form ${closedForm}`);
  });

  it('5. adversarial-input necessity — adversarialInput:false yields a strictly larger safe set than adversarialInput:true', () => {
    const envFalse = runScenario(80, { adversarialInput: false });
    const envTrue = runScenario(80, { adversarialInput: true });
    console.log(`[safety-envelope] adversarial coverage: false=${envFalse.coverageFraction} true=${envTrue.coverageFraction}`);
    assert.ok(envFalse.coverageFraction > envTrue.coverageFraction, 'adversarialInput:true did not shrink the safe set — the worst-case branch may be silently skipped');
    // Adversarial-safe cells must be a subset of the non-adversarial-safe cells.
    const centersFalse = cellCenters(envFalse);
    const centersTrue = cellCenters(envTrue);
    for (let i = 0; i < centersTrue.length; i++) {
      if (centersTrue[i].safe) assert.ok(centersFalse[i].safe, 'adversarial-safe cell was not also existence-safe — not a subset');
    }
  });
});

describe('safety-envelope — refusals', () => {
  it('refuses state_space_too_large with the computed cell count', () => {
    const stateBox = [
      { name: 'p', min: 0, max: 10, n: 600 },
      { name: 'v', min: 0, max: 10, n: 600 },
    ];
    assert.throws(
      () => computeEnvelope({ plant: PLANT, stateBox, inputBox: INPUT_BOX, constraints: CONSTRAINTS, horizon: { tHorizon: 1, dt: 0.1 } }),
      (err) => {
        assert.equal(err.code, 'state_space_too_large');
        assert.equal(err.cellCount, 360000);
        assert.ok(err.cellCount > MAX_GRID_CELLS);
        return true;
      },
    );
  });

  it('refuses unsupported_plant_kind for an unknown plant.kind', () => {
    const stateBox = [{ name: 'x', min: 0, max: 1, n: 10 }];
    assert.throws(
      () => computeEnvelope({ plant: { kind: 'quantum_flux_capacitor' }, stateBox, constraints: [], horizon: { tHorizon: 1, dt: 0.1 } }),
      (err) => { assert.equal(err.code, 'unsupported_plant_kind'); return true; },
    );
  });

  it('refuses unbound_variable when symbolic dynamics reference an undeclared symbol', () => {
    const plant = {
      kind: 'symbolic',
      vars: ['x'],
      input: 'u',
      dynamics: ['-k*x + z'], // 'z' is not in vars, input, or params
      params: { k: 0.2 },
    };
    const stateBox = [{ name: 'x', min: -1, max: 1, n: 10 }];
    assert.throws(
      () => computeEnvelope({ plant, stateBox, inputBox: { min: -1, max: 1, n: 2 }, constraints: [{ coeffs: [1], op: '<=', rhs: 5 }], horizon: { tHorizon: 1, dt: 0.1 } }),
      (err) => { assert.equal(err.code, 'unbound_variable'); assert.deepEqual(err.variables, ['z']); return true; },
    );
  });

  it('refuses lipschitz_bound_unavailable for an invalid declared bound', () => {
    const plant = { kind: 'symbolic', vars: ['x'], input: 'u', dynamics: ['-k*x + u'], params: { k: 0.2 } };
    const stateBox = [{ name: 'x', min: -1, max: 1, n: 10 }];
    assert.throws(
      () => computeEnvelope({ plant, stateBox, inputBox: { min: -1, max: 1, n: 2 }, constraints: [{ coeffs: [1], op: '<=', rhs: 5 }], horizon: { tHorizon: 1, dt: 0.1 }, declaredLipschitz: -3 }),
      (err) => { assert.equal(err.code, 'lipschitz_bound_unavailable'); return true; },
    );
  });
});
