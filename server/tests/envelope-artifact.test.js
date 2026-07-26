// server/tests/envelope-artifact.test.js
//
// Validation for server/lib/simulation/envelope-artifact.js — the data
// artifact builder that turns a computeEnvelope() result into a static
// lookup table for an RT toolchain.
//
//  6. Claim-tier enforcement — a sampled (empirical) Lipschitz estimate
//     must never be dressed up as a proof.
//  7. RUNTIME_BOUNDARY text is present, verbatim-substring, in every
//     emitted format.
//  8. Honest refusals with specific reasons.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEnvelope, MAX_GRID_CELLS } from '../lib/simulation/safety-envelope.js';
import { buildArtifact, emitTable, RUNTIME_BOUNDARY } from '../lib/simulation/envelope-artifact.js';

const LINEAR_PLANT = { kind: 'linear', A: [[0, 1], [0, 0]], B: [[0], [1]], c: [0, 0] };
const LINEAR_STATE_BOX = [
  { name: 'p', min: 0, max: 10, n: 20 },
  { name: 'v', min: 0, max: 5, n: 20 },
];
const LINEAR_INPUT_BOX = { min: -2, max: 2, n: 2 };
const LINEAR_CONSTRAINTS = [{ coeffs: [1, 0], op: '<=', rhs: 10 }];
const LINEAR_HORIZON = { tHorizon: 2.7, dt: 0.0135 };

function linearEnvelope() {
  return computeEnvelope({
    plant: LINEAR_PLANT,
    stateBox: LINEAR_STATE_BOX,
    inputBox: LINEAR_INPUT_BOX,
    constraints: LINEAR_CONSTRAINTS,
    horizon: LINEAR_HORIZON,
  });
}

// Genuinely nonlinear symbolic plant — cubic damping means the Jacobian
// varies with state, so there is no exact closed-form bound: the engine
// must fall back to sampling and MUST tag the result empirical.
const SYMBOLIC_PLANT = {
  kind: 'symbolic',
  vars: ['x'],
  input: 'u',
  dynamics: ['-k*x^3 + u'],
  params: { k: 0.1 },
};
const SYMBOLIC_STATE_BOX = [{ name: 'x', min: -2, max: 2, n: 20 }];
const SYMBOLIC_INPUT_BOX = { min: -1, max: 1, n: 2 };
const SYMBOLIC_CONSTRAINTS = [{ coeffs: [1], op: '<=', rhs: 5 }];
const SYMBOLIC_HORIZON = { tHorizon: 1, dt: 0.05 };

function symbolicEnvelope() {
  return computeEnvelope({
    plant: SYMBOLIC_PLANT,
    stateBox: SYMBOLIC_STATE_BOX,
    inputBox: SYMBOLIC_INPUT_BOX,
    constraints: SYMBOLIC_CONSTRAINTS,
    horizon: SYMBOLIC_HORIZON,
  });
}

describe('envelope-artifact — 6. claim-tier enforcement', () => {
  it('linear plant -> exact_linear basis -> certified_modulo_declared_bound, WITH proofOfBounds', () => {
    const env = linearEnvelope();
    const artifact = buildArtifact(env);
    assert.equal(env.lipschitz.basis, 'exact_linear');
    assert.equal(artifact.claimTier, 'certified_modulo_declared_bound');
    assert.ok(artifact.proofOfBounds, 'certified artifact should carry proofOfBounds');
    assert.equal(artifact.empiricalBoundsEvidence, undefined);
  });

  it('symbolic plant with a sampled Lipschitz estimate -> empirical_sampled, NO proofOfBounds, and "proof" appears nowhere in the JSON emission', () => {
    const env = symbolicEnvelope();
    assert.equal(env.lipschitz.basis, 'sampled_jacobian_estimate');
    const artifact = buildArtifact(env);
    assert.equal(artifact.claimTier, 'empirical_sampled');
    assert.equal('proofOfBounds' in artifact, false, 'empirical artifact must not carry proofOfBounds');
    assert.ok(artifact.empiricalBoundsEvidence, 'empirical artifact should carry empiricalBoundsEvidence instead');

    const json = emitTable(artifact, 'json');
    assert.equal(json.toLowerCase().includes('proof'), false, 'the word "proof" must not appear anywhere in an empirical-tier JSON emission');
  });

  it('a declared Lipschitz bound on a symbolic plant also certifies (basis:"declared")', () => {
    const env = computeEnvelope({
      plant: SYMBOLIC_PLANT,
      stateBox: SYMBOLIC_STATE_BOX,
      inputBox: SYMBOLIC_INPUT_BOX,
      constraints: SYMBOLIC_CONSTRAINTS,
      horizon: SYMBOLIC_HORIZON,
      declaredLipschitz: 5,
    });
    assert.equal(env.lipschitz.basis, 'declared');
    const artifact = buildArtifact(env);
    assert.equal(artifact.claimTier, 'certified_modulo_declared_bound');
    assert.ok(artifact.proofOfBounds);
  });
});

