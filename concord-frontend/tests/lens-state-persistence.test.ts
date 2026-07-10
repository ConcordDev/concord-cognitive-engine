/**
 * lens-state-persistence — contract tests for the get/set utility + its
 * cap/eviction logic (`hooks/../lib/lens-state-persistence.ts`).
 *
 * Pins:
 *   - round-trip get/set for a single lens
 *   - the MAX_LENSES=20 cap evicts the OLDEST (by savedAt) entry first, never
 *     an arbitrary or newest one
 *   - re-setting an existing lens's state refreshes its recency (doesn't get
 *     evicted just because it was set first, if it was re-set most recently)
 *   - clearLensState drops exactly one entry
 *   - corrupted/foreign JSON under the storage key degrades to "nothing
 *     restored" rather than throwing or fabricating state
 *   - a throwing localStorage (Safari private mode etc.) never escapes as an
 *     uncaught error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLensState,
  setLensState,
  clearLensState,
  lensStateCount,
} from '@/lib/lens-state-persistence';

const STORAGE_KEY = 'concord-lens-ui-state';

describe('lens-state-persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null for a lens with no persisted state', () => {
    expect(getLensState('nonexistent-lens')).toBeNull();
  });

  it('round-trips a lens state payload', () => {
    setLensState('code', { scrollY: 420, openPanelId: 'terminal', filters: ['ts', 'js'] });
    expect(getLensState('code')).toEqual({ scrollY: 420, openPanelId: 'terminal', filters: ['ts', 'js'] });
  });

  it('overwrites prior state for the same lens id', () => {
    setLensState('atlas', { zoom: 1 });
    setLensState('atlas', { zoom: 2 });
    expect(getLensState('atlas')).toEqual({ zoom: 2 });
  });

  it('ignores empty/invalid lens ids without throwing', () => {
    expect(() => setLensState('', { a: 1 })).not.toThrow();
    expect(getLensState('')).toBeNull();
  });

  it('clearLensState drops exactly one entry, leaving the rest intact', () => {
    setLensState('music', { a: 1 });
    setLensState('crypto', { b: 2 });
    clearLensState('music');
    expect(getLensState('music')).toBeNull();
    expect(getLensState('crypto')).toEqual({ b: 2 });
  });

  it('clearLensState on an absent lens is a harmless no-op', () => {
    setLensState('music', { a: 1 });
    expect(() => clearLensState('nonexistent')).not.toThrow();
    expect(getLensState('music')).toEqual({ a: 1 });
  });

  it('caps at 20 lenses, evicting the OLDEST by savedAt first', () => {
    // Stamp 20 lenses with strictly increasing savedAt via a controlled clock,
    // so eviction order is deterministic rather than racing Date.now() ties.
    const base = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => base);
    for (let i = 0; i < 20; i++) {
      vi.spyOn(Date, 'now').mockReturnValueOnce(base + i * 1000);
      setLensState(`lens-${i}`, { i });
    }
    expect(lensStateCount()).toBe(20);
    // lens-0 is the oldest — adding a 21st entry must evict exactly it.
    vi.spyOn(Date, 'now').mockReturnValueOnce(base + 20 * 1000);
    setLensState('lens-20', { i: 20 });

    expect(lensStateCount()).toBe(20);
    expect(getLensState('lens-0')).toBeNull(); // evicted — was oldest
    expect(getLensState('lens-1')).toEqual({ i: 1 }); // next-oldest survives
    expect(getLensState('lens-20')).toEqual({ i: 20 }); // newest present

    vi.restoreAllMocks();
  });

  it('re-setting an existing lens refreshes its recency so it is not evicted as "oldest"', () => {
    const base = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) {
      vi.spyOn(Date, 'now').mockReturnValueOnce(base + i * 1000);
      setLensState(`lens-${i}`, { i });
    }
    // Touch lens-0 (the original oldest) so its savedAt becomes the newest.
    vi.spyOn(Date, 'now').mockReturnValueOnce(base + 20 * 1000);
    setLensState('lens-0', { i: 'refreshed' });

    // Now lens-1 is the true oldest; adding a 21st entry should evict lens-1,
    // not the just-refreshed lens-0.
    vi.spyOn(Date, 'now').mockReturnValueOnce(base + 21 * 1000);
    setLensState('lens-21', { i: 21 });

    expect(getLensState('lens-0')).toEqual({ i: 'refreshed' });
    expect(getLensState('lens-1')).toBeNull();

    vi.restoreAllMocks();
  });

  it('degrades to "nothing restored" when the storage key holds corrupted JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(getLensState('anything')).toBeNull();
    expect(lensStateCount()).toBe(0);
  });

  it('degrades to "nothing restored" when the storage key holds a foreign non-object value', () => {
    window.localStorage.setItem(STORAGE_KEY, '"just a string"');
    expect(getLensState('anything')).toBeNull();
    window.localStorage.setItem(STORAGE_KEY, '[1,2,3]');
    expect(getLensState('anything')).toBeNull();
  });

  it('drops a malformed individual entry instead of fabricating a state object', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        good: { state: { x: 1 }, savedAt: 1 },
        bad1: { state: 'not-an-object', savedAt: 2 },
        bad2: { savedAt: 3 },
        bad3: 'not-an-entry-object',
      })
    );
    expect(getLensState('good')).toEqual({ x: 1 });
    expect(getLensState('bad1')).toBeNull();
    expect(getLensState('bad2')).toBeNull();
    expect(getLensState('bad3')).toBeNull();
  });

  it('never throws even when the underlying localStorage throws', () => {
    const getSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => setLensState('x', { a: 1 })).not.toThrow();
    expect(() => getLensState('x')).not.toThrow();
    expect(getLensState('x')).toBeNull();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
