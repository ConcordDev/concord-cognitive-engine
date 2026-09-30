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
    expect(fea.nodes).toHaveLength(3);
    expect(fea.loads[0].Fy).toBe(-5000);
    expect(fea.nodes[2].x).toBe(6);
  });
});
