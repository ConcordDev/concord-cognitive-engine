/**
 * FIX-paper-007 — the Paper lens's Lighthouse a11y bundle (score 82):
 * unnamed buttons, unlabeled selects, undersized touch targets.
 *
 * The ticket's measured targets — rating stars ~12px, trash ~12,
 * dialog/sub-buttons ~28, chips 24–28 — are pinned here at the
 * min-h-11 floor; the stars were also the tree's only truly unnamed
 * buttons (the trash/Add/close buttons already carried aria-labels
 * and are floored, not renamed). Heading order verified against the
 * page's composition: one tab panel per view under the page h1, each
 * panel's title at h2 (Library/Workbench/Discover/Editor) with the
 * sub-panels at h3 — no change needed. EditorPanel's h1–h6 sequence
 * is its markdown content renderer (a paper's own headings), not the
 * lens outline, and is deliberately untouched.
 * All 10 selects are pinned (6 named by this fix).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LIBP = { id: 'lp1', title: 'Library paper', authors: ['L. Author'], year: 2023, venue: 'Conf', abstract: 'Lib abstract', doi: '10.1/z', url: 'https://x/z', status: 'to-read', rating: 4, tags: ['nlp'], notes: 'n', collectionIds: [] as string[] };

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_d: string, action: string) => {
    if (action === 'paper-list') return { data: { ok: true, result: { papers: [LIBP] } } };
    if (action === 'collection-list') return { data: { ok: true, result: { collections: [] } } };
    if (action === 'library-dashboard') return { data: { ok: true, result: { totalPapers: 1, toRead: 1, reading: 0, read: 0, collections: 0 } } };
    return { data: { ok: true, result: {} } };
  }),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), isCreating: false }),
}));

import { PaperLibrary } from '@/components/paper/PaperLibrary';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Opening tag of the element at `start`, skipping '>' inside { }. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, k + 1);
  }
  return src.slice(start);
}

describe('FIX-paper-007 — paper a11y bundle', () => {
  it('PaperLibrary card: stars are named + floored, status select named, delete floored', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PaperLibrary />
      </QueryClientProvider>,
    );
    const star = await screen.findByLabelText('Rate 3 of 5');
    expect(star.className).toContain('min-h-11');
    expect(screen.getByLabelText('Rate 5 of 5')).toBeTruthy();
    expect(screen.getByLabelText('Status for Library paper')).toBeTruthy();
    expect(screen.getByLabelText('Delete').className).toContain('min-h-11');
  });

  it('source sweep: every paper select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'paper')).filter((x) => x.endsWith('.tsx')).map((x) => `components/paper/${x}`),
      'app/lenses/paper/page.tsx',
    ];
    let count = 0;
    for (const f of files) {
      const src = read(f);
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        count++;
        const tag = openingTag(src, j);
        const pre = src.slice(0, j);
        const wrapped = pre.lastIndexOf('<label') > pre.lastIndexOf('</label>');
        expect(tag.includes('aria-label') || wrapped, `${f}: select without a name`).toBe(true);
        expect(tag, `${f}: select without the target floor`).toContain('min-h-11');
        i = j + tag.length;
      }
    }
    expect(count).toBe(10);
  });

  it('the measured small targets carry the floor in source', () => {
    const lib = read('components/paper/PaperLibrary.tsx');
    expect(lib).toContain('aria-label={`Rate ${n} of 5`}');
    expect(lib).toContain("cn('min-h-11 px-2 py-0.5 text-[11px] rounded'");
    const wb = read('components/paper/PaperWorkbench.tsx');
    expect(wb).toContain('aria-label="Paper to add"');
    expect(wb).toContain('min-w-11');
  });
});
