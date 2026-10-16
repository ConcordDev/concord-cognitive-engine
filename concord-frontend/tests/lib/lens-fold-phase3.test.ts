import { describe, expect, it } from 'vitest';
import { LENS_REGISTRY, getAbsorbedLenses, getLensById } from '@/lib/lens-registry';
import { TAB_LABEL_REDIRECTS, redirectsForTabLabels } from '@/lib/lens-tab-redirects';
import { getDestinationById } from '@/lib/destinations';

// Phase 3 folds that use the existing mechanisms (PHASE3-DECISIONS.md).
describe('phase 3 lens folds', () => {
  it('folds cognition into graph and code-quality into code', () => {
    for (const [id, core, label] of [['cognition', 'graph', 'Cognition'], ['code-quality', 'code', 'Quality']] as const) {
      const lens = getLensById(id);
      expect(lens?.coreLens).toBe(core);
      expect(lens?.tabLabel).toBe(label);
      expect(lens?.showInSidebar).toBe(false);
      expect(getAbsorbedLenses(core).map((l) => l.id)).toContain(id);
    }
  });

  it('adds destination members', () => {
    const want: Record<string, string[]> = {
      analytics: ['neuro'], marketplace: ['questmarket'], lab: ['telecommunications'],
      trades: ['home-improvement', 'diy'], creator: ['maker'],
    };
    for (const [dest, ids] of Object.entries(want)) {
      for (const id of ids) expect(getDestinationById(dest)?.absorbs, `${dest}/${id}`).toContain(id);
    }
    expect(getDestinationById('analytics')?.absorbs).not.toContain('attention');
  });

  it('keeps the redirect table locked to the registry, including /lenses/quality', () => {
    expect(TAB_LABEL_REDIRECTS).toEqual(redirectsForTabLabels(LENS_REGISTRY));
    expect(TAB_LABEL_REDIRECTS).toContainEqual({ source: '/lenses/quality', destination: '/lenses/code-quality' });
  });
});
