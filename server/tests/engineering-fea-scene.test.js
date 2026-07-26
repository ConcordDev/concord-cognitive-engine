// server/tests/engineering-fea-scene.test.js
//
// Contract test for R5/E23 — the new `engineering.feaScene` macro
// (server/domains/engineering.js) that assembles a self-contained,
// client-consumable JSON payload (real node positions + member connectivity
// merged with the real solver's computed stress/utilization) for a 3D
// FEA-result renderer (world-lens-godot/engineering/fea_scene_builder.gd).
//
// Ground truth: the SAME simple cantilever fixture + hand-derived
// sigma=Mc/I this session's design-simulate-fea-loop.test.js already
// verified against fea-solver.js's own runFEA/checkUtilization — re-derived
// independently here (not imported/pasted) so this test's expected values
// don't depend on trusting that other file's assertions.
//
// Hermetic: no app boot, no network, no LLM, no DB. Registers the real
// server/domains/engineering.js handlers into a local Map and drives
// `feaScene` through the real 3-arg /api/lens/run dispatch shape, exactly
// like server/tests/engineering-lens-macros.test.js does for the sibling
// `runFEA` action.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import registerEngineeringActions from '../domains/engineering.js';
import { momentOfInertia, bendingStress } from '../lib/compute/physics-compute.js';

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function run(action, input = {}, ctx = CTX) {
  const fn = ACTIONS.get(`engineering.${action}`);
  if (!fn) throw new Error(`engineering.${action} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}
const CTX = { actor: { userId: 'eng_fea_scene' }, userId: 'eng_fea_scene' };

before(() => {
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});

// ── Ground-truth cantilever (independently re-derived, not pasted) ─────────
const L = 0.4;      // m
const P = 150;      // N transverse tip load
const base = 0.04, height = 0.012; // m
const area = base * height;
const I = momentOfInertia('rectangle', { base, height }).value;
const c = height / 2;
const E = 200e9; // Pa, steel
const ALLOWABLE = 150e6; // Pa

const MODEL = {
  nodes: [
    { id: 'A', x: 0, y: 0, z: 0 },
    { id: 'B', x: L, y: 0, z: 0 },
  ],
  members: [
    { id: 'm1', nodeI: 'A', nodeJ: 'B', area, momentI: I, elasticModulus: E, depthIn: height, allowableStress: ALLOWABLE },
  ],
  supports: [{ nodeId: 'A', type: 'fixed' }],
  loads: [{ nodeId: 'B', Fy: P }],
};

describe('engineering.feaScene — self-contained 3D scene payload', () => {
  it('is registered', () => {
    assert.ok(ACTIONS.has('engineering.feaScene'));
  });

  it('rejects an empty model honestly (no fabricated scene)', () => {
    const res = run('feaScene', { model: { nodes: [], members: [] } });
    assert.equal(res.ok, false);
    assert.match(res.error, /node and one member/);
  });

  it('echoes the REAL input geometry verbatim (positions + connectivity)', () => {
    const res = run('feaScene', { model: MODEL });
    assert.equal(res.ok, true);
    assert.equal(res.result.format, 'concord-fea-scene/v1');

    assert.deepEqual(res.result.nodes, [
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: L, y: 0, z: 0 },
    ]);
    assert.equal(res.result.members.length, 1);
    assert.equal(res.result.members[0].id, 'm1');
    assert.equal(res.result.members[0].nodeI, 'A');
    assert.equal(res.result.members[0].nodeJ, 'B');
  });

  it('merges the REAL solver-computed utilization — matches an independent hand-derived sigma=Mc/I', () => {
    const res = run('feaScene', { model: MODEL });
    assert.equal(res.ok, true);
    const member = res.result.members[0];

    // Analytic Euler-Bernoulli cantilever: max moment at the fixed root = P*L.
    const expectedMoment = P * L;
    const expectedStress = bendingStress({ moment: expectedMoment, momentI: I, distance: c }).value;
    const expectedUtilization = expectedStress / ALLOWABLE;

    assert.ok(
      Math.abs(member.utilization - expectedUtilization) / expectedUtilization < 1e-6,
      `feaScene utilization ${member.utilization} vs hand-derived ${expectedUtilization}`
    );
    assert.ok(member.utilization > 0 && member.utilization < 1, 'this section is designed to pass');
    assert.equal(member.pass, true);
    // Independently re-derive the expected band from the SAME hand-derived
    // utilization above (not a pasted literal) — this cantilever happens to
    // land at ~0.417, just above the low/moderate 0.4 threshold.
    const expectedBand = expectedUtilization > 1 ? 'overstressed'
      : expectedUtilization > 0.75 ? 'high'
      : expectedUtilization > 0.4 ? 'moderate'
      : 'low';
    assert.equal(member.band, expectedBand, `utilization ${member.utilization}`);
    assert.ok(Number.isFinite(member.bendingStress) && member.bendingStress > 0);
    assert.ok(Number.isFinite(member.combinedStress) && member.combinedStress > 0);
  });

  it('carries boundary conditions + reactions + summary through unmodified', () => {
    const res = run('feaScene', { model: MODEL });
    assert.equal(res.ok, true);
    assert.deepEqual(res.result.supports, MODEL.supports);
    assert.deepEqual(res.result.loads, MODEL.loads);
    assert.ok(Array.isArray(res.result.reactions) && res.result.reactions.length > 0);
    assert.ok(Array.isArray(res.result.displacements) && res.result.displacements.length === 2);
    assert.equal(res.result.summary.memberCount, 1);
    assert.equal(res.result.summary.nodeCount, 2);
    assert.equal(res.result.summary.allPass, true);
  });

  it('bands an overstressed member as overstressed (real discrimination, not a fixed verdict)', () => {
    // Same section but a much bigger tip load — expected to fail.
    const overloaded = {
      ...MODEL,
      loads: [{ nodeId: 'B', Fy: P * 50 }],
    };
    const res = run('feaScene', { model: overloaded });
    assert.equal(res.ok, true);
    const member = res.result.members[0];
    assert.ok(member.utilization > 1, `expected overstressed utilization, got ${member.utilization}`);
    assert.equal(member.band, 'overstressed');
    assert.equal(member.pass, false);
    assert.equal(res.result.summary.allPass, false);
  });
});
