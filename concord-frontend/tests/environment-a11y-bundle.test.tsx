/**
 * FIX-environment-007 — the Environment lens's Lighthouse a11y bundle:
 * unlabeled form elements, contrast, heading order. (The bundle's
 * WebGL GPU-stall warnings concern the map canvas, not markup —
 * filed as a rider in the fix record.)
 *
 * All 44 selects in the tree are pinned by the brace-aware sweep:
 * each carries an accessible name (aria-label taken from the field's
 * own adjacent label text where one exists) and the min-h-11 floor.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { activities: [], factors: [] } } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { EmissionsActivitiesPanel } from '@/components/environment/EmissionsActivitiesPanel';

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

describe('FIX-environment-007 — environment a11y bundle', () => {
  it('EmissionsActivitiesPanel: the scope filter and factor selects are named', async () => {
    render(<EmissionsActivitiesPanel />);
    expect(await screen.findByLabelText('Filter by scope')).toBeTruthy();
    expect(screen.getByLabelText('Emission factor')).toBeTruthy();
  });

  it('source sweep: all 44 selects named + floored; no h3 titles remain', () => {
    const root = path.join(process.cwd(), 'components', 'environment');
    let count = 0;
    for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
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
      expect(src.includes('<h3'), `${f}: h3 title remains`).toBe(false);
    }
    expect(count).toBe(44);
  });
});
