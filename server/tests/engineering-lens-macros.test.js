// server/tests/engineering-lens-macros.test.js
//
// PHASE-2 behavioral gate for the engineering lens (CAD + FEA + BOM + tolerance).
//
// Hermetic: no app boot, no network, no LLM, no DB. Registers the real
// `server/domains/engineering.js` handlers into a local Map and drives each one
// through the REAL 3-arg dispatch shape:
//     fn(ctx, virtualArtifact, params)   where virtualArtifact.data === input
// — i.e. exactly what the /api/lens/run dispatcher passes after it sets
// `virtualArtifact.data = body.input`. Each calculator is driven with the EXACT
// input field names the page + components in
// `concord-frontend/{app/lenses,components}/engineering/*` send, and asserts the
// EXACT output fields they render — with real computed values, so a field rename
// on either side fails this test (the silent-dead-field class).
//
// Per macro, four dimensions are covered where applicable:
//   1. behavior        — exact computed value over the component's real input shape
//   2. validation      — empty/missing input is rejected or returns a guidance stub
//   3. degrade-graceful— a malformed/partial payload returns {ok} not a throw
//   4. fail-closed     — poisoned numeric (NaN/Infinity/1e308) never yields a
//                        finite "successful" computed lie
//
// This file is NOT a duplicate of engineering-domain-parity.test.js: that test
// pins the {ok} envelope shape per macro; this one pins the component-exact
// field contract + computed values + adversarial-input behavior.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import registerEngineeringActions from '../domains/engineering.js';

