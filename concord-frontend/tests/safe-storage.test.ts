import { describe, it, expect, vi } from 'vitest';
import { safeGetItem, safeSetItem } from '@/lib/safe-storage';

/**
 * Storage.getItem/setItem can throw (SecurityError/QuotaExceededError) in
 * Safari private mode, "block all cookies" settings, and locked-down
 * WebViews — not just return null. These wrappers must never let that throw
 * escape. See lib/safe-storage.ts header comment + Providers.tsx splash-lock
 * fix for the production bug this closes.
 */
describe('safeGetItem', () => {
  it('returns the real value when the underlying storage call succeeds', () => {
    const storage = {
      getItem: vi.fn(() => 'stored-value'),
    } as unknown as Storage;

    expect(safeGetItem(storage, 'some_key')).toBe('stored-value');
    expect(storage.getItem).toHaveBeenCalledWith('some_key');
  });

  it('returns null when the key is absent, matching native Storage semantics', () => {
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Storage;

    expect(safeGetItem(storage, 'missing_key')).toBeNull();
  });

  it('returns null (never throws) when the underlying storage throws', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
    } as unknown as Storage;

    expect(() => safeGetItem(storage, 'some_key')).not.toThrow();
    expect(safeGetItem(storage, 'some_key')).toBeNull();
  });
});

describe('safeSetItem', () => {
  it('returns true when the underlying storage call succeeds', () => {
    const storage = {
      setItem: vi.fn(),
    } as unknown as Storage;

    expect(safeSetItem(storage, 'some_key', 'value')).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith('some_key', 'value');
  });

  it('returns false (never throws) when the underlying storage throws', () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    } as unknown as Storage;

    expect(() => safeSetItem(storage, 'some_key', 'value')).not.toThrow();
    expect(safeSetItem(storage, 'some_key', 'value')).toBe(false);
  });
});
