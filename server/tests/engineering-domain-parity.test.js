// Contract tests for server/domains/engineering.js — CAD + simulation macros.
// Exercises every registered macro and asserts the { ok } envelope shape.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import registerEngineeringActions from '../domains/engineering.js';

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, data = {}, params = {}) {
  const fn = ACTIONS.get(`engineering.${name}`);
  if (!fn) throw new Error(`engineering.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  // STATE store for the per-user macros.
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});

beforeEach(() => {
  // Reset the per-user store between tests.
  globalThis._concordSTATE = {};
});

const ctx = { actor: { userId: 'eng_user' }, userId: 'eng_user' };

// ── Frame model fixture (simply supported beam) ───────────────────────────────
const FRAME = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 5, y: 0, z: 0 },
    { id: 'N3', x: 10, y: 0, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 0.01, momentI: 1e-5, elasticModulus: 2e11, allowableStress: 2.5e8 },
    { id: 'M2', nodeI: 'N2', nodeJ: 'N3', area: 0.01, momentI: 1e-5, elasticModulus: 2e11, allowableStress: 2.5e8 },
  ],
  loads: [{ nodeId: 'N2', Fy: -5000 }],
  supports: [
    { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { nodeId: 'N3', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
  ],
};

describe('engineering — compute macros', () => {
  it('toleranceAnalysis stacks nominal + RSS', () => {
    const r = call('toleranceAnalysis', ctx, {
      parts: [
        { name: 'A', nominal: 10, tolerance: 0.02 },
        { name: 'B', nominal: 5, tolerance: 0.01 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stackUp.nominal, 15);
    assert.ok(r.result.stackUp.rssTolerance > 0);
  });

  it('toleranceChain returns a directional closing dimension', () => {
    const r = call('toleranceChain', ctx, {
      links: [
        { name: 'bore', nominal: 50, tolerance: 0.025, direction: 1 },
        { name: 'shaft', nominal: 49.95, tolerance: 0.015, direction: -1 },
      ],
      targetGap: 0.05,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.chain.length, 2);
    assert.ok(r.result.fitVerdict);
    assert.ok('worstCaseFits' in r.result.fitVerdict);
  });

  it('stressAnalysis computes a safety factor', () => {
    const r = call('stressAnalysis', ctx, {
      forceNewtons: 10000,
      crossSectionMm2: 100,
      yieldStrengthMPa: 250,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.safetyFactor, 2.5);
  });

  it('unitConvert converts mm to in', () => {
    const r = call('unitConvert', ctx, { value: 25.4, from: 'mm', to: 'in' });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, '1 in');
  });

  it('materialLibrary lists materials and categories', () => {
    const r = call('materialLibrary', ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.materials.length > 5);
    assert.ok(r.result.categories.includes('metal'));
  });

  it('materialLibrary returns a single material by id', () => {
    const r = call('materialLibrary', ctx, {}, { id: 'aluminum-6061-t6' });
    assert.equal(r.ok, true);
    assert.equal(r.result.id, 'aluminum-6061-t6');
    assert.ok(r.result.E > 0);
  });

  it('parametricSolid computes volume + mass for a box', () => {
    const r = call('parametricSolid', ctx, {
      kind: 'box',
      material: 'steel-a36',
      params: { width: 0.1, height: 0.1, length: 1 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.volume > 0);
    assert.ok(r.result.mass > 0);
    assert.ok(r.result.section);
  });

  it('partMesh returns triangle geometry for all primitive kinds', () => {
    for (const kind of ['box', 'cylinder', 'tube', 'sphere', 'i-beam']) {
      const r = call('partMesh', ctx, { kind, params: {} });
      assert.equal(r.ok, true, `partMesh failed for ${kind}`);
      assert.ok(r.result.positions.length > 0);
      assert.ok(r.result.indices.length > 0);
      assert.equal(r.result.indices.length, r.result.triangleCount * 3);
    }
  });
});

describe('engineering — mesh + FEA', () => {
  it('meshGenerate subdivides members into elements', () => {
    const r = call('meshGenerate', ctx, { model: FRAME }, { divisions: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.divisions, 4);
    assert.ok(r.result.stats.meshElements >= FRAME.members.length * 4);
    assert.ok(r.result.mesh.nodes.length > FRAME.nodes.length);
  });

  it('meshGenerate rejects an empty model', () => {
    const r = call('meshGenerate', ctx, { model: { nodes: [], members: [] } });
    assert.equal(r.ok, false);
  });

  it('runFEA solves a frame and returns displacements + utilization', () => {
    const r = call('runFEA', ctx, { model: FRAME });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.displacements));
    assert.ok(Array.isArray(r.result.utilization));
    assert.ok(Array.isArray(r.result.contour));
    assert.ok(r.result.summary);
    assert.ok(r.result.jobId);
  });

  it('runFEA rejects an empty model', () => {
    const r = call('runFEA', ctx, { model: { nodes: [], members: [] } });
    assert.equal(r.ok, false);
  });

  it('listSimJobs returns the persisted FEA run history', () => {
    call('runFEA', ctx, { model: FRAME });
    const r = call('listSimJobs', ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.jobs.length >= 1);
    assert.equal(r.result.jobs[0].status, 'completed');
  });
});

describe('engineering — load case store', () => {
  it('saveLoadCase + listLoadCases round-trips', () => {
    const s = call('saveLoadCase', ctx, {
      name: 'Wind Case',
      loads: [{ nodeId: 'N2', Fx: 1000 }],
      supports: FRAME.supports,
    });
    assert.equal(s.ok, true);
    const list = call('listLoadCases', ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.loadCases.length, 1);
    assert.equal(list.result.loadCases[0].name, 'Wind Case');
  });

  it('deleteLoadCase removes a saved case', () => {
    const s = call('saveLoadCase', ctx, { name: 'Tmp', loads: [], supports: [] });
    const id = s.result.loadCase.id;
    const d = call('deleteLoadCase', ctx, {}, { id });
    assert.equal(d.ok, true);
    assert.equal(d.result.deleted, 1);
  });
});

describe('engineering — part store', () => {
  it('savePart + listParts + deletePart round-trips', () => {
    const s = call('savePart', ctx, {
      name: 'Bracket',
      kind: 'box',
      material: 'aluminum-6061-t6',
      params: { width: 0.05, height: 0.05, length: 0.2 },
    });
    assert.equal(s.ok, true);
    assert.ok(s.result.part.geometry.mass > 0);
    const list = call('listParts', ctx);
    assert.equal(list.result.parts.length, 1);
    const d = call('deletePart', ctx, {}, { id: s.result.part.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.deleted, 1);
  });
});

describe('engineering — BOM', () => {
  it('bom totals extended cost', () => {
    const r = call('bom', ctx, {
      items: [{ partNumber: 'X', quantity: 4, unitCost: 10 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCost, 40);
  });

  it('bomRollup adds overhead + supplier links + critical path', () => {
    const r = call(
      'bomRollup',
      ctx,
      {
        items: [
          { partNumber: 'W8X31', quantity: 4, unitCost: 142, supplier: 'Ryerson', leadTimeDays: 14 },
          { partNumber: 'BOLT', quantity: 32, unitCost: 0.85, supplier: 'McMaster', leadTimeDays: 2 },
        ],
      },
      { buildQty: 2, overheadRate: 0.15 },
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.buildQty, 2);
    assert.ok(r.result.rollup.totalCost > r.result.rollup.materialCost);
    assert.ok(r.result.rows[0].supplierLinks.mcmaster.startsWith('https://'));
    assert.ok(r.result.criticalPath.length > 0);
    assert.equal(r.result.criticalPath[0].partNumber, 'W8X31');
  });
});