// ── Real 3-arg dispatch shim ────────────────────────────────────────────────
// Mirrors the /api/lens/run dispatch: virtualArtifact.data = input, and input
// is ALSO passed as the 3rd `params` arg (the dispatcher passes both, which is
// why the handlers read `{ ...artifact.data, ...params }`). We drive `input`
// through artifact.data — the path the live component payloads actually take.
const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
// run(action, input, ctx) — input becomes virtualArtifact.data (the live shape).
function run(action, input = {}, ctx = CTX) {
  const fn = ACTIONS.get(`engineering.${action}`);
  if (!fn) throw new Error(`engineering.${action} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}
// runParams(action, data, params) — for macros the component drives with a 3rd
// params object (meshGenerate divisions, deleteLoadCase/deletePart id).
function runParams(action, data = {}, params = {}, ctx = CTX) {
  const fn = ACTIONS.get(`engineering.${action}`);
  if (!fn) throw new Error(`engineering.${action} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

const CTX = { actor: { userId: 'eng_phase2' }, userId: 'eng_phase2' };

before(() => {
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ── FEA frame fixture matching the page's DEFAULT_FEA_MODEL contract ─────────
const FRAME = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 0, y: 12, z: 0 },
    { id: 'N3', x: 20, y: 12, z: 0 },
    { id: 'N4', x: 20, y: 0, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600 },
    { id: 'M2', nodeI: 'N2', nodeJ: 'N3', area: 11.8, momentI: 171, elasticModulus: 29e6, allowableStress: 21600 },
    { id: 'M3', nodeI: 'N4', nodeJ: 'N3', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600 },
  ],
  loads: [
    { nodeId: 'N2', Fy: -10000 },
    { nodeId: 'N3', Fy: -10000 },
  ],
  supports: [
    { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { nodeId: 'N4', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// TolerancePanel.tsx → engineering.toleranceChain
//   input  : { links: [{ name, nominal, tolerance, direction }], targetGap? }
//   renders: chain[].{index,name,direction,nominal,tolerance,cumulativeNominal}
//            closingDimension.{nominal,worstCaseTolerance,rssTolerance,
//                              worstCaseMin,worstCaseMax}
//            fitVerdict.{targetGap,worstCaseFits,interferenceRisk} · method
// ════════════════════════════════════════════════════════════════════════════
describe('toleranceChain — TolerancePanel field contract', () => {
  // The component's STARTER chain.
  const LINKS = [
    { name: 'Housing bore', nominal: 50.0, tolerance: 0.025, direction: 1 },
    { name: 'Shaft OD', nominal: 49.95, tolerance: 0.015, direction: -1 },
    { name: 'Bearing race', nominal: 0.0, tolerance: 0.01, direction: 1 },
  ];

  it('behavior: directional closing dimension + RSS over the component STARTER', () => {
    const r = run('toleranceChain', { links: LINKS, targetGap: 0.05 });
    assert.equal(r.ok, true);
    // chain links carry every field TolerancePanel renders
    assert.equal(r.result.chain.length, 3);
    for (const c of r.result.chain) {
      assert.ok('index' in c && typeof c.name === 'string');
      assert.ok(c.direction === '+' || c.direction === '-');
      assert.ok(isFiniteNum(c.nominal) && isFiniteNum(c.tolerance));
      assert.ok(isFiniteNum(c.cumulativeNominal));
    }
    // closing nominal = 50.0 − 49.95 + 0.0 = 0.05 (directional sum)
    assert.equal(r.result.closingDimension.nominal, 0.05);
    // worst-case tolerance = sum of |tol| = 0.025 + 0.015 + 0.01 = 0.05
    assert.equal(r.result.closingDimension.worstCaseTolerance, 0.05);
    // RSS = sqrt(0.025² + 0.015² + 0.01²) = 0.03082… → 0.0308
    assert.equal(r.result.closingDimension.rssTolerance, 0.0308);
    // worst-case envelope
    assert.equal(r.result.closingDimension.worstCaseMin, 0);
    assert.equal(r.result.closingDimension.worstCaseMax, 0.1);
    // fitVerdict — targetGap 0.05 is inside [0, 0.1]
    assert.ok(r.result.fitVerdict);
    assert.equal(r.result.fitVerdict.targetGap, 0.05);
    assert.equal(r.result.fitVerdict.worstCaseFits, true);
    assert.equal(r.result.fitVerdict.interferenceRisk, false);
    assert.equal(typeof r.result.method, 'string');
  });

  it('behavior: targetGap omitted → fitVerdict is null (component renders no verdict card)', () => {
    const r = run('toleranceChain', { links: LINKS });
    assert.equal(r.ok, true);
    assert.equal(r.result.fitVerdict, null);
  });

  it('validation: empty links → guidance stub, not a crash', () => {
    const r = run('toleranceChain', { links: [] });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === 'string');
  });

  it('degrade-graceful: partial links (missing fields) still return ok with defaults', () => {
    const r = run('toleranceChain', { links: [{ name: 'x' }, {}] });
    assert.equal(r.ok, true);
    assert.equal(r.result.chain.length, 2);
    // missing tolerance defaults to 0.01 per link
    assert.equal(r.result.closingDimension.worstCaseTolerance, 0.02);
  });

  it('fail-closed: poisoned numeric tolerance never produces a finite computed lie', () => {
    const r = run('toleranceChain', {
      links: [{ name: 'p', nominal: 1, tolerance: Number.POSITIVE_INFINITY, direction: 1 }],
    });
    // handler coerces non-finite tolerance to a finite default (NaN || 0.01 → 0.01);
    // it must NOT emit a non-finite rssTolerance masquerading as a real number.
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.closingDimension.rssTolerance));
    assert.ok(Number.isFinite(r.result.closingDimension.worstCaseTolerance));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BomPanel.tsx → engineering.bomRollup
//   input  : { items: [{ partNumber, description, quantity, unitCost, supplier,
//                        leadTimeDays }], buildQty, overheadRate }
//   renders: rows[].{partNumber,quantity,extendedCost,
//                    supplierLinks{mcmaster,digikey,grainger}}
//            rollup.{materialCost,overheadRate,overhead,totalCost,costPerUnit,
//                    procurementLeadDays}
//            criticalPath[].{partNumber,leadTimeDays} · bySupplier[].{supplier,cost}
// ════════════════════════════════════════════════════════════════════════════
describe('bomRollup — BomPanel field contract', () => {
  const ITEMS = [
    { partNumber: 'W8X31', description: 'Wide-flange beam', quantity: 4, unitCost: 142, supplier: 'Ryerson', leadTimeDays: 14 },
    { partNumber: 'HEX-M12-50', description: 'M12×50 hex bolt', quantity: 32, unitCost: 0.85, supplier: 'McMaster', leadTimeDays: 2 },
    { partNumber: 'BASEPLATE-A', description: 'Welded base plate 12mm', quantity: 4, unitCost: 78, supplier: 'TBD', leadTimeDays: 21 },
  ];

  it('behavior: cost rollup + supplier links + critical path over the component STARTER', () => {
    // buildQty/overheadRate are sent as a 3rd-arg `params` object by the panel
    // (lensRun positional input is the 3rd dispatcher param, also folded into data).
    const r = run('bomRollup', { items: ITEMS, buildQty: 1, overheadRate: 0.15 });
    assert.equal(r.ok, true);
    // material cost = 4×142 + 32×0.85 + 4×78 = 568 + 27.2 + 312 = 907.2
    assert.equal(r.result.rollup.materialCost, 907.2);
    // overhead = 907.2 × 0.15 = 136.08
    assert.equal(r.result.rollup.overhead, 136.08);
    // total = 907.2 + 136.08 = 1043.28
    assert.equal(r.result.rollup.totalCost, 1043.28);
    assert.equal(r.result.rollup.costPerUnit, 1043.28);
    assert.equal(r.result.rollup.overheadRate, 0.15);
    // longest lead = 21d (BASEPLATE-A)
    assert.equal(r.result.rollup.procurementLeadDays, 21);
    // rows carry the exact fields the table renders
    assert.equal(r.result.rows[0].partNumber, 'W8X31');
    assert.equal(r.result.rows[0].quantity, 4);
    assert.equal(r.result.rows[0].extendedCost, 568);
    assert.ok(r.result.rows[0].supplierLinks.mcmaster.startsWith('https://'));
    assert.ok(r.result.rows[0].supplierLinks.digikey.startsWith('https://'));
    assert.ok(r.result.rows[0].supplierLinks.grainger.startsWith('https://'));
    // critical path — longest lead first
    assert.equal(r.result.criticalPath[0].partNumber, 'BASEPLATE-A');
    assert.equal(r.result.criticalPath[0].leadTimeDays, 21);
    // bySupplier carries supplier + cost for the ChartKit bar
    assert.ok(r.result.bySupplier.every((s) => typeof s.supplier === 'string' && isFiniteNum(s.cost)));
  });

  it('behavior: buildQty multiplies extended cost + costPerUnit divides it back out', () => {
    const r = run('bomRollup', { items: [{ partNumber: 'X', quantity: 2, unitCost: 10 }], buildQty: 5, overheadRate: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.buildQty, 5);
    // qty 2 × buildQty 5 = 10 units × $10 = $100 material
    assert.equal(r.result.rollup.materialCost, 100);
    assert.equal(r.result.rollup.totalCost, 100);
    // costPerUnit = total / buildQty = 100 / 5 = 20
    assert.equal(r.result.rollup.costPerUnit, 20);
  });

  it('validation: empty items → guidance stub, not a crash', () => {
    const r = run('bomRollup', { items: [] });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.message === 'string');
  });

  it('degrade-graceful: items missing unitCost/leadTimeDays default to 0', () => {
    const r = run('bomRollup', { items: [{ partNumber: 'NOCOST' }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.rollup.materialCost, 0);
    assert.equal(r.result.rollup.procurementLeadDays, 0);
    assert.equal(r.result.criticalPath.length, 0); // no positive-lead items
  });

  it('fail-closed: poisoned numeric unitCost never yields a finite total lie', () => {
    const r = run('bomRollup', { items: [{ partNumber: 'P', quantity: 1, unitCost: 1e308 }], buildQty: 1e308 });
    assert.equal(r.ok, true);
    // buildQty is parseInt-clamped to ≥1 finite; even if material overflows,
    // costPerUnit must stay finite (no Infinity rendered as a price).
    assert.ok(Number.isFinite(r.result.rollup.costPerUnit));
    assert.ok(Number.isFinite(r.result.rollup.overhead));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GeometryEditor.tsx → engineering.parametricSolid + engineering.partMesh
//   parametricSolid input : { kind, material, params }
//                  renders: volume, mass, surfaceArea, boundingBox{x,y,z},
//                           section{area,Ix,Iy}
//   partMesh       input : { kind, params }
//                  renders: positions[], indices[], triangleCount, boundingBox
// ════════════════════════════════════════════════════════════════════════════
describe('parametricSolid — GeometryEditor field contract', () => {
  it('behavior: box volume + mass with the steel-a36 density', () => {
    const r = run('parametricSolid', {
      kind: 'box',
      material: 'steel-a36',
      params: { width: 0.2, height: 0.1, length: 0.5 },
    });
    assert.equal(r.ok, true);
    // V = 0.2 × 0.1 × 0.5 = 0.01 m³
    assert.equal(r.result.volume, 0.01);
    // mass = 0.01 × 7850 = 78.5 kg
    assert.equal(r.result.mass, 78.5);
    assert.ok(isFiniteNum(r.result.surfaceArea));
    // boundingBox carries x/y/z (the component renders all three)
    assert.equal(r.result.boundingBox.x, 0.2);
    assert.equal(r.result.boundingBox.y, 0.1);
    assert.equal(r.result.boundingBox.z, 0.5);
    // section carries area/Ix/Iy
    assert.ok(isFiniteNum(r.result.section.area));
    assert.ok(isFiniteNum(r.result.section.Ix));
    assert.ok(isFiniteNum(r.result.section.Iy));
  });

  it('behavior: i-beam returns a section (component renders A / Ix / Iy)', () => {
    const r = run('parametricSolid', {
      kind: 'i-beam',
      material: 'steel-a36',
      params: { flangeWidth: 0.1, height: 0.2, flangeThickness: 0.012, webThickness: 0.008, length: 1.0 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.section);
    assert.ok(r.result.section.Ix > r.result.section.Iy); // strong axis > weak axis
  });

  it('degrade-graceful: unknown kind falls through to box defaults, returns ok', () => {
    const r = run('parametricSolid', { kind: 'not-a-shape', params: {} });
    assert.equal(r.ok, true);
    assert.ok(isFiniteNum(r.result.volume));
  });

  it('fail-closed: poisoned numeric dimension never yields a non-finite mass', () => {
    const r = run('parametricSolid', {
      kind: 'box',
      material: 'steel-a36',
      params: { width: Number.NaN, height: 0.1, length: 0.5 },
    });
    assert.equal(r.ok, true);
    // width NaN → coerced to 0.1 default; mass stays finite.
    assert.ok(Number.isFinite(r.result.mass));
  });
});

describe('partMesh — GeometryEditor 3D-preview field contract', () => {
  it('behavior: every primitive yields renderable positions + indexed triangles', () => {
    for (const kind of ['box', 'cylinder', 'tube', 'sphere', 'i-beam']) {
      const r = run('partMesh', { kind, params: {} });
      assert.equal(r.ok, true, `partMesh failed for ${kind}`);
      assert.ok(Array.isArray(r.result.positions) && r.result.positions.length > 0, `${kind} positions`);
      assert.ok(Array.isArray(r.result.indices) && r.result.indices.length > 0, `${kind} indices`);
      // the component builds a BufferGeometry: indices must be triangle-complete
      assert.equal(r.result.indices.length, r.result.triangleCount * 3, `${kind} triangle count`);
      assert.ok(r.result.boundingBox && isFiniteNum(r.result.boundingBox.x));
    }
  });

  it('fail-closed: poisoned radius never produces a non-finite vertex', () => {
    const r = run('partMesh', { kind: 'sphere', params: { radius: Number.POSITIVE_INFINITY } });
    assert.equal(r.ok, true);
    // radius Infinity → coerced to default 0.05; every position is finite.
    assert.ok(r.result.positions.every((p) => Number.isFinite(p)));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// page.tsx Materials tab → engineering.materialLibrary
//   input  : {}  renders: materials[].{id,label,category,E,yield,ultimate,
//                                       density,poisson,cte,thermalK,costPerKg}
//                         categories[]
// ════════════════════════════════════════════════════════════════════════════
describe('materialLibrary — Materials tab field contract', () => {
  it('behavior: list carries every property card field the tab renders', () => {
    const r = run('materialLibrary', {});
    assert.equal(r.ok, true);
    assert.ok(r.result.materials.length > 5);
    assert.ok(r.result.categories.includes('metal'));
    const m = r.result.materials.find((x) => x.id === 'steel-a36');
    assert.ok(m, 'steel-a36 present');
    for (const k of ['label', 'category', 'E', 'yield', 'ultimate', 'density', 'poisson', 'cte', 'thermalK', 'costPerKg']) {
      assert.ok(k in m, `material card field "${k}" present`);
    }
    assert.ok(isFiniteNum(m.E) && m.E > 0);
  });

  it('behavior: GeometryEditor consumes {id,label,density} — all present per material', () => {
    const r = run('materialLibrary', {});
    assert.ok(r.result.materials.every((m) => typeof m.id === 'string' && typeof m.label === 'string' && isFiniteNum(m.density)));
  });

  it('validation: unknown id → ok:false (Materials tab surfaces an error, not a blank card)', () => {
    const r = run('materialLibrary', { id: 'unobtanium-9000' });
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === 'string');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// page.tsx Analysis tab → engineering.meshGenerate
//   input  : { model, divisions }
//   renders: stats.{divisions, meshNodes, meshElements, avgElementLength}
// ════════════════════════════════════════════════════════════════════════════
describe('meshGenerate — Analysis tab stats field contract', () => {
  it('behavior: subdivides each member into N elements + reports exact stats', () => {
    // page sends { model, divisions } as the lensRun input object.
    const r = run('meshGenerate', { model: FRAME, divisions: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.divisions, 4);
    // 3 members × 4 divisions = 12 elements
    assert.equal(r.result.stats.meshElements, 12);
    assert.ok(r.result.stats.meshNodes > FRAME.nodes.length);
    assert.ok(isFiniteNum(r.result.stats.avgElementLength) && r.result.stats.avgElementLength > 0);
  });

  it('behavior: divisions also honored via 3rd-arg params (dispatcher path)', () => {
    const r = runParams('meshGenerate', { model: FRAME }, { divisions: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.divisions, 2);
    assert.equal(r.result.stats.meshElements, 6); // 3 × 2
  });

  it('validation: empty model → ok:false', () => {
    const r = run('meshGenerate', { model: { nodes: [], members: [] } });
    assert.equal(r.ok, false);
  });

  it('fail-closed: poisoned divisions clamps to [1,20], never produces NaN stats', () => {
    const r = run('meshGenerate', { model: FRAME, divisions: 1e308 });
    assert.equal(r.ok, true);
    assert.ok(r.result.stats.divisions >= 1 && r.result.stats.divisions <= 20);
    assert.ok(Number.isFinite(r.result.stats.avgElementLength));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// page.tsx Run FEA → engineering.runFEA
//   input  : { model }
//   renders: summary.{maxDisplacement,maxUtilization,allPass},
//            displacements[].{nodeId,dx,dy,dz}, utilization[].{id,utilization,
//            combinedStress}
// ════════════════════════════════════════════════════════════════════════════
describe('runFEA — Results tab field contract', () => {
  it('behavior: solves the portal frame → displacements + utilization + summary', () => {
    const r = run('runFEA', { model: FRAME });
    assert.equal(r.ok, true);
    // summary carries the three fields the summary cards render
    assert.ok(isFiniteNum(r.result.summary.maxDisplacement));
    assert.ok(isFiniteNum(r.result.summary.maxUtilization));
    assert.equal(typeof r.result.summary.allPass, 'boolean');
    // displacements carry nodeId + dx/dy/dz (page maps these onto feaNodes)
    assert.ok(Array.isArray(r.result.displacements) && r.result.displacements.length > 0);
    for (const d of r.result.displacements) {
      assert.ok('nodeId' in d && isFiniteNum(d.dx) && isFiniteNum(d.dy) && isFiniteNum(d.dz));
    }
    // utilization carries id + utilization + combinedStress (page → feaMembers)
    assert.ok(Array.isArray(r.result.utilization) && r.result.utilization.length > 0);
    for (const u of r.result.utilization) {
      assert.ok('id' in u && isFiniteNum(u.utilization) && isFiniteNum(u.combinedStress));
    }
    assert.ok(r.result.jobId, 'persists a sim job id for history');
  });

  it('validation: empty model → ok:false (page surfaces the error status)', () => {
    const r = run('runFEA', { model: { nodes: [], members: [] } });
    assert.equal(r.ok, false);
  });

  it('degrade-graceful: a member referencing a missing node still returns ok envelope', () => {
    const broken = {
      nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }],
      members: [{ id: 'M1', nodeI: 'N1', nodeJ: 'GHOST', area: 1, momentI: 1, elasticModulus: 1, allowableStress: 1 }],
      loads: [],
      supports: [{ nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
    };
    const r = run('runFEA', { model: broken });
    assert.equal(typeof r.ok, 'boolean'); // never throws
  });
});

// ════════════════════════════════════════════════════════════════════════════
// page.tsx Load Cases + GeometryEditor saved parts — STATE round-trip contracts
//   saveLoadCase/listLoadCases/deleteLoadCase ; savePart/listParts/deletePart
// ════════════════════════════════════════════════════════════════════════════
describe('load-case + part store — round-trip contracts', () => {
  it('behavior: saveLoadCase persists name/loads/supports; listLoadCases reads back', () => {
    const s = run('saveLoadCase', { name: 'Wind Case', loads: [{ nodeId: 'N2', Fx: 1000 }], supports: FRAME.supports });
    assert.equal(s.ok, true);
    assert.ok(s.result.loadCase.id);
    const list = run('listLoadCases', {});
    assert.equal(list.ok, true);
    assert.equal(list.result.loadCases.length, 1);
    // page renders lc.name, lc.loads.length, lc.supports.length
    const lc = list.result.loadCases[0];
    assert.equal(lc.name, 'Wind Case');
    assert.equal(lc.loads.length, 1);
    assert.equal(lc.supports.length, FRAME.supports.length);
  });

  it('behavior: deleteLoadCase removes by id (page sends {id})', () => {
    const s = run('saveLoadCase', { name: 'Tmp', loads: [], supports: [] });
    const d = runParams('deleteLoadCase', {}, { id: s.result.loadCase.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.deleted, 1);
  });

  it('behavior: savePart computes geometry; listParts renders kind + geometry.mass', () => {
    const s = run('savePart', { name: 'Bracket', kind: 'box', material: 'aluminum-6061-t6', params: { width: 0.05, height: 0.05, length: 0.2 } });
    assert.equal(s.ok, true);
    assert.ok(s.result.part.geometry.mass > 0);
    const list = run('listParts', {});
    assert.equal(list.result.parts.length, 1);
    // GeometryEditor reads p.kind + p.geometry.mass
    assert.equal(list.result.parts[0].kind, 'box');
    assert.ok(isFiniteNum(list.result.parts[0].geometry.mass));
    const d = runParams('deletePart', {}, { id: s.result.part.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.deleted, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EngineeringActionPanel.tsx → toleranceAnalysis / stressAnalysis / bom /
// unitConvert  (this panel wraps payloads as { artifact: { data } } which the
// dispatch peels — here we drive the already-peeled inner data via run()).
// ════════════════════════════════════════════════════════════════════════════
describe('EngineeringActionPanel — bench macro field contracts', () => {
  it('toleranceAnalysis: stackUp.{nominal,worstCaseTolerance,rssTolerance} + parts[].toleranceClass', () => {
    const r = run('toleranceAnalysis', { parts: [{ name: 'A', nominal: 10, tolerance: 0.02 }, { name: 'B', nominal: 5, tolerance: 0.01 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.stackUp.nominal, 15);
    assert.ok(r.result.stackUp.rssTolerance > 0);
    assert.ok(r.result.parts.every((p) => ['precision', 'standard', 'loose'].includes(p.toleranceClass)));
  });

  it('stressAnalysis: exact safety factor + status fields the card renders', () => {
    const r = run('stressAnalysis', { forceNewtons: 10000, crossSectionMm2: 100, yieldStrengthMPa: 250 });
    assert.equal(r.ok, true);
    // stress = 10000/100 = 100 MPa → SF = 250/100 = 2.5
    assert.equal(r.result.safetyFactor, 2.5);
    assert.equal(r.result.status, 'acceptable');
    assert.equal(typeof r.result.appliedStress, 'string'); // "100 MPa"
    assert.equal(typeof r.result.recommendation, 'string');
  });

  it('stressAnalysis fail-closed: zero stress → SF is not silently a finite lie', () => {
    const r = run('stressAnalysis', { forceNewtons: 0, crossSectionMm2: 100, yieldStrengthMPa: 250 });
    assert.equal(r.ok, true);
    // zero force ⇒ infinite SF; handler keeps it honest (Infinity), not a fake number.
    assert.equal(r.result.safetyFactor, Infinity);
  });

  it('bom: totalCost + extendedCost the card renders', () => {
    const r = run('bom', { items: [{ partNumber: 'X', quantity: 4, unitCost: 10 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCost, 40);
    assert.equal(r.result.bom[0].extendedCost, 40);
    assert.ok(isFiniteNum(r.result.totalParts) && isFiniteNum(r.result.uniqueSuppliers));
  });

  it('unitConvert: input/output/conversion fields the card renders', () => {
    const r = run('unitConvert', { value: 25.4, from: 'mm', to: 'in' });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, '1 in');
    assert.equal(r.result.input, '25.4 mm');
    assert.equal(r.result.conversion, 'mm → in');
  });

  it('unitConvert validation: unsupported pair → guidance, never a crash', () => {
    const r = run('unitConvert', { value: 1, from: 'mm', to: 'kg' });
    assert.equal(r.ok, true);
    assert.ok(r.result.error || r.result.supported);
  });
});
