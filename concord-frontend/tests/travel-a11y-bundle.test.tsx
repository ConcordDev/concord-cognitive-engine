/**
 * FIX-travel-005 — the Travel lens's Lighthouse a11y bundle:
 * contrast + touch targets (expected a11y >= 95).
 *
 * All 15 selects named (11 by this fix; TravelActionPanel's four
 * were already named and are floored here) and floored. Headings
 * priced per composition: the reference tab stacks TripPlanner
 * (h2, stands) over Zippopotam and Parks — sibling panels, so their
 * titles are h2; the tools tab's ActionPanel title is h2; inside
 * My Trips, the TripsSection h2 stands, the workspace section's h3
 * is the list-view title, and TripWorkspace's own h3 + h4 tab
 * sections are valid in the workspace view (the list title is not
 * rendered in that state), including the GmailSync and TripMenu h4s
 * mounted inside it. Dim text raised; small icon buttons floored.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { parks: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { ParksPanel } from '@/components/travel/ParksPanel';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

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

describe('FIX-travel-005 — travel a11y bundle', () => {
  it('ParksPanel: the state select is named and floored; the panel title is h2', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ParksPanel />
      </QueryClientProvider>,
    );
    const sel = await screen.findByLabelText('State');
    expect(sel.className).toContain('min-h-11');
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('source sweep: every travel select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'travel')).filter((x) => x.endsWith('.tsx') && !x.includes('.test.')).map((x) => `components/travel/${x}`),
      'app/lenses/travel/page.tsx',
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
        expect(tag.includes('min-h-11'), `${f}: select without the target floor`).toBe(true);
        i = j + tag.length;
      }
    }
    expect(count).toBe(15);
  });
});
