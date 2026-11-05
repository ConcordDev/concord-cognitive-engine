import { describe, expect, it } from 'vitest';
import { mixSharePct } from './EiaPanel';

describe('mixSharePct', () => {
  it('reads the handler field sharePct and ignores a sibling named pct', () => {
    expect(mixSharePct({ fuel: 'Natural Gas', sharePct: 37.5, pct: 0 })).toBe(37.5);
  });

  it('does not treat a missing share as zero', () => {
    expect(mixSharePct({ fuel: 'Coal' })).toBeNull();
    expect(mixSharePct({ fuel: 'Coal', sharePct: undefined })).toBeNull();
  });

  it('keeps an explicit zero', () => {
    expect(mixSharePct({ fuel: 'Solar', sharePct: 0 })).toBe(0);
  });
});
