/**
 * search-result-state-genus.test.ts — CB-0468 guard (B6).
 *
 * When a search or filter narrows a list, the surface's empty states,
 * badges, stat cards, and errors must say so. Each pin holds one surface
 * to naming its narrowed state instead of announcing an empty register,
 * sitting blank, or presenting filtered sums as totals.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0468 search/filter result-state genus', () => {
  it('FIX-nonprofit-008: 990 search renders a no-match state and a failure state', () => {
    const src = read('components/nonprofit/PropublicaSearch.tsx');
    expect(src).toContain('No nonprofits match');
    expect(src).toContain('searchError');
    expect(src).toContain('searched');
  });

  it('FIX-materials-010: a filtered-empty library names the query/filter, not an empty register', () => {
    const src = read('components/materials/MaterialsLibraryPanel.tsx');
    expect(src).toContain('items match');
    expect(src).toContain('Clear search & filter');
    expect(src).toContain('in the library.');
  });

  it('FIX-history-002: a completed zero-hit Wikipedia search says no-match', () => {
    const src = read('components/history/WikipediaExplorer.tsx');
    expect(src).toContain('No Wikipedia articles match');
    expect(src).toContain('lastQuery');
  });

  it('FIX-retail-009: the dormant filter requires a past order (never-ordered is New)', () => {
    const src = read('components/retail/CustomersPanel.tsx');
    expect(src).toContain("if (activeSegment === 'dormant') return !!c.lastOrderAt &&");
    expect(src).not.toContain("if (activeSegment === 'dormant') return !c.lastOrderAt");
  });

  it('FIX-bounties-006: stat cards label the scope of the sums they show', () => {
    const src = read('app/lenses/bounties/page.tsx');
    expect(src).toContain('statsScope');
    expect(src).toContain("'current filter'");
    expect(src).toContain("'all bounties'");
  });

  it('FIX-literary-002: the search field caps at the API query limit (200) with a counter', () => {
    const src = read('components/literary/SearchPanel.tsx');
    expect(src).toContain('maxLength={200}');
    expect(src).toContain('{query.length}/200');
  });
});
