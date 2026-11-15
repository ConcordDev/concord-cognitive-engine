/**
 * FIX-marketplace-003 + FIX-marketplace-005.
 * 003: the browse query keyed on the raw search string — a request
 * pair per keystroke. The query now reads a 300 ms debounce while
 * the client-side filter keeps the raw string (instant narrowing).
 * 005: the browse query's two independent reads ran sequentially,
 * so skeletons lasted their sum — they now run in parallel; and a
 * failed seller-listings load says so with a retry instead of
 * falling through to an empty table.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-marketplace-003 — debounced browse search', () => {
  const s = read('components/marketplace/MarketplaceProvider.tsx');
  it('debounces the query search, keeps raw search for the client filter', () => {
    expect(s).toContain('setDebouncedSearch(search), 300');
    expect(s).toContain("queryKey: ['marketplace-browse', category, debouncedSearch]");
    expect(s).toContain('search: debouncedSearch || undefined');
    expect(s).toContain('const q = search.toLowerCase();');
  });
});

describe('FIX-marketplace-005 — listings load behaviour', () => {
  const p = read('components/marketplace/MarketplaceProvider.tsx');
  const l = read('components/marketplace/ListingsPanel.tsx');
  it('browse reads run in parallel', () => {
    expect(p).toContain('Promise.all([');
    expect(p).toContain('const [res, plugins] = await Promise.all');
  });
  it('a failed listings load surfaces an error with retry', () => {
    expect(l).toContain('setLoadError(');
    expect(l).toContain('Retry loading listings');
    expect(l).not.toContain("catch (e) { console.error('[Listings] failed', e); }");
  });
});
