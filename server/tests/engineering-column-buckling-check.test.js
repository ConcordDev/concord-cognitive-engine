// Closed-form gate for engineering.columnBucklingCheck
// Pcr = π²EI/(KL)² — analytical Euler, NOT FEA eigenvalue.
// Pinned-pinned K=1 relative error must be < 1e-6 vs hand formula.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import registerEngineeringActions from '../domains/engineering.js';
import { columnBuckling } from '../lib/compute/engineering-compute.js';

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function run(action, input = {}) {
  const fn = ACTIONS.get(`engineering.${action}`);
  if (!fn) throw new Error(`engineering.${action} not registered`);
  return fn({ actor: { userId: 'euler_test' }, userId: 'euler_test' }, { id: null, data: input, meta: {} }, input);
}

before(() => {
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});

describe('engineering.columnBucklingCheck — analytical Euler (not FEA eigenvalue)', () => {
  it('pinned-pinned K=1 imperial: relative error < 1e-6 vs π²EI/(KL)²', () => {
    const lengthFt = 12;
    const modulusE = 29e6; // psi
    const momentI = 82.8; // in^4
    const K = 1;
    const L_in = lengthFt * 12;
    const hand_lb = (Math.PI * Math.PI * modulusE * momentI) / ((K * L_in) ** 2);
    const hand_kips = hand_lb / 1000;

    const r = run('columnBucklingCheck', {
      lengthFt, modulusE, momentI, K, loadKips: 100,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.label, 'analytical_euler_not_fea_eigenvalue');
    assert.equal(r.result.honesty.label, 'analytical_euler_not_fea_eigenvalue');
    assert.equal(r.result.K, 1);
    assert.equal(r.result.endConditions, 'pinned-pinned');
    assert.equal(r.result.formula, 'Pcr = π²EI/(KL)²');

    const rel = Math.abs(r.result.Pcr_kips - hand_kips) / hand_kips;
    assert.ok(rel < 1e-6, `relative error ${rel} >= 1e-6 (got ${r.result.Pcr_kips}, hand ${hand_kips})`);

    // Axial utilization honesty = P/Pcr
    const utilHand = 100 / hand_kips;
    const utilRel = Math.abs(r.result.axialUtilizationEuler - utilHand) / utilHand;
    assert.ok(utilRel < 1e-6, `util relative error ${utilRel}`);
    assert.equal(r.result.passBuckling, true);
  });

  it('pinned-pinned K=1 SI: relative error < 1e-6 vs π²EI/(KL)²', () => {
    const lengthM = 3.6576; // 12 ft
    const E = 2e11; // Pa (steel)
    const I = 3.447e-5; // m^4 ≈ 82.8 in^4
    const K = 1;
    const hand_N = (Math.PI * Math.PI * E * I) / ((K * lengthM) ** 2);

    const r = run('columnBucklingCheck', {
      lengthM, E_Pa: E, I_m4: I, K, loadN: hand_N * 0.5,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.label, 'analytical_euler_not_fea_eigenvalue');
    const rel = Math.abs(r.result.Pcr_N - hand_N) / hand_N;
    assert.ok(rel < 1e-6, `SI relative error ${rel} >= 1e-6`);
    assert.ok(Math.abs(r.result.axialUtilizationEuler - 0.5) < 1e-6);
  });

  it('compute-layer columnBuckling matches macro within 1e-6 (imperial)', () => {
    const args = { lengthFt: 12, modulusE: 29e6, momentI: 82.8, kFactor: 1, loadKips: 200 };
    const c = columnBuckling(args);
    const r = run('columnBucklingCheck', { ...args, K: 1 });
    assert.ok(!c.error);
    assert.equal(r.ok, true);
    const rel = Math.abs(r.result.Pcr_kips - c.value) / c.value;
    assert.ok(rel < 1e-6);
  });

  it('fail-closed: non-positive length → ok:false', () => {
    const r = run('columnBucklingCheck', { lengthFt: 0, modulusE: 29e6, momentI: 82.8, K: 1 });
    assert.equal(r.ok, false);
  });

  it('honesty: never claims fea eigenvalue', () => {
    const r = run('columnBucklingCheck', {
      lengthFt: 10, modulusE: 29e6, momentI: 100, K: 1, loadKips: 50,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.honesty.not.includes('fea_eigenvalue_buckling'));
    assert.match(r.result.honesty.note, /Not an FEA eigenvalue/i);
  });
});
