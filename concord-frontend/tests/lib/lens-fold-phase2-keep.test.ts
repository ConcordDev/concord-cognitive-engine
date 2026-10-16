import { describe, expect, it } from 'vitest';
import { latticeKeptRecord } from '@/components/lattice/latticeKeep';
import { legacyKeptRecord } from '@/components/legacy/legacyKeep';
import { translationKeptRecord } from '@/components/translation/translationKeep';
import { desertKeptRecord } from '@/components/desert/desertKeep';

// One test per Phase 2 Keep builder: null on empty input, real fields on a
// real result the page already loaded. No rendering — these are pure
// functions over the panel's own data.

describe('Phase 2 keep builders', () => {
  it('latticeKeptRecord keeps the consent-corpus snapshot and refuses an empty corpus', () => {
    const kept = latticeKeptRecord({
      ok: true,
      tables: [{ name: 'dtus', regime: 'user_opt_in', total: 10, consented: 4, ratio: 0.4 }],
      totals: { total: 10, consented: 4, ratio: 0.4 },
    });
    expect(kept?.title).toBe('Consent corpus snapshot');
    expect(kept?.body).toContain('Total rows: 10');
    expect(kept?.body).toContain('dtus (user_opt_in): 10 total, 4 consented, 40.0%');
    expect(kept?.tags).toContain('lattice');
    expect(kept?.source).toBe('lattice-lens:corpus-stats');
    expect(kept?.createdFrom).toBe('lattice');
    expect(latticeKeptRecord(null)).toBeNull();
    expect(
      latticeKeptRecord({ ok: true, tables: [], totals: { total: 0, consented: 0, ratio: 0 } }),
    ).toBeNull();
  });

  it('legacyKeptRecord keeps a portfolio-assessment summary and refuses a failed or empty one', () => {
    const kept = legacyKeptRecord({
      kind: 'debt',
      summary: { avgDebtScore: 42, criticalModules: 2, highDebtModules: 1 },
    });
    expect(kept?.title).toBe('Technical debt');
    expect(kept?.body).toContain('avgDebtScore: 42');
    expect(kept?.body).toContain('criticalModules: 2');
    expect(kept?.tags).toContain('legacy');
    expect(kept?.source).toBe('legacy-lens:assessment-summary');
    expect(kept?.createdFrom).toBe('legacy');
    expect(legacyKeptRecord(null)).toBeNull();
    expect(legacyKeptRecord({ kind: 'debt', summary: {} })).toBeNull();
    expect(
      legacyKeptRecord({ kind: 'debt', error: 'legacy_unavailable', summary: { avgDebtScore: 1 } }),
    ).toBeNull();
  });


  it('translationKeptRecord keeps the translated text and refuses an empty translation', () => {
    const kept = translationKeptRecord({
      source: 'auto',
      target: 'es',
      formality: 'neutral',
      input: 'Good morning',
      output: 'Buenos días',
    });
    expect(kept?.title).toBe('Buenos días');
    expect(kept?.body).toContain('auto → es');
    expect(kept?.body).toContain('Good morning');
    expect(kept?.body).toContain('Buenos días');
    expect(kept?.tags).toContain('translation');
    expect(kept?.source).toBe('translation-lens:translation');
    expect(kept?.createdFrom).toBe('translation');
    expect(translationKeptRecord(null)).toBeNull();
    expect(translationKeptRecord({ source: 'auto', target: 'es', input: 'Good morning', output: '' })).toBeNull();
  });

  it('desertKeptRecord keeps the computed expedition plan and refuses an uncomputed one', () => {
    const kept = desertKeptRecord({
      name: 'Dune crossing',
      totals: {
        teamSize: 2, distanceKm: 12, travelHours: 5, travelDays: 1,
        waterLiters: 24, waterLitersPerPerson: 12, foodKg: 4,
      },
      legs: [
        { index: 0, from: 'Base camp', to: 'Dune ridge', terrain: 'sand', distanceKm: 12, travelHours: 5, waterLiters: 24, foodKg: 4 },
      ],
    });
    expect(kept?.title).toBe('Dune crossing');
    expect(kept?.body).toContain('Distance: 12 km');
    expect(kept?.body).toContain('Base camp → Dune ridge');
    expect(kept?.tags).toContain('desert');
    expect(kept?.source).toBe('desert-lens:route-plan');
    expect(kept?.createdFrom).toBe('desert');
    expect(desertKeptRecord(null)).toBeNull();
    expect(desertKeptRecord({ name: '', totals: null, legs: [] })).toBeNull();
  });
});