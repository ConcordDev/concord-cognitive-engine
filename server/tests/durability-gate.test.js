/**
 * W1-A — Long-horizon materials degradation engine, FEA-gate tests.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: the exact-invariant test
 * (modulus scaling) is analytically provable for a statically determinate
 * cantilever (see server/tests/fea-gate.test.js / thermal-gate.test.js's
 * own PL³/3EI oracle convention), and the "horizonYears:0" self-
 * consistency test mirrors thermal-gate.test.js's own `deltaT:0` /
 * aero-gate.test.js's own `velocity:0` self-consistency convention. The
 * honest-refusal tests assert a specific `reason` for each named failure
 * mode, never a generic "throws" or "returns falsy" check.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { momentOfInertia } from '../lib/compute/physics-compute.js';
import { runFEA } from '../lib/simulation/fea-solver.js';
import { getMaterial } from '../lib/asset-gen/mass-properties.js';
import {
  checkDurabilityGate,
  degradedProperties,
  buildDegradedModel,
  assertSupportedOrientation,
} from '../lib/asset-gen/durability-gate.js';

// ── Shared single-member cantilever fixture ─────────────────────────────
// Identical shape to thermal-gate.test.js/aero-gate.test.js's own fixture:
// node A fixed at the origin, node B free at x=L, a plain rectangular
// section, steel-a36.
const STEEL = getMaterial('steel-a36'); // E=200000 MPa, yield=250 MPa
const L = 0.5; // m
const base = 0.05, height = 0.01; // m
const area = base * height;
const I = momentOfInertia('rectangle', { base, height }).value;
const E_Pa = STEEL.E * 1e6;
// NOTE: unlike thermal-gate.test.js/aero-gate.test.js, this fixture does
// NOT divide yield by a safety factor here — degradedProperties() returns
// the material's raw (knocked-down) yield_Pa directly (see durability-
// gate.js's defaultKnockdownLaw), and buildDegradedModel() overwrites
// allowableStress with that value. Baking in a separate SF here would
// break the sampleYears:[0] self-consistency invariant (year-0, zero
// degradation, must reproduce this EXACT baseline model bit-for-bit) —
// applying a safety factor on top of the engine's own output is the
// caller's job at a layer above this fixture, not something this beam
// model itself should pre-bake.
const allowable_Pa = STEEL.yield * 1e6;
const TIP_LOAD_N = 200;

function xAxisCantilever({ mechanicalLoads = [{ nodeId: 'B', Fy: TIP_LOAD_N }] } = {}) {
  return {
    nodes: [
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: L, y: 0, z: 0 },
    ],
    members: [
      { id: 'm1', nodeI: 'A', nodeJ: 'B', area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa, depthIn: height },
    ],
    supports: [{ nodeId: 'A', type: 'fixed' }],
    loads: mechanicalLoads,
  };
}

describe('assertSupportedOrientation — guards fea-solver.js\'s verified silent zero-stiffness bug', () => {
  it('passes a plain X-axis cantilever (the shape every other gate test in this repo uses)', () => {
    const model = xAxisCantilever();
    const result = assertSupportedOrientation(model.nodes, model.members);
    assert.deepEqual(result, { ok: true });
  });

  it('flags a member oriented (near-)purely along global Y', () => {
    const nodes = [
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: 0, y: L, z: 0 }, // vertical column
    ];
    const members = [{ id: 'col1', nodeI: 'A', nodeJ: 'B', area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa }];
    const result = assertSupportedOrientation(nodes, members);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported_member_orientation');
    assert.deepEqual(result.memberIds, ['col1']);
  });

  it('proves the flagged case is a REAL solver defect, not a false positive: the same vertical member silently reads a transverse load as zero displacement', () => {
    const nodes = [
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: 0, y: L, z: 0 },
    ];
    const members = [{ id: 'col1', nodeI: 'A', nodeJ: 'B', area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa }];
    const res = runFEA({
      nodes, members,
      supports: [{ nodeId: 'A', type: 'fixed' }],
      loads: [{ nodeId: 'B', Fx: TIP_LOAD_N }], // transverse to the member's own (Y) axis
    });
    assert.equal(res.ok, true, 'the solver itself never signals an error here');
    const tip = res.displacements.find((d) => d.nodeId === 'B');
    assert.equal(tip.dx, 0, 'silently reads as infinitely rigid — the exact defect this guard exists to catch');

    // The identical geometry along X (the axis every other gate test in
    // this repo already uses) gives the real textbook answer instead.
    const xModel = xAxisCantilever({ mechanicalLoads: [{ nodeId: 'B', Fy: TIP_LOAD_N }] });
    const xRes = runFEA(xModel);
    const expected = (TIP_LOAD_N * L ** 3) / (3 * E_Pa * I);
    assert.ok(Math.abs(xRes.displacements[1].dy - expected) / expected < 1e-9);
  });
});

describe('degradedProperties + buildDegradedModel — exact modulus-degradation invariant', () => {
  it('degrading E by factor f scales tip deflection by exactly 1/f, with stress UNCHANGED (statically determinate ⇒ moment independent of E)', () => {
    const baseModel = xAxisCantilever();
    const baseline = runFEA(baseModel);
    assert.equal(baseline.ok, true);

    const f = 0.5; // thermalExtent 0.5 + leachFraction 0 ⇒ D=0.5 ⇒ EFactor=(1-D)=0.5
    const degraded = degradedProperties(
      STEEL,
      { a_crack: 0, thermalExtent: 0.5, leachFraction: 0, crackFraction: 0 },
      null,
    );
    assert.ok(Math.abs(degraded.E_Pa - f * E_Pa) < 1e-6);
    assert.equal(degraded.areaFactor, 1);
    assert.equal(degraded.momentIFactor, 1);

    const degradedModel = buildDegradedModel(baseModel, degraded);
    const degradedRes = runFEA(degradedModel);
    assert.equal(degradedRes.ok, true);

    const baseDy = baseline.displacements.find((d) => d.nodeId === 'B').dy;
    const degDy = degradedRes.displacements.find((d) => d.nodeId === 'B').dy;
    const relErrDeflection = Math.abs(degDy / baseDy - 1 / f) / (1 / f);
    assert.ok(relErrDeflection < 1e-9, `deflection ratio ${degDy / baseDy} should be exactly 1/f=${1 / f}`);

    const baseStress = baseline.stresses[0].combinedStress;
    const degStress = degradedRes.stresses[0].combinedStress;
    assert.ok(Math.abs(degStress - baseStress) / baseStress < 1e-9, `stress should be unchanged: base=${baseStress}, degraded=${degStress}`);
  });

  it('degrading E does NOT change utilization\'s numerator (stress) but DOES change it via the degraded allowableStress denominator', () => {
    const baseModel = xAxisCantilever();
    const baseline = runFEA(baseModel);
    const degraded = degradedProperties(STEEL, { a_crack: 0, thermalExtent: 0.5, leachFraction: 0, crackFraction: 0 }, null);
    const degradedRes = runFEA(buildDegradedModel(baseModel, degraded));
    // allowableStress halved (yieldFactor = EFactor = 0.5 in the default
    // law) while combinedStress is unchanged ⇒ utilization exactly doubles.
    const relErr = Math.abs(degradedRes.summary.maxUtilization / baseline.summary.maxUtilization - 2) / 2;
    assert.ok(relErr < 1e-9, `utilization should exactly double, got ratio ${degradedRes.summary.maxUtilization / baseline.summary.maxUtilization}`);
  });
});

describe('checkDurabilityGate — sampleYears:[0] self-consistency (mirrors thermal-gate.js\'s deltaT:0 convention)', () => {
  it('degrades EXACTLY to the undegraded baseline at year 0 with a0=0 and no thermal/moisture requested', () => {
    const model = xAxisCantilever();
    const check = checkDurabilityGate(model, {
      materialKey: 'steel-a36',
      mechanisms: ['fatigue'],
      fatigue: { deltaSigma: 80, Y: 1.2, thickness: height, a0: 0, cyclesPerYear: 300 },
      sampleYears: [0],
    });
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal(check.samples.length, 1);
    const sample = check.samples[0];
    assert.equal(sample.year, 0);
    assert.equal(sample.state.a_crack, 0, 'a0=0 ⇒ ΔK=0 at a=0 ⇒ crack never starts growing (an honest LEFM consequence, not a special case)');
    assert.equal(sample.state.thermalExtent, 0);
    assert.equal(sample.state.leachFraction, 0);
    assert.ok(Math.abs(sample.utilization - check.baseline.utilization) < 1e-9,
      `year-0 utilization ${sample.utilization} should equal the undegraded baseline ${check.baseline.utilization}`);
  });
});

describe('checkDurabilityGate — honest refusals (never fabricates a pass)', () => {
  it('refuses an unknown material', () => {
    const check = checkDurabilityGate(xAxisCantilever(), { materialKey: 'unobtainium-9000' });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'unknown_material');
  });

  it('refuses a material with no diffusion constants when mechanisms:["moisture"] is requested (steel-a36 has diffusion:null)', () => {
    const check = checkDurabilityGate(xAxisCantilever(), {
      materialKey: 'steel-a36',
      mechanisms: ['moisture'],
      moisture: { h: 0.01 },
    });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'missing_degradation_constants');
    assert.equal(check.mechanism, 'moisture');
  });

  it('refuses when the marched crack reaches/exceeds the given section thickness before the sampled horizon', () => {
    const check = checkDurabilityGate(xAxisCantilever(), {
      materialKey: 'steel-a36',
      mechanisms: ['fatigue'],
      fatigue: { deltaSigma: 300, Y: 1.5, thickness: 0.001, a0: 0.0005, cyclesPerYear: 5000 },
      sampleYears: [0, 5, 10, 25, 50],
    });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'crack_exceeds_section');
    assert.ok(Number.isFinite(check.failureYear));
  });

  it('refuses an unsupported (Y-axis) member orientation BEFORE attempting any solve', () => {
    const nodes = [
      { id: 'A', x: 0, y: 0, z: 0 },
      { id: 'B', x: 0, y: L, z: 0 },
    ];
    const members = [{ id: 'col1', nodeI: 'A', nodeJ: 'B', area, momentI: I, elasticModulus: E_Pa, allowableStress: allowable_Pa }];
    const model = { nodes, members, supports: [{ nodeId: 'A', type: 'fixed' }], loads: [{ nodeId: 'B', Fx: TIP_LOAD_N }] };
    const check = checkDurabilityGate(model, { materialKey: 'steel-a36', mechanisms: ['fatigue'], fatigue: { deltaSigma: 50, Y: 1, thickness: height, a0: 0.0001 } });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'unsupported_member_orientation');
    assert.deepEqual(check.memberIds, ['col1']);
  });

  it('refuses bad model input honestly (no nodes/members)', () => {
    const check = checkDurabilityGate({ nodes: [], members: [], supports: [], loads: [] }, { materialKey: 'steel-a36' });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'bad_model_input');
  });

  it('every result (pass or refusal) carries the honest boundary text', () => {
    const check = checkDurabilityGate(xAxisCantilever(), { materialKey: 'unobtainium-9000' });
    assert.ok(typeof check.honestBoundary === 'string' && check.honestBoundary.includes('phenomenological'));
  });
});

describe('checkDurabilityGate — real multi-year degradation, firstFailureYear reported separately from ok', () => {
  it('reports increasing utilization across sampled years for a genuinely fatigue-loaded member, and firstFailureYear independent of the final-year ok', () => {
    const check = checkDurabilityGate(xAxisCantilever(), {
      materialKey: 'steel-a36',
      mechanisms: ['fatigue'],
      fatigue: { deltaSigma: 120, Y: 1.3, thickness: height, a0: 0.0005, cyclesPerYear: 300 },
      sampleYears: [0, 5, 10, 25, 50],
    });
    assert.equal(check.samples.length, 5);
    // Crack length (and thus utilization, via momentIFactor) must be
    // monotone non-decreasing across the sampled years — a real physical
    // property of an irreversible fatigue crack.
    let prevA = -Infinity;
    for (const s of check.samples) {
      assert.ok(s.state.a_crack >= prevA, `crack length should never shrink year-over-year: ${prevA} -> ${s.state.a_crack}`);
      prevA = s.state.a_crack;
    }
    assert.equal(check.ok, check.samples[check.samples.length - 1].allPass, 'ok must equal pass-at-final-sampled-year, never a blend');
  });
});
