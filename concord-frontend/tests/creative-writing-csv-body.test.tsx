// Behavior test for FIX-creative-writing-007: the per-page CSV export
// must include the body, at parity with the JSON export (which is
// project-get's result verbatim). Before the fix both CSV shapes —
// the scene list and the single project row — dropped the prose, so
// a CSV of a page lost the writing itself.
import { describe, it, expect } from 'vitest';
import { buildPageCsv } from '@/app/lenses/creative-writing/page';

describe('creative-writing page CSV (FIX-creative-writing-007)', () => {
  it('project-row CSV carries the manuscript body (the qa5 case)', () => {
    const csv = buildPageCsv({
      project: { id: 'pg1', title: 'qa5', genre: 'test', targetWords: 100, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T01:00:00.000Z', body: 'qa5 test.' },
      wordCount: 2,
    } as never);
    const [header, row] = csv.split('\n');
    expect(header.split(',')).toContain('body');
    expect(row).toContain('qa5 test.');
    expect(row).toContain('qa5');
  });

  it('scene CSV carries each scene body, quoting multiline prose', () => {
    const csv = buildPageCsv({
      project: { id: 'pg1', title: 'Novel' },
      scenes: [
        { id: 'sc1', title: 'Opening', chapterId: 'ch1', order: 1, wordCount: 4, status: 'draft', body: 'Line one.\nLine two, with comma.' },
        { id: 'sc2', title: 'Close', chapterId: 'ch1', order: 2, wordCount: 1, status: 'final', body: 'Fin.' },
      ],
      wordCount: 5,
    } as never);
    const header = csv.split('\n')[0];
    expect(header.split(',')).toContain('body');
    expect(csv).toContain('"Line one.\nLine two, with comma."');
    expect(csv).toContain('Fin.');
  });

  it('a page with no body yet still exports an empty body cell, not a missing column', () => {
    const csv = buildPageCsv({ project: { id: 'pg2', title: 'Blank' }, wordCount: 0 } as never);
    const [header, row] = csv.split('\n');
    expect(header.endsWith(',body')).toBe(true);
    expect(row.endsWith(',')).toBe(true);
  });
});
