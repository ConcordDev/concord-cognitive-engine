import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStoredQualityPreset,
  setStoredQualityPreset,
  hasStoredQualityPreset,
} from '@/lib/world-lens/quality-preset';

const STORAGE_KEY = 'concord-quality-preset';

describe('quality-preset — hasStoredQualityPreset (R7)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns false when nothing has ever been stored', () => {
    expect(hasStoredQualityPreset()).toBe(false);
    // getStoredQualityPreset()'s DEFAULT_PRESET fallback is 'medium' in this
    // exact case — the whole point of hasStoredQualityPreset is to let a
    // caller distinguish this state from an explicit choice of 'medium'.
    expect(getStoredQualityPreset()).toBe('medium');
  });

  it('returns true once a valid preset has been explicitly stored, even "medium"', () => {
    setStoredQualityPreset('medium');
    expect(hasStoredQualityPreset()).toBe(true);
    expect(getStoredQualityPreset()).toBe('medium');
  });

  it('returns true for a non-default explicit choice too', () => {
    setStoredQualityPreset('ultra');
    expect(hasStoredQualityPreset()).toBe(true);
    expect(getStoredQualityPreset()).toBe('ultra');
  });

  it('returns false if localStorage holds a corrupted/invalid value', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-real-preset');
    expect(hasStoredQualityPreset()).toBe(false);
  });
});
