/**
 * FIX-desert-003 — the Desert lens's Lighthouse a11y bundle:
 * contrast, touch targets, heading order. (The bundle's Tab-order
 * leg is app-shell chrome, not lens code — it rides the shell
 * mechanism and is filed as a rider in the fix record.)
 *
 * Verified counts in this tree: 9 selects — 4 already named
 * (Incident category/severity + Wildlife confidence by aria-label,
 * FieldCalc soil by its wrapping label), 5 named by this fix.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { nodes: [], byKind: {}, kits: [], items: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { ResourceNodeMap } from '@/components/desert/ResourceNodeMap';
import { SurvivalKit } from '@/components/desert/SurvivalKit';

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

describe('FIX-desert-003 — desert a11y bundle', () => {
  it('ResourceNodeMap: title is h2 and the node form selects are named', async () => {
    render(<ResourceNodeMap />);
    expect(await screen.findByLabelText('Node kind')).toBeTruthy();
    expect(screen.getByLabelText('Reliability')).toBeTruthy();
    expect(screen.getByLabelText('Severity')).toBeTruthy();
    const headings = screen.getAllByRole('heading');
    expect(headings[0].tagName).toBe('H2');
  });

  it('SurvivalKit: panel title is h2', async () => {
    render(<SurvivalKit />);
    const headings = await screen.findAllByRole('heading');
    expect(headings[0].tagName).toBe('H2');
  });

  it('source sweep: every desert select is named and floored; no h4 remains', () => {
    const root = path.join(process.cwd(), 'components', 'desert');
    for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        const tag = openingTag(src, j);
        const pre = src.slice(0, j);
        const wrapped = pre.lastIndexOf('<label') > pre.lastIndexOf('</label>');
        expect(
          tag.includes('aria-label') || wrapped,
          `${f}: select without a name`,
        ).toBe(true);
        expect(tag, `${f}: select without the target floor`).toContain('min-h-11');
        i = j + tag.length;
      }
      expect(src.includes('<h4'), `${f}: h4 remains`).toBe(false);
      expect(src.includes('text-zinc-500'), `${f}: zinc-500 text remains`).toBe(false);
    }
  });
});
