import { describe, expect, it } from 'vitest';
import {
  calendarDateKey,
  coerceDateKey,
  formatDateKey,
  profileTimeZone,
  resolveCalendarTimeZone,
  shiftDateKey,
} from '@/lib/calendar-date';

const SATURDAY_EVENING_ET = new Date('2026-10-11T01:58:00.000Z');

describe('calendarDateKey', () => {
  it('names the America/New_York calendar day at 9:58pm Saturday, not the UTC day', () => {
    expect(calendarDateKey(SATURDAY_EVENING_ET, 'America/New_York')).toBe('2026-10-10');
    expect(calendarDateKey(SATURDAY_EVENING_ET, 'UTC')).toBe('2026-10-11');
  });

  it('shifts and formats calendar keys without reparsing them as UTC midnights', () => {
    expect(shiftDateKey('2026-10-10', -1)).toBe('2026-10-09');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(formatDateKey('2026-10-10')).toBe('Saturday, October 10');
    expect(formatDateKey('2026-10-10', { year: true })).toBe('Saturday, October 10, 2026');
    expect(coerceDateKey('2026-10-11')).toBe('2026-10-11');
    expect(coerceDateKey('2026-10-11T01:58:00.000Z', 'America/New_York')).toBe('2026-10-10');
  });

  it('prefers a valid profile timezone over the browser zone', () => {
    expect(profileTimeZone({ timezone: 'America/Chicago' })).toBe('America/Chicago');
    expect(profileTimeZone({ preferences: { timeZone: 'Europe/London' } })).toBe('Europe/London');
    expect(profileTimeZone({})).toBeNull();
    expect(resolveCalendarTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveCalendarTimeZone('Not/AZone')).not.toBe('Not/AZone');
  });
});
