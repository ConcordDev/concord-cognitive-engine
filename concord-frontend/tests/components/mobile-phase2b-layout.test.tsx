/**
 * Mobile phase 2b (390px sweep, GB-0453): stat grids drop to 1-2 columns on a
 * phone and the lab tab rows scroll horizontally instead of wrapping/clipping.
 * jsdom has no layout, so this pins the responsive classes: the base (mobile)
 * class set must be narrow, with the wide layout behind a breakpoint prefix.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn().mockResolvedValue({ data: { ok: true, result: { items: [], labs: [] } } }),
}));
vi.mock('qrcode', () => ({ toDataURL: vi.fn() }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { ELNWorkbench } from '@/components/lab/ELNWorkbench';

const root = path.resolve(__dirname, '../..');
const src = (p: string) => readFileSync(path.join(root, p), 'utf8');

/** Base (un-prefixed) grid-cols token on the line containing `anchor`. */
function gridLine(file: string, anchor: string): string {
  const line = src(file).split('\n').find((l) => l.includes(anchor));
  expect(line, `${anchor} in ${file}`).toBeTruthy();
  return line as string;
}
const baseCols = (line: string) => (line.match(/(?:^|[\s"'`])grid-cols-(\d)/) || [])[1];

describe('stat grids are 1-2 columns at phone width', () => {
  const cases: Array<[string, string, string]> = [
    ['components/forum/ForumSection.tsx', "'grid grid-cols-", '2'],
    ['app/lenses/training-room/page.tsx', 'grid grid-cols-2 sm:grid-cols-3 gap-2 text-center', '2'],
    ['app/lenses/lab/page.tsx', 'grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs', '2'],
    ['components/engineering/MultiPhysicsPanel.tsx', 'mt-3 grid grid-cols-2 sm:grid-cols-3', '2'],
  ];
  for (const [file, anchor, cols] of cases) {
    it(`${file}: base grid-cols-${cols}`, () => {
      const text = src(file);
      expect(text).toContain(anchor);
      // No un-prefixed 3-column stat grid is left on the stat rows we touched.
      const line = gridLine(file, anchor);
      expect(baseCols(line)).toBe(cols);
    });
  }

  it('wide layouts are preserved behind a breakpoint', () => {
    expect(src('components/forum/ForumSection.tsx')).toContain("'sm:grid-cols-7' : 'sm:grid-cols-6'");
  });
});

describe('lab / engineering headers', () => {
  it('ELNWorkbench tab row scrolls horizontally and tabs do not shrink or wrap', async () => {
    render(<ELNWorkbench />);
    const first = (await screen.findAllByRole('button')).find((b) => b.className.includes('shrink-0'));
    expect(first).toBeTruthy();
    expect(first!.className).toContain('whitespace-nowrap');
    const row = first!.parentElement!;
    expect(row.className).toContain('overflow-x-auto');
    expect(row.className).toContain('flex-nowrap');
    expect(row.className).not.toContain('flex-wrap');
  });

  it('LabOrgPanel tab row is a horizontal scroller', () => {
    const line = src('components/lab/LabOrgPanel.tsx').split('\n').find((l) => l.includes('overflow-x-auto'));
    expect(line).toContain('max-w-full');
    expect(line).toContain('[&>button]:shrink-0');
  });

  it('Engineering bench header wraps and hides the long badge on phones', () => {
    const text = src('components/engineering/EngineeringActionPanel.tsx');
    expect(text).toContain('<header className="flex flex-wrap items-center gap-2');
    expect(text).toMatch(/className="hidden [^"]*sm:inline">tolerance/);
  });
});
