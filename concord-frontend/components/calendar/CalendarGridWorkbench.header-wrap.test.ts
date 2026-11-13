// FIX-calendar-016: the workbench header was one non-wrapping flex row —
// at 390px the view-switch cluster (Calendars + Day/Week/Month/Agenda)
// crushed the title block until the status note wrapped word-by-word into
// a narrow column. Source-pin: the header and both right-hand clusters
// wrap, and the side padding steps down on phones.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'CalendarGridWorkbench.tsx'), 'utf8');

describe('Calendar header at phone width (FIX-calendar-016)', () => {
  it('the header row wraps and steps its padding down', () => {
    expect(SRC).toContain('flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pt-4 pb-5 sm:px-8');
  });

  it('the switch clusters wrap instead of crushing the status note', () => {
    expect(SRC).toContain('flex flex-wrap items-center gap-x-5 gap-y-2 pb-1');
    expect(SRC).toContain('flex flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-5');
  });
});
