import { describe, it, expect } from 'vitest';
import { roundClean, fmtClean, formatPValue } from '@/lib/sim/format';

describe('sim/format — print-layer precision helpers (sim.md F7)', () => {
  describe('roundClean', () => {
    it('strips IEEE-754 float noise back to the intended decimal value', () => {
      expect(roundClean(343.91599999999994)).toBe(343.916);
    });

    it('passes through already-clean values unchanged', () => {
      expect(roundClean(12)).toBe(12);
      expect(roundClean(0)).toBe(0);
      expect(roundClean(-4.5)).toBe(-4.5);
    });

    it('passes NaN/Infinity through untouched', () => {
      expect(roundClean(NaN)).toBeNaN();
      expect(roundClean(Infinity)).toBe(Infinity);
    });
  });

  describe('fmtClean', () => {
    it('renders a noisy float as its clean decimal string', () => {
      expect(fmtClean(343.91599999999994)).toBe('343.916');
    });

    it('renders integers without a trailing decimal', () => {
      expect(fmtClean(12)).toBe('12');
    });
  });

  describe('formatPValue', () => {
    it('does not collapse a small nonzero p-value to "0"', () => {
      expect(formatPValue(0.00000013)).toBe('<0.0001');
      expect(formatPValue(0.00000013)).not.toBe('0');
    });

    it('shows ordinary p-values at fixed precision', () => {
      expect(formatPValue(0.0421)).toBe('0.0421');
    });

    it('shows an exact zero as a bound, not a bare 0', () => {
      expect(formatPValue(0)).toBe('0.0000');
    });

    it('handles the boundary at 0.0001 inclusively (not bounded)', () => {
      expect(formatPValue(0.0001)).toBe('0.0001');
    });
  });
});
