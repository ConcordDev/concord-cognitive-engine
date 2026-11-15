/**
 * FIX-philosophy-002 — the Philosophy lens's Lighthouse a11y bundle:
 * contrast and touch targets. (The bundle's Tab leg is the app-shell
 * skip-link rider.) The walk's run named only contrast + targets,
 * but the curation/channel forms carry 8 unlabeled selects that a
 * run with those forms open would flag — all are named here from
 * their form semantics, so the ticket's "no a11y failures" holds.
 *
 * Heading order, verified against the page's composition: one view
 * per tab under the page h1 — Dilemma / Idea Channels / Curation
 * Studio titles are h2 with their detail titles at h3; the Feed
 * title was already h2.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { PhiloFeed } from '@/components/philosophy/PhiloFeed';

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

describe('FIX-philosophy-002 — philosophy a11y bundle', () => {
  it('PhiloFeed: h2 title and the tag filter is named', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PhiloFeed />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('Filter by tag')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('view titles are h2 and detail titles h3 in source', () => {
    expect(read('components/philosophy/DilemmaPanel.tsx')).toContain('<h2');
    expect(read('components/philosophy/PhilosophyChannels.tsx')).toContain('<h2');
    expect(read('components/philosophy/PhilosophyChannels.tsx')).toContain('<h3');
    expect(read('components/philosophy/PhilosophyCuration.tsx')).toContain('<h2');
    expect(read('components/philosophy/PhilosophyCuration.tsx')).toContain('aria-label="Channel for the image block"');
    expect(read('components/philosophy/PhilosophyCuration.tsx')).toContain('aria-label="Stance"');
  });

  it('source sweep: every philosophy select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'philosophy')).filter((x) => x.endsWith('.tsx')).map((x) => `components/philosophy/${x}`),
      'app/lenses/philosophy/page.tsx',
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
    expect(count).toBe(8);
  });
});
