import { describe, expect, it } from 'vitest';
import { datetimeLocalValue } from '@/lib/datetime-local';

describe('datetime-local year', () => {
  it('keeps a 4-digit year and drops the concatenated 52026 year', () => {
    expect(datetimeLocalValue('2026-11-11T03:18')).toBe('2026-11-11T03:18');
    expect(datetimeLocalValue('2026-11-11T11:10:00')).toBe('2026-11-11T11:10');
    expect(datetimeLocalValue('52026-11-11T11:10')).toBeNull();
    expect(datetimeLocalValue('11/11/52026')).toBeNull();
  });
});