describe('envelope-artifact — 7. RUNTIME_BOUNDARY is embedded in every emitted format', () => {
  const DISTINCTIVE_SUBSTRING = 'Concord does not and cannot execute real-time control';

  it('RUNTIME_BOUNDARY itself contains the distinctive substring (sanity)', () => {
    assert.ok(RUNTIME_BOUNDARY.includes(DISTINCTIVE_SUBSTRING));
  });

  for (const format of ['json', 'csv', 'c-header']) {
    it(`emitTable(..., '${format}') contains the runtime boundary text`, () => {
      const artifact = buildArtifact(linearEnvelope());
      const out = emitTable(artifact, format);
      assert.ok(out.includes(DISTINCTIVE_SUBSTRING), `${format} emission is missing the runtime boundary text`);
    });
  }

  it('the c-header format is a data table, never executable control logic', () => {
    const artifact = buildArtifact(linearEnvelope());
    const out = emitTable(artifact, 'c-header');
    assert.ok(out.includes('static const'), 'c-header should declare a static const lookup table');
    assert.equal(/\bwhile\s*\(/.test(out), false, 'c-header must not contain a control loop');
    assert.equal(/\bfor\s*\(/.test(out), false, 'c-header must not contain a control loop');
  });

  it('emitTable rejects an unsupported format', () => {
    const artifact = buildArtifact(linearEnvelope());
    assert.throws(() => emitTable(artifact, 'yaml'), (err) => { assert.equal(err.code, 'unsupported_format'); return true; });
  });
});

describe('envelope-artifact — 8. honest refusals', () => {
  it('state_space_too_large', () => {
    const stateBox = [
      { name: 'p', min: 0, max: 10, n: 600 },
      { name: 'v', min: 0, max: 10, n: 600 },
    ];
    assert.throws(
      () => computeEnvelope({ plant: LINEAR_PLANT, stateBox, inputBox: LINEAR_INPUT_BOX, constraints: LINEAR_CONSTRAINTS, horizon: { tHorizon: 1, dt: 0.1 } }),
      (err) => {
        assert.equal(err.code, 'state_space_too_large');
        assert.ok(err.cellCount > MAX_GRID_CELLS);
        return true;
      },
    );
  });

  it('unsupported_plant_kind', () => {
    assert.throws(
      () => computeEnvelope({
        plant: { kind: 'bond_graph_v9' },
        stateBox: [{ name: 'x', min: 0, max: 1, n: 5 }],
        constraints: [],
        horizon: { tHorizon: 1, dt: 0.1 },
      }),
      (err) => { assert.equal(err.code, 'unsupported_plant_kind'); return true; },
    );
  });

  it('unbound_variable', () => {
    const plant = { kind: 'symbolic', vars: ['x'], input: 'u', dynamics: ['-k*x + q'], params: { k: 0.1 } };
    assert.throws(
      () => computeEnvelope({
        plant,
        stateBox: [{ name: 'x', min: -1, max: 1, n: 10 }],
        inputBox: { min: -1, max: 1, n: 2 },
        constraints: [{ coeffs: [1], op: '<=', rhs: 5 }],
        horizon: { tHorizon: 1, dt: 0.1 },
      }),
      (err) => { assert.equal(err.code, 'unbound_variable'); assert.deepEqual(err.variables, ['q']); return true; },
    );
  });

  it('lipschitz_bound_unavailable', () => {
    const plant = { kind: 'symbolic', vars: ['x'], input: 'u', dynamics: ['-k*x + u'], params: { k: 0.1 } };
    assert.throws(
      () => computeEnvelope({
        plant,
        stateBox: [{ name: 'x', min: -1, max: 1, n: 10 }],
        inputBox: { min: -1, max: 1, n: 2 },
        constraints: [{ coeffs: [1], op: '<=', rhs: 5 }],
        horizon: { tHorizon: 1, dt: 0.1 },
        declaredLipschitz: Number.NaN,
      }),
      (err) => { assert.equal(err.code, 'lipschitz_bound_unavailable'); return true; },
    );
  });
});
