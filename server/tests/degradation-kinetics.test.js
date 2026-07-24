/**
 * W1-A — Long-horizon materials degradation engine, kinetics-layer tests.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: every expected value
 * here is either (a) a closed-form analytic result derived independently
 * of the module-under-test's own numerics (the Paris closed-form-vs-RK4
 * cross-check integrates two INDEPENDENT algorithms — analytic
 * integration and numerical RK4 — and checks they agree), or (b) a hand
 * expression evaluated directly in this file from the textbook formula,
 * matching server/tests/aero-gate.test.js's "hand computation" convention
 * — never a value pasted from the module's own output.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rk4ODE } from '../lib/compute/numerical.js';
import {
  arrheniusRate,
  arrheniusRatio,
  stressIntensityRange,
  parisGrowthRate,
  parisLifeClosedForm,
  parisCrackGrowthOde,
  fickianUptakeFraction,
  integrateDegradation,
  GAS_CONSTANT_J_PER_MOL_K,
  SHORT_TIME_VALIDITY_THRESHOLD,
} from '../lib/simulation/degradation-kinetics.js';
import { getDegradationConstants } from '../lib/asset-gen/degradation-constants.js';

describe('stressIntensityRange + parisGrowthRate — formula sanity', () => {
  it('ΔK = Δσ·Y·√(π·a), hand-computable', () => {
    const deltaSigma = 100, Y = 1.1, a = 0.002;
    const expected = deltaSigma * Y * Math.sqrt(Math.PI * a);
    assert.ok(Math.abs(stressIntensityRange({ deltaSigma, Y, a }) - expected) < 1e-12);
  });

  it('da/dN = C·ΔK^m, hand-computable', () => {
    const C = 6.9e-12, m = 3.0, deltaK = 25;
    const expected = C * Math.pow(deltaK, m);
    assert.ok(Math.abs(parisGrowthRate({ C, m, deltaK }) - expected) < 1e-24);
  });
});

describe('Paris closed form vs RK4 — independent-algorithm cross-check', () => {
  it('integrating da/dN from a0 via RK4 for the closed-form N_f reproduces a_f to <1e-9 relative', () => {
    const C = 6.9e-12, m = 3.0, deltaSigma = 100, Y = 1, a0 = 0.001, af = 0.005;

    const closed = parisLifeClosedForm({ C, m, deltaSigma, Y, a0, af });
    assert.equal(closed.valid, true);
    assert.ok(Number.isFinite(closed.cycles) && closed.cycles > 0);

    // Independent numerical integration: rk4ODE marching a(N) forward from
    // a0 over exactly N_f cycles, using the SAME rate law (parisCrackGrowthOde)
    // but via completely separate machinery (RK4 stepping) than the
    // closed-form analytic integral above.
    const ode = parisCrackGrowthOde({ C, m, deltaSigma, Y });
    const steps = 2000;
    const trace = rk4ODE(ode, a0, 0, closed.cycles, closed.cycles / steps);
    const aFinal = trace[trace.length - 1].y;

    const relError = Math.abs(aFinal - af) / af;
    assert.ok(relError < 1e-9, `relative error ${relError} should be < 1e-9 (got a_final=${aFinal}, a_f=${af})`);
  });

  it('m=2 is honestly refused (log-form required), never a division by zero or NaN', () => {
    const result = parisLifeClosedForm({ C: 6.9e-12, m: 2, deltaSigma: 100, Y: 1, a0: 0.001, af: 0.005 });
    assert.deepEqual(result, { valid: false, reason: 'm_equals_2_requires_log_form' });
  });

  it('uses the real DEGRADATION_CONSTANTS steel-a36 Paris constants end-to-end (not a synthetic C/m)', () => {
    const steel = getDegradationConstants('steel-a36');
    assert.ok(steel.paris, 'steel-a36 must carry cited Paris constants');
    const { C, m } = steel.paris;
    const closed = parisLifeClosedForm({ C, m, deltaSigma: 80, Y: 1, a0: 0.0005, af: 0.003 });
    assert.equal(closed.valid, true);
    assert.ok(closed.cycles > 0);
  });
});

describe('arrheniusRatio — hand-computable textbook formula', () => {
  it('k(T2)/k(T1) = exp[-(Ea/R)(1/T2-1/T1)], matches a hand-evaluated expression', () => {
    const Ea_J_per_mol = 50000, T1_K = 300, T2_K = 350;
    const expected = Math.exp((-Ea_J_per_mol / GAS_CONSTANT_J_PER_MOL_K) * (1 / T2_K - 1 / T1_K));
    const got = arrheniusRatio({ Ea_J_per_mol, T1_K, T2_K });
    assert.ok(Math.abs(got - expected) < 1e-12, `${got} vs ${expected}`);
  });

  it('arrheniusRate(T2)/arrheniusRate(T1) equals arrheniusRatio (A cancels — independent of its value)', () => {
    const Ea_J_per_mol = 63000, T1_K = 293.15, T2_K = 313.15;
    for (const A of [1, 42, 1e13]) {
      const k1 = arrheniusRate({ A, Ea_J_per_mol, temperatureK: T1_K });
      const k2 = arrheniusRate({ A, Ea_J_per_mol, temperatureK: T2_K });
      const ratioFromRates = k2 / k1;
      const ratioDirect = arrheniusRatio({ Ea_J_per_mol, T1_K, T2_K });
      const relError = Math.abs(ratioFromRates - ratioDirect) / ratioDirect;
      assert.ok(relError < 1e-12, `A=${A}: ${ratioFromRates} vs ${ratioDirect}`);
    }
  });

  it('higher temperature gives a higher rate (positive activation energy, physically sane direction)', () => {
    const ratio = arrheniusRatio({ Ea_J_per_mol: 35000, T1_K: 293.15, T2_K: 313.15 });
    assert.ok(ratio > 1, 'rate constant should increase with temperature for Ea>0');
  });
});

describe('fickianUptakeFraction — Crank/Shen-Springer series vs short-time √t law', () => {
  it('matches the short-time approximation 4/h·√(Dt/π) to <1e-5 relative for Dt/h² ≤ 0.01', () => {
    const D = 1e-12, h = 0.01; // 1e-12 m^2/s, 1cm slab
    for (const dtOverHSq of [0.0001, 0.001, 0.01]) {
      const t = (dtOverHSq * h * h) / D;
      const { value, shortTimeApprox, shortTimeValid, dtOverHSquared } = fickianUptakeFraction(t, D, h);
      assert.ok(Math.abs(dtOverHSquared - dtOverHSq) < 1e-9, 'dtOverHSquared should reproduce the requested ratio');
      const relError = Math.abs(value - shortTimeApprox) / shortTimeApprox;
      assert.ok(relError < 1e-5, `Dt/h²=${dtOverHSq}: relative error ${relError} should be < 1e-5 (series=${value}, shortTime=${shortTimeApprox})`);
      assert.equal(shortTimeValid, true, `Dt/h²=${dtOverHSq} should be within the short-time validity threshold (${SHORT_TIME_VALIDITY_THRESHOLD})`);
    }
  });

  it('sets shortTimeValid:false at Dt/h² = 1 (short-time law no longer honestly applicable)', () => {
    const D = 1e-12, h = 0.01;
    const t = (1 * h * h) / D; // Dt/h² = 1 exactly
    const { shortTimeValid, dtOverHSquared } = fickianUptakeFraction(t, D, h);
    assert.ok(Math.abs(dtOverHSquared - 1) < 1e-9);
    assert.equal(shortTimeValid, false);
  });

  it('t=0 gives exactly zero uptake', () => {
    const { value } = fickianUptakeFraction(0, 1e-12, 0.01);
    assert.equal(value, 0);
  });
});

describe('fickianUptakeFraction — saturation + monotonicity', () => {
  it('M/M∞ approaches 1 as t grows large (Dt/h² >> 1)', () => {
    const D = 1e-12, h = 0.01;
    const tHuge = (50 * h * h) / D; // Dt/h² = 50
    const { value } = fickianUptakeFraction(tHuge, D, h);
    assert.ok(value > 0.999999, `expected near-saturation, got ${value}`);
  });

  it('is monotone non-decreasing across an increasing sequence of t', () => {
    const D = 1e-12, h = 0.01;
    const ratios = [0, 0.001, 0.01, 0.1, 0.5, 1, 5, 20, 50];
    let prev = -Infinity;
    for (const r of ratios) {
      const t = (r * h * h) / D;
      const { value } = fickianUptakeFraction(t, D, h);
      assert.ok(value >= prev - 1e-12, `uptake fraction decreased: ${prev} -> ${value} at Dt/h²=${r}`);
      assert.ok(value <= 1 + 1e-9, `uptake fraction exceeded 1: ${value} at Dt/h²=${r}`);
      prev = value;
    }
  });
});

describe('integrateDegradation — honest refusals + degrade-free-of-charge behavior', () => {
  it('refuses the "thermal" mechanism for every shipped material (no material cites an absolute Arrhenius A)', () => {
    for (const key of ['steel-a36', 'aluminum-7075-t6', 'concrete-30mpa', 'cfrp']) {
      const constants = getDegradationConstants(key);
      const result = integrateDegradation({
        mechanisms: ['thermal'],
        constants,
        thermal: { temperatureK: 300 },
      });
      assert.equal(result.ok, false, `${key} should refuse 'thermal'`);
      assert.equal(result.reason, 'missing_degradation_constants');
      assert.equal(result.mechanism, 'thermal');
    }
  });

  it('refuses "moisture" for a material with no diffusion table (steel-a36)', () => {
    const constants = getDegradationConstants('steel-a36');
    const result = integrateDegradation({
      mechanisms: ['moisture'],
      constants,
      moisture: { h: 0.01 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing_degradation_constants');
    assert.equal(result.mechanism, 'moisture');
  });

  it('an unrequested mechanism stays at its initial (zero-degradation) state', () => {
    const constants = getDegradationConstants('steel-a36');
    // a0 must be a real (nonzero) initial flaw — ΔK=Δσ·Y·√(π·a) is exactly
    // 0 at a=0, so a zero-length idealized point-crack never starts
    // growing (an honest consequence of the LEFM idealization, not a bug:
    // real fatigue analysis always assumes a finite initial flaw size).
    const result = integrateDegradation({
      mechanisms: ['fatigue'],
      constants,
      fatigue: { deltaSigma: 50, Y: 1, thickness: 0.05, a0: 0.0001 },
      years: 10,
    });
    assert.equal(result.ok, true);
    assert.equal(result.thermalExtent, 0);
    assert.equal(result.leachFraction, 0);
    assert.ok(result.a_crack > 0.0001, 'fatigue crack should have grown over 10 years of requested cycling');
  });

  it('refuses crack_exceeds_section when the crack marches past the given thickness', () => {
    const constants = getDegradationConstants('steel-a36');
    const result = integrateDegradation({
      mechanisms: ['fatigue'],
      constants,
      // A deliberately tiny thickness + large stress range so the crack
      // reaches it well within the 50-year horizon.
      fatigue: { deltaSigma: 300, Y: 1.5, thickness: 0.001, a0: 0.0005, cyclesPerYear: 5000 },
      years: 50,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'crack_exceeds_section');
    assert.ok(Number.isFinite(result.failureYear));
  });
});
