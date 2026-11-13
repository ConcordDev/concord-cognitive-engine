/**
 * FIX-global-011 — the Global lens's Lighthouse a11y bundle:
 * unlabeled selects, contrast, heading order.
 *
 * Heading order, verified against the page's composition: the frame
 * h1 → WorldBankPanel's panel title (h2; it mounts before the tab
 * sections) → tab h2s → DataExplorer's h3s under the Explorer h2.
 * All 6 selects in the tree are pinned (5 named by this fix,
 * CountryPicker by its wrapping label).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { points: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorldBankPanel } from '@/components/global/WorldBankPanel';
import { CountryAtlas } from '@/components/global/CountryAtlas';

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

describe('FIX-global-011 — global a11y bundle', () => {
  it('WorldBankPanel: title is h2 and both selects are named', async () => {
    render(<WorldBankPanel domain="global" />);
    expect(await screen.findByLabelText('Country')).toBeTruthy();
    expect(screen.getByLabelText('Indicator')).toBeTruthy();
    const headings = screen.getAllByRole('heading');
    expect(headings[0].tagName).toBe('H2');
  });

  it('CountryAtlas: the region select is named', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CountryAtlas />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('Region')).toBeTruthy();
  });

  it('source sweep: every global select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'global')).filter((x) => x.endsWith('.tsx')).map((x) => `components/global/${x}`),
      'app/lenses/global/page.tsx',
    ];
    let count = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
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
    expect(count).toBe(6);
  });
});
