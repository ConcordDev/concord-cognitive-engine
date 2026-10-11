import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildConkayExport,
  conkayExportCsv,
  designTypeName,
  getConkayCurrentModel,
  nextModelName,
  preferredModelName,
  setConkayCurrentModel,
} from '@/lib/conkay/model-export';

beforeEach(() => setConkayCurrentModel(null));

describe('ConKay model names', () => {
  it('defaults from the design type — a bracket is not a beam', () => {
    expect(designTypeName('i-beam')).toBe('I-beam');
    expect(designTypeName('beam')).toBe('Beam');
    expect(designTypeName('box')).toBe('Bracket');
    expect(designTypeName('bracket')).toBe('Bracket');
    expect(preferredModelName('I-beam study', 'box')).toBe('Bracket');
    expect(preferredModelName('Gantry', 'i-beam')).toBe('Gantry');
  });

  it('suffixes a name that is already saved', () => {
    expect(nextModelName('I-beam', [])).toBe('I-beam');
    expect(nextModelName('I-beam', ['I-beam'])).toBe('I-beam 2');
    expect(nextModelName('I-beam', ['I-beam', 'I-beam 2'])).toBe('I-beam 3');
    expect(nextModelName('I-beam study', ['I-beam study'])).toBe('I-beam study 2');
  });
});

describe('ConKay export document', () => {
  it('is a non-empty JSON document containing the saved part and the current model', () => {
    const current = {
      name: 'I-beam',
      kind: 'i-beam',
      designType: 'i-beam',
      material: 'steel-a992',
      params: { length: 1.2, webThickness: 0.009 },
      results: {
        maxStressMPa: 86.1,
        maxDeflectionMm: 0.344,
        utilization: 0.249,
        safetyFactor: 4,
        pass: true,
        jobId: 'sim_1',
        elapsedMs: 12,
        handCheck: { agrees: true },
      },
      solverVersion: 'fea-solver@5.0.0',
    };
    setConkayCurrentModel(current);
    const doc = buildConkayExport({
      parts: [{ id: 'part_1', ...current, name: 'I-beam' }],
      current: getConkayCurrentModel(),
    });
    const raw = JSON.stringify(doc);
    expect(raw.length).toBeGreaterThan(2);
    const parsed = JSON.parse(raw);
    expect(parsed.savedModels[0]).toMatchObject({
      id: 'part_1',
      params: { length: 1.2 },
      results: { maxStressMPa: 86.1 },
      solverVersion: 'fea-solver@5.0.0',
    });
    expect(parsed.currentModel.solverVersion).toBe('fea-solver@5.0.0');
    expect(conkayExportCsv(doc)).toContain('part_1');
    expect(conkayExportCsv(doc)).toContain('fea-solver@5.0.0');
  });
});
