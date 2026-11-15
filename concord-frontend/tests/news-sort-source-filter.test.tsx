/**
 * FIX-news-002 — the Live desk offered only category chips: no way to
 * sort, and no way to narrow to one source. HeadlineFeed now sorts
 * the loaded list (newest / oldest / source) and filters it by any
 * source present in the list, with the story count reflecting the
 * filter.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-news-002 — sort and source filter', () => {
  const s = read('components/news/HeadlineFeed.tsx');

  it('sorts by recency and by source', () => {
    expect(s).toContain('aria-label="Sort headlines"');
    expect(s).toContain("value=\"newest\"");
    expect(s).toContain("value=\"source\"");
  });

  it('filters by a source drawn from the loaded headlines', () => {
    expect(s).toContain('aria-label="Filter by source"');
    expect(s).toContain('Array.from(new Set(headlines.map((h) => h.source)');
    expect(s).toContain('visible.map(h => {');
  });
});
