/**
 * FIX-calendar-003 — the week view's day header + all-day rows sat OUTSIDE
 * the timed grid's scroll container, so the scrollbar gutter shifted the
 * timed columns against them and all-day chips landed between day columns.
 * Pin the structure: one scroll container, header + all-day inside a sticky
 * wrapper within it, no nested scroller in the week view.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'components/calendar/CalendarGridWorkbench.tsx'), 'utf8');
const week = src.slice(src.indexOf('const renderWeekView'), src.indexOf('const renderDayView'));

describe('FIX-calendar-003 — week view column alignment structure', () => {
  it('the week root is the single scroll container', () => {
    expect(week).toContain('className="relative flex-1 overflow-y-auto"');
  });
  it('header + all-day rows sit in one sticky wrapper inside the scroller', () => {
    const stickyAt = week.indexOf('sticky top-0 z-20 bg-lattice-deep');
    const headerAt = week.indexOf('DAY_NAMES[i]');
    const allDayAt = week.indexOf('All day');
    expect(stickyAt).toBeGreaterThan(-1);
    expect(headerAt).toBeGreaterThan(stickyAt);
    expect(allDayAt).toBeGreaterThan(stickyAt);
  });
  it('no second nested scroller remains in the week view', () => {
    expect(week.match(/overflow-y-auto/g)).toHaveLength(1);
  });
});
