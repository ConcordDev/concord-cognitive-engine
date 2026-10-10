// tests/nlp-design-intent.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseDesignIntent,
  intentToPartMeshParams,
  intentToFeaModel,
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
});
