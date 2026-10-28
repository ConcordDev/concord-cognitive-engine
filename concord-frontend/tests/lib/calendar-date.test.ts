import { describe, expect, it } from 'vitest';
import {
  calendarDateKey,
  coerceDateKey,
  formatDateKey,
  fromZonedInputValue,
  profileTimeZone,
  resolveCalendarTimeZone,
  shiftDateKey,
  toZonedInputValue,
  zoneAbbrev,
  zonedWallTimeToUtc,
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

describe('zoned wall time ⇄ instant (S1)', () => {
  it('converts wall time in a zone to the true instant, on both sides of DST', () => {
    // 2:00 PM in New York: 18:00Z under EDT, 19:00Z under EST.
    expect(zonedWallTimeToUtc('America/New_York', { year: 2026, month: 10, day: 28, hour: 14, minute: 0 }).toISOString())
      .toBe('2026-10-28T18:00:00.000Z');
    expect(zonedWallTimeToUtc('America/New_York', { year: 2026, month: 11, day: 4, hour: 14, minute: 0 }).toISOString())
      .toBe('2026-11-04T19:00:00.000Z');
  });

  it('round-trips a datetime-local value in the event zone', () => {
    const instant = new Date('2026-10-28T18:00:00.000Z');
    expect(toZonedInputValue(instant, 'America/New_York')).toBe('2026-10-28T14:00');
    expect(fromZonedInputValue('2026-10-28T14:00', 'America/New_York')?.toISOString()).toBe('2026-10-28T18:00:00.000Z');
    expect(toZonedInputValue(instant, 'UTC')).toBe('2026-10-28T18:00');
    expect(fromZonedInputValue('', 'UTC')).toBeNull();
    expect(fromZonedInputValue('not-a-date', 'UTC')).toBeNull();
  });

  it('names the zone abbreviation for the detail whisper', () => {
    expect(zoneAbbrev('America/New_York', new Date('2026-10-28T18:00:00.000Z'))).toBe('EDT');
    expect(zoneAbbrev('America/New_York', new Date('2026-11-04T19:00:00.000Z'))).toBe('EST');
  });
});
