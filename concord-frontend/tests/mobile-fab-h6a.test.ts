/**
 * H6a — hand-rolled lens FABs clear the 390px bottom nav and Help launcher,
 * and hand-rolled view strips neither show a native bar nor squeeze labels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FAB_PAGES = ['affect', 'cri', 'docs', 'inference', 'message', 'commonsense', 'dtus', 'metalearning', 'attention', 'daily', 'feed', 'hypothesis', 'metacognition', 'reflection', 'thread'];
const STRIP_PAGES = ['affect', 'cri', 'docs', 'inference', 'metalearning', 'attention', 'daily', 'feed', 'hypothesis', 'metacognition', 'reflection', 'thread'];
const src = (l: string) => readFileSync(resolve(__dirname, `../app/lenses/${l}/page.tsx`), 'utf8');

describe('H6a/H6b mobile FAB + strips', () => {
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

describe('H6b Daily calendar sidebar stacks on phones', () => {
  it('sidebar is full width below md and beside the journal from md up', () => {
    const s = readFileSync(resolve(__dirname, '../components/daily/DailyTodayPanel.tsx'), 'utf8');
    expect(s).toContain('flex flex-col md:flex-row');
    expect(s).toContain('w-full border-b border-lattice-border bg-lattice-surface/40 flex flex-col shrink-0 md:w-72 md:border-b-0 md:border-r');
  });
});
