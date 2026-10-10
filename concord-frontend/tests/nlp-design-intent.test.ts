// tests/nlp-design-intent.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseDesignIntent,
  intentToPartMeshParams,
  intentToFeaModel,
  forceToNewtons,
  DesignIntentSchema,
} from '@/lib/conkay/nlp-design-intent';

describe('parseDesignIntent (ConKay NLP CAD v1)', () => {
  it('parses simply supported steel I-beam 6m, 5kN midspan', () => {
    const r = parseDesignIntent('simply supported steel I-beam 6m, 5kN midspan');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.part).toBe('i-beam');
    expect(r.intent.meshKind).toBe('i-beam');
    expect(r.intent.spans[0]).toBe(6);
    expect(r.intent.material).toBe('steel');
    expect(r.intent.support).toBe('simply-supported');
    expect(r.intent.units).toBe('m');
    expect(r.intent.loads.length).toBeGreaterThanOrEqual(1);
    expect(r.intent.loads[0].location).toBe('midspan');
    expect(r.intent.loads[0].forceN).toBe(-5000);
    expect(DesignIntentSchema.safeParse(r.intent).success).toBe(true);
  });

  it('parses box and cylinder with span', () => {
    const box = parseDesignIntent('steel box 2m long');
    expect(box.ok).toBe(true);
    if (box.ok) {
      expect(box.intent.meshKind).toBe('box');
      expect(box.intent.spans[0]).toBe(2);
    }
    const cyl = parseDesignIntent('aluminum cylinder length 1.5 metres');
    expect(cyl.ok).toBe(true);
    if (cyl.ok) {
      expect(cyl.intent.meshKind).toBe('cylinder');
      expect(cyl.intent.spans[0]).toBe(1.5);
      expect(cyl.intent.material).toBe('aluminum');
    }
  });

  it('fails closed on empty / unsupported / no span', () => {
    expect(parseDesignIntent('').ok).toBe(false);
    expect(parseDesignIntent('make me a spaceship').ok).toBe(false);
    expect(parseDesignIntent('steel I-beam please').ok).toBe(false); // no span
  });

  it('intentToPartMeshParams / intentToFeaModel are deterministic', () => {
    const r = parseDesignIntent('simply supported steel I-beam 6m, 5kN midspan');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pm = intentToPartMeshParams(r.intent);
    expect(pm.kind).toBe('i-beam');
    expect(pm.params.length).toBe(6);
    const fea = intentToFeaModel(r.intent);
    expect(fea.nodes).toHaveLength(9);
    expect(fea.loads[0].Fy).toBe(-5000);
    expect(fea.loads[0].nodeId).toBe('N4');
    expect(fea.nodes[8].x).toBe(6);
    const root = fea.supports[0].fixedDOF as string[];
    const far = fea.supports[1].fixedDOF as string[];
    expect(root).not.toContain('rz');
    expect(far).not.toContain('x');
    expect(fea.members[0].area).not.toBe(0.01);
    expect(fea.members[0].momentI).not.toBe(1e-5);
  });

  it('converts 200 kg on a bracket and flags the defaults', () => {
    const r = parseDesignIntent('design a steel bracket that holds 200 kg');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.part).toBe('bracket');
    expect(r.intent.support).toBe('cantilever');
    expect(r.intent.spans[0]).toBe(0.12);
    expect(r.intent.loads[0].forceN).toBeCloseTo(-200 * 9.80665, 6);
    expect(r.intent.loads[0].forceN).not.toBe(-5000);
    expect(r.intent.assumed).toMatchObject({ load: false, span: true, section: true, material: false, support: false });
    const fea = intentToFeaModel(r.intent);
    expect(fea.loads[0].nodeId).toBe('N8');
    expect(fea.loads[0].Fy).toBeCloseTo(-200 * 9.80665, 6);
    expect(fea.supports).toHaveLength(1);
    const mesh = intentToPartMeshParams(r.intent);
    expect(mesh.kind).toBe('box');
    expect(mesh.params.length).toBe(0.12);
    expect(mesh.params.height).toBe(0.008);
  });

  it('names bracket in the unsupported-part error', () => {
    const r = parseDesignIntent('make me a spaceship');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.supportedParts).toContain('bracket');
  });

  it('converts the other force units and ignores a zero load', () => {
    expect(forceToNewtons(2, 'kN')).toBe(2000);
    expect(forceToNewtons(1, 'MN')).toBe(1e6);
    expect(forceToNewtons(1, 'kip')).toBeCloseTo(4448.2216, 3);
    expect(forceToNewtons(10, 'lbf')).toBeCloseTo(10 * 0.45359237 * 9.80665, 4);
    expect(forceToNewtons(10, 'lb')).toBeCloseTo(10 * 0.45359237 * 9.80665, 4);
    expect(forceToNewtons(1, 'pound')).toBeCloseTo(0.45359237 * 9.80665, 4);
    expect(forceToNewtons(1, 'tonne')).toBeCloseTo(1000 * 9.80665, 3);
    expect(forceToNewtons(2, 't')).toBeCloseTo(2000 * 9.80665, 3);
    expect(forceToNewtons(500, 'N')).toBe(500);
    expect(forceToNewtons(Number.NaN, 'N')).toBeNull();

    const zero = parseDesignIntent('steel beam 4 m with 0 N');
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.intent.assumed.load).toBe(true);
    expect(zero.intent.loads).toHaveLength(0);
  });

  it('reads labelled section sizes, feet, and a bare span', () => {
    const beam = parseDesignIntent(
      'fixed ends steel I-beam 12 ft flange width 120 mm depth 250 mm flange thickness 16 mm web thickness 10 mm, 2 kip at the end',
    );
    expect(beam.ok).toBe(true);
    if (!beam.ok) return;
    expect(beam.intent.units).toBe('ft');
    expect(beam.intent.spans[0]).toBeCloseTo(12 * 0.3048, 5);
    expect(beam.intent.support).toBe('fixed');
    expect(beam.intent.assumed.section).toBe(false);
    expect(beam.intent.assumed.support).toBe(false);
    expect(beam.intent.section).toMatchObject({
      flangeWidth: 0.12,
      height: 0.25,
      flangeThickness: 0.016,
      webThickness: 0.01,
    });
    expect(beam.intent.loads[0].location).toBe('end');
    const fea = intentToFeaModel(beam.intent);
    expect(fea.supports).toHaveLength(2);
    expect(fea.loads[0].nodeId).toBe('N8');
    expect(fea.loads[0].Fy).toBeCloseTo(-2 * 4448.2216, 2);

    const bare = parseDesignIntent('wood beam span 4');
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.intent.spans[0]).toBe(4);
    expect(bare.intent.material).toBe('wood');
    expect(bare.intent.assumptions.some((a) => /40 MPa/.test(a))).toBe(true);

    const concrete = parseDesignIntent('concrete box 200 cm long, 80 mm wide, 120 mm tall, 1 tonne');
    expect(concrete.ok).toBe(true);
    if (!concrete.ok) return;
    expect(concrete.intent.material).toBe('concrete');
    expect(concrete.intent.spans[0]).toBeCloseTo(2, 5);
    expect(concrete.intent.section).toMatchObject({ width: 0.08, height: 0.12 });
    expect(concrete.intent.assumed.section).toBe(false);
    expect(concrete.intent.loads[0].forceN).toBeCloseTo(-1000 * 9.80665, 3);
    expect(intentToPartMeshParams(concrete.intent).kind).toBe('box');
  });

  it('derives cylinder, tube and sphere sections and places a midspan cantilever load', () => {
    const cyl = parseDesignIntent('aluminum cylinder diameter 80 mm length 1.5 m, 500 N at the tip');
    expect(cyl.ok).toBe(true);
    if (!cyl.ok) return;
    expect(cyl.intent.section).toMatchObject({ kind: 'cylinder', radius: 0.04 });
    expect(cyl.intent.assumed.section).toBe(false);
    expect(cyl.intent.loads[0].location).toBe('end');
    expect(intentToPartMeshParams(cyl.intent)).toMatchObject({ kind: 'cylinder', params: { radius: 0.04 } });

    const tube = parseDesignIntent('steel tube 2 m long');
    expect(tube.ok).toBe(true);
    if (!tube.ok) return;
    expect(tube.intent.section.kind).toBe('tube');
    expect(tube.intent.assumed.section).toBe(true);
    expect(intentToPartMeshParams(tube.intent).kind).toBe('tube');

    const sphere = parseDesignIntent('steel sphere 0.4 m, 1 kN');
    expect(sphere.ok).toBe(true);
    if (!sphere.ok) return;
    expect(sphere.intent.meshKind).toBe('sphere');
    expect(sphere.intent.assumed.section).toBe(true);
    expect(String(sphere.intent.assumptions.join(' '))).toMatch(/solid round bar/);
    expect(intentToPartMeshParams(sphere.intent).kind).toBe('sphere');

    const mid = parseDesignIntent('cantilever steel beam 30 m, 5 kN midspan');
    expect(mid.ok).toBe(true);
    if (!mid.ok) return;
    expect(mid.intent.support).toBe('cantilever');
    expect(mid.intent.loads[0].location).toBe('midspan');
    expect(intentToFeaModel(mid.intent).loads[0].nodeId).toBe('N4');
    expect(intentToPartMeshParams(mid.intent).params.length).toBe(20);

    const unknown = parseDesignIntent('beam 4000 mm');
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    expect(unknown.intent.material).toBe('unknown');
    expect(unknown.intent.assumed.material).toBe(true);
    expect(unknown.intent.units).toBe('mm');
    expect(unknown.intent.spans[0]).toBe(4);
  });

  it('reads a bracket thickness written after the number', () => {
    const r = parseDesignIntent('steel bracket arm 150 mm, 80 mm wide, 10 mm thick, leg 100 mm, holds 50 kg');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent.spans[0]).toBeCloseTo(0.15, 5);
    expect(r.intent.section).toMatchObject({ width: 0.08, thickness: 0.01, legHeight: 0.1 });
    expect(r.intent.assumed.section).toBe(false);
    expect(r.intent.assumed.span).toBe(false);
    const mesh = intentToPartMeshParams(r.intent);
    expect(mesh.params).toMatchObject({ length: 0.15, width: 0.08, height: 0.01, legHeight: 0.1 });
  });

  it('rejects a length that is not a real span', () => {
    expect(parseDesignIntent('steel beam 600 m').ok).toBe(false);
  });
});
