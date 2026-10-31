// S12 (Review 5 F13) — dates and day counts compute in the user's
// timezone. daysUntil counts whole calendar days between the user's
// today and the target day; a date-only string names a calendar day
// in the user's zone. These assertions hold in any timezone, which is
// the point: the old 24-hour-quotient version changed its answer with
// the time of day and the zone offset.
import { describe, it, expect } from 'vitest';
import { daysUntil, localDayKey } from '@/components/goals/goals-model';

describe('goals timezone helpers (S12)', () => {
  it('localDayKey formats the local calendar day', () => {
    expect(localDayKey(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(2026, 0, 5, 23, 59); // local components
    expect(localDayKey(d)).toBe('2026-01-05');
  });

  it('daysUntil counts calendar days from the user today', () => {
    const today = new Date();
    expect(daysUntil(localDayKey(today))).toBe(0);
    const plus1 = new Date(today); plus1.setDate(plus1.getDate() + 1);
    expect(daysUntil(localDayKey(plus1))).toBe(1);
    const plus2 = new Date(today); plus2.setDate(plus2.getDate() + 2);
    expect(daysUntil(localDayKey(plus2))).toBe(2);
  });

  it('a past date floors at 0 and garbage is 0', () => {
    const past = new Date(); past.setDate(past.getDate() - 3);
    expect(daysUntil(localDayKey(past))).toBe(0);
    expect(daysUntil('not-a-date')).toBe(0);
  });
});
