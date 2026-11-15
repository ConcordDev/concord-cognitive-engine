/**
 * FIX-platform-008 — the Platform lens's Lighthouse bundle:
 * unlabeled selects, contrast, touch targets. (The bundle's Tab leg
 * stands closed by the shared shell skip-link fix, credited in the
 * fix record, not re-fixed here.)
 *
 * All 14 selects are pinned: 11 named by this fix, 3 already named
 * by wrapping labels in PlatformConsole; the Console's selects share
 * its `input` class const, which carries the target floor for every
 * console control. Heading order verified against composition —
 * panel h2s with h3 subsections; ScopeControls' h4 DTU-card titles
 * sit in a list under its h3 distribution section (h2→h3→h4, valid).
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

import { PlatformRepos } from '@/components/platform/PlatformRepos';

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

describe('FIX-platform-008 — platform a11y bundle', () => {
  it('PlatformRepos: the topic select is named and floored', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PlatformRepos />
      </QueryClientProvider>,
    );
    const sel = await screen.findByLabelText('Topic');
    expect(sel.className).toContain('min-h-11');
  });

  it('PlatformConsole: rule-form selects named; the shared input class carries the floor', () => {
    const src = read('components/platform/PlatformConsole.tsx');
    for (const lab of ['Channel kind', 'Metric', 'Operator', 'Severity', 'Channel']) {
      expect(src).toContain(`aria-label="${lab}"`);
    }
    expect(src).toContain("const input = 'input-lattice min-h-11");
  });

  it('source sweep: every platform select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'platform')).filter((x) => x.endsWith('.tsx')).map((x) => `components/platform/${x}`),
      'app/lenses/platform/page.tsx',
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
        const floored = tag.includes('min-h-11') || (f.includes('PlatformConsole') && tag.includes('className={input}'));
        expect(floored, `${f}: select without the target floor`).toBe(true);
        i = j + tag.length;
      }
    }
    expect(count).toBe(14);
  });
});
