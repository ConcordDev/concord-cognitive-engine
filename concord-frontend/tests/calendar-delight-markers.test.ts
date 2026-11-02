import { describe, expect, it } from 'vitest';
import { isLeapFebruary, seasonMarkerFor } from '@/components/calendar/CalendarGridWorkbench';

// §3b real-date awareness: markers are facts, so the table is finite —
// a wrong date is worse than no marker.
describe('seasonMarkerFor', () => {
  it('marks the 2026 solstices and equinoxes', () => {
    expect(seasonMarkerFor(new Date(2026, 2, 20))).toBe('Spring equinox');
    expect(seasonMarkerFor(new Date(2026, 5, 21))).toBe('Summer solstice');
    expect(seasonMarkerFor(new Date(2026, 8, 22))).toBe('Autumn equinox');
    expect(seasonMarkerFor(new Date(2026, 11, 21))).toBe('Winter solstice');
  });

  it('marks leap day only when Feb 29 exists', () => {
    expect(seasonMarkerFor(new Date(2028, 1, 29))).toBe('Leap day');
    // 2026 has no Feb 29 — the Date rolls to Mar 1 and earns no marker.
    expect(seasonMarkerFor(new Date(2026, 1, 29))).toBeNull();
  });

  it('stays silent on ordinary days and outside the table years', () => {
    expect(seasonMarkerFor(new Date(2026, 0, 15))).toBeNull();
    expect(seasonMarkerFor(new Date(2031, 5, 21))).toBeNull();
  });
});

describe('isLeapFebruary', () => {
  it('is true only for February of a leap year', () => {
    expect(isLeapFebruary(new Date(2028, 1, 10))).toBe(true);
    expect(isLeapFebruary(new Date(2026, 1, 10))).toBe(false);
    expect(isLeapFebruary(new Date(2028, 2, 10))).toBe(false);
  });
});
