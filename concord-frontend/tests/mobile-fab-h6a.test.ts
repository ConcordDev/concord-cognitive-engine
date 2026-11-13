/**
 * H6a — hand-rolled lens FABs clear the 390px bottom nav and Help launcher,
 * and hand-rolled view strips neither show a native bar nor squeeze labels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FAB_PAGES = ['affect', 'cri', 'docs', 'inference', 'message', 'commonsense', 'dtus', 'metalearning'];
const STRIP_PAGES = ['affect', 'cri', 'docs', 'inference', 'metalearning'];
const src = (l: string) => readFileSync(resolve(__dirname, `../app/lenses/${l}/page.tsx`), 'utf8');

describe('H6a mobile FAB + strips', () => {
  it.each(FAB_PAGES)('%s FAB sits above the bottom nav, left of Help', (l) => {
    const s = src(l);
    expect(s).toContain('fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-[4.75rem]');
    expect(s).not.toMatch(/fixed bottom-8 right-8 z-30/);
  });

  it.each(STRIP_PAGES)('%s view strip scrolls without a bar and tabs do not shrink', (l) => {
    const s = src(l);
    expect(s).toMatch(/overflow-x-auto no-scrollbar/);
    expect(s).toMatch(/inline-flex shrink-0 items-center gap-2 whitespace-nowrap/);
  });
});
