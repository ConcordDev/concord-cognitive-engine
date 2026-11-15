/**
 * FIX-linguistics-003 — the Linguistics lens's Lighthouse a11y bundle:
 * unlabeled selects, contrast, touch targets. (The bundle's Tab leg
 * is the app-shell skip-link rider, credited not re-fixed.)
 *
 * Heading order, verified against the page's composition — one body
 * panel per view under the page h1:
 * - Notebook: the two stat panels open at h2; form/list titles h3;
 *   the detail title is h2 with h3 subsections.
 * - Lookup: Datamuse + Dictionary titles h2, the Word-lookup wrapper
 *   h2, WordLookup's own header h3, entry words h4.
 * - Learning: the five tool titles are h2 siblings.
 * - Workbench: the wrapper title is h2, the action panel's h3.
 * All 6 selects are pinned (4 named by this fix, QuizEngine's two by
 * their wrapping labels).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { DatamusePanel } from '@/components/linguistics/DatamusePanel';

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

describe('FIX-linguistics-003 — linguistics a11y bundle', () => {
  it('DatamusePanel: title is h2 and the relationship-kind select is named', async () => {
    render(<DatamusePanel domain="linguistics" />);
    expect(await screen.findByLabelText('Relationship type')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Datamuse');
  });

  it('heading structure per view matches the composed sequence', () => {
    expect(read('components/linguistics/NotebookPanel.tsx')).toContain('Languages Studied');
    expect(read('components/linguistics/NotebookPanel.tsx').match(/<h2[^>]*>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read('components/linguistics/DictionaryPanel.tsx')).toContain('<h2');
    expect(read('components/linguistics/LookupToolsPanel.tsx')).toContain('<h2');
    expect(read('components/linguistics/WordLookup.tsx')).toContain('<h3 className="text-sm font-semibold text-white">Word Lookup</h3>');
    for (const f of ['QuizEngine.tsx', 'VocabularyBuilder.tsx', 'WordDecks.tsx', 'ProgressDashboard.tsx', 'WordTools.tsx']) {
      expect(read(`components/linguistics/${f}`), f).toContain('<h2');
    }
    expect(read('components/linguistics/WorkbenchPanel.tsx')).toContain('<h2');
  });

  it('source sweep: every linguistics select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'linguistics')).filter((x) => x.endsWith('.tsx')).map((x) => `components/linguistics/${x}`),
      'app/lenses/linguistics/page.tsx',
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
    expect(count).toBe(6);
  });
});
