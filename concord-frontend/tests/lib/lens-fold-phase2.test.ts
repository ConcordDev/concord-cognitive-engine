import { describe, expect, it } from 'vitest';
import { LENS_REGISTRY, getAbsorbedLenses, getLensById } from '@/lib/lens-registry';
import { TAB_LABEL_REDIRECTS, redirectsForTabLabels } from '@/lib/lens-tab-redirects';
import { getDestinationById } from '@/lib/destinations';

// Phase 2 lens folds (PHASE2-DECISIONS.md): three lenses fold into core lens
// hosts as sub-tabs, two lenses fold into destination absorbs lists.

const CORE_FOLDS: { id: string; coreLens: 'graph' | 'code' | 'board'; tabLabel: string }[] = [
  { id: 'lattice', coreLens: 'graph', tabLabel: 'Lattice' },
  { id: 'legacy', coreLens: 'code', tabLabel: 'Legacy' },
  { id: 'strategic-adds', coreLens: 'board', tabLabel: 'Next Bets' },
];

describe('Phase 2 lens folds', () => {
  it('folds lattice, legacy and strategic-adds into core lenses as hidden sub-tabs', () => {
    for (const fold of CORE_FOLDS) {
      const lens = getLensById(fold.id);
      expect(lens, `registry entry for ${fold.id}`).toBeDefined();
      expect(lens?.coreLens, `${fold.id}.coreLens`).toBe(fold.coreLens);
      expect(lens?.tabLabel, `${fold.id}.tabLabel`).toBe(fold.tabLabel);
      expect(lens?.showInSidebar, `${fold.id}.showInSidebar`).toBe(false);
      expect(
        getAbsorbedLenses(fold.coreLens).some((l) => l.id === fold.id),
        `getAbsorbedLenses('${fold.coreLens}') includes ${fold.id}`,
      ).toBe(true);
    }
  });

  it('folds translation into the Research destination and desert into the Lab destination', () => {
    expect(getDestinationById('research')?.absorbs).toContain('translation');
    expect(getDestinationById('lab')?.absorbs).toContain('desert');
  });

  it('keeps TAB_LABEL_REDIRECTS equal to redirectsForTabLabels(LENS_REGISTRY)', () => {
    expect(TAB_LABEL_REDIRECTS).toEqual(redirectsForTabLabels(LENS_REGISTRY));
    expect(TAB_LABEL_REDIRECTS).toEqual(expect.arrayContaining([
      { source: '/lenses/next-bets', destination: '/lenses/strategic-adds' },
    ]));
    const sources = TAB_LABEL_REDIRECTS.map((r) => r.source);
    // Lattice and Legacy slug to their own paths, so they need no alias.
    expect(sources).not.toContain('/lenses/lattice');
    expect(sources).not.toContain('/lenses/legacy');
  });
});