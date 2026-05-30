import { describe, it, expect } from 'vitest';
import { isDoubleTap, DOUBLE_TAP_MS, DASH_KEYS } from '@/lib/concordia/dash-input';

describe('B1b — double-tap dash detection (pure)', () => {
  it('a single tap is not a dash; a quick second tap of the SAME key is', () => {
    const mem = { key: '', t: 0 };
    expect(isDoubleTap(mem, 'w', 1000)).toBe(false); // first tap
    expect(isDoubleTap(mem, 'w', 1000 + DOUBLE_TAP_MS - 10)).toBe(true); // double-tap
  });

  it('a slow second tap is NOT a dash', () => {
    const mem = { key: '', t: 0 };
    isDoubleTap(mem, 'w', 1000);
    expect(isDoubleTap(mem, 'w', 1000 + DOUBLE_TAP_MS + 50)).toBe(false);
  });

  it('tapping a DIFFERENT key resets — not a dash', () => {
    const mem = { key: '', t: 0 };
    isDoubleTap(mem, 'w', 1000);
    expect(isDoubleTap(mem, 'd', 1010)).toBe(false);
  });

  it('a triple-tap fires only ONE dash (memory clears after a hit)', () => {
    const mem = { key: '', t: 0 };
    isDoubleTap(mem, 'a', 0);                 // tap 1
    expect(isDoubleTap(mem, 'a', 100)).toBe(true);  // tap 2 → dash
    expect(isDoubleTap(mem, 'a', 200)).toBe(false); // tap 3 → not another dash
  });

  it('only WASD are dash keys', () => {
    expect(DASH_KEYS.has('w')).toBe(true);
    expect(DASH_KEYS.has('q')).toBe(false);
  });
});
