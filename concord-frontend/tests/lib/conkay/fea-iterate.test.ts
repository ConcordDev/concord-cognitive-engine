// Phase S3-c — the FEA re-solve spine. Pins that an utterance maps to a real
// model transform (member section / applied load), that ambiguous/empty input
// is an honest STOP-POINT, and that the transform is pure (scales the real
// stiffness/force fields, preserves everything else, mutates nothing). The new
// utilization is deliberately NOT predicted here — that's the solver's job on
// re-run; this only produces the input to feed it.
import { describe, it, expect } from 'vitest';
import {
  parseFeaIntent,
  applyFeaModelDelta,
  feaModelFromInput,
  proposeFeaIteration,
  describeFeaDelta,
  type FeaModel,
} from '@/lib/conkay/fea-iterate';

const MODEL: FeaModel = {
  nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }, { id: 'n2', x: 0, y: 3, z: 0 }],
  members: [{ id: 'm1', nodeI: 'n1', nodeJ: 'n2', area: 0.01, momentI: 0.0002, elasticModulus: 2e11 }],
  loads: [{ nodeId: 'n2', Fx: 5000, Fy: -20000, Fz: 0 }],
  supports: [{ nodeId: 'n1', fixed: true }],
};

describe('parseFeaIntent — utterance → model delta', () => {
  it('section strengthen keywords → section up', () => {
    for (const u of ['make the members thicker', 'reinforce the columns', 'stronger beams', 'make them stiffer']) {
      expect(parseFeaIntent(u)).toMatchObject({ target: 'section', direction: 'up' });
    }
  });
  it('load keywords → load up/down', () => {
    expect(parseFeaIntent('add more load')).toMatchObject({ target: 'load', direction: 'up' });
    expect(parseFeaIntent('reduce the load')).toMatchObject({ target: 'load', direction: 'down' });
  });
  it('explicit percent uses the direction', () => {
    expect(parseFeaIntent('reduce the load 30%')).toMatchObject({ target: 'load', direction: 'down', factor: 0.7 });
    expect(parseFeaIntent('increase the load by 50%')).toMatchObject({ target: 'load', factor: 1.5 });
  });
  it('bare noun + inherent-direction magnitude resolves ("double the load")', () => {
    expect(parseFeaIntent('double the load')).toMatchObject({ target: 'load', direction: 'up', factor: 2 });
    expect(parseFeaIntent('halve the members')).toMatchObject({ target: 'section', direction: 'down', factor: 0.5 });
  });
  it('STOP-POINT: no intent, or a directionally-ambiguous noun, → null', () => {
    expect(parseFeaIntent('hello there')).toBeNull();
    expect(parseFeaIntent('make it blue')).toBeNull();
    expect(parseFeaIntent('the load')).toBeNull(); // noun but no direction/magnitude
    expect(parseFeaIntent('')).toBeNull();
  });
});

describe('applyFeaModelDelta — pure model transform', () => {
  it('section scales member area + momentI, preserves other fields, no mutation', () => {
    const d = parseFeaIntent('make the members thicker')!; // factor 1.6
    const next = applyFeaModelDelta(MODEL, d);
    expect(next.members[0].area).toBeCloseTo(0.016, 9);
    expect(next.members[0].momentI).toBeCloseTo(0.00032, 9);
    expect(next.members[0].elasticModulus).toBe(2e11); // untouched
    expect(next.nodes).toEqual(MODEL.nodes);
    expect(MODEL.members[0].area).toBe(0.01); // original not mutated
  });
  it('load scales Fx/Fy/Fz', () => {
    const d = parseFeaIntent('double the load')!; // factor 2
    const next = applyFeaModelDelta(MODEL, d);
    expect(next.loads[0]).toMatchObject({ Fx: 10000, Fy: -40000, Fz: 0 });
    expect(next.members).toEqual(MODEL.members); // section untouched
  });
});

describe('feaModelFromInput — safe model extraction', () => {
  it('reads {model} and flat forms; null when no nodes/members', () => {
    expect(feaModelFromInput({ model: MODEL })?.members).toHaveLength(1);
    expect(feaModelFromInput(MODEL)?.nodes).toHaveLength(2);
    expect(feaModelFromInput({ nodes: [], members: [] })).toBeNull();
    expect(feaModelFromInput(null)).toBeNull();
  });
});

describe('proposeFeaIteration — reviewable re-solve or honest rejection', () => {
  it('valid → new {model} input (does NOT predict the result)', () => {
    const p = proposeFeaIteration({ model: MODEL }, 'make the members thicker');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.newInput.model.members[0].area).toBeCloseTo(0.016, 9);
    expect(p.summary).toMatch(/thicken/i);
  });
  it('no intent → rejection; no model → rejection', () => {
    expect(proposeFeaIteration({ model: MODEL }, 'hello')).toMatchObject({ ok: false, reason: 'no_intent' });
    expect(proposeFeaIteration({}, 'make it thicker')).toMatchObject({ ok: false, reason: 'no_model' });
  });
});

describe('describeFeaDelta — confirm-gate intent summary', () => {
  it('states the intent as a percent change', () => {
    expect(describeFeaDelta({ target: 'section', direction: 'up', factor: 1.6, rawUtterance: '' })).toMatch(/thicken all members 60%/);
    expect(describeFeaDelta({ target: 'load', direction: 'down', factor: 0.7, rawUtterance: '' })).toMatch(/reduce all loads 30%/);
  });
});
