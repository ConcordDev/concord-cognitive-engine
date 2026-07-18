// getDeviceId — stable, per-browser device identifier for multi-device
// conflict provenance (docs/lens-specs/offline-capability-map.md "Multi-device
// conflict provenance (which device wrote which revision) ... GENUINELY
// MISSING" gap-closure). Deliberately separate from ReplicationPanel's
// checkpointIdFor/replicationId (a per-SYNC-STREAM identity), per the
// module's own header comment.
//
// Exercises the real implementation against jsdom's real `localStorage` and
// `crypto.randomUUID` — no mocking of `local-store.ts` itself, since this is
// exactly the pure, IndexedDB-free slice of that module.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDeviceId } from '@/components/offline/local-store';

const KEY = 'concord-offline-device-id';

describe('getDeviceId', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('generates a non-empty id on first call', () => {
    const id = getDeviceId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('persists the id in localStorage under the expected key', () => {
    const id = getDeviceId();
    expect(window.localStorage.getItem(KEY)).toBe(id);
  });

  it('returns the SAME id on every subsequent call (stable per browser)', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    const third = getDeviceId();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('reuses an id that was already persisted from a prior session', () => {
    window.localStorage.setItem(KEY, 'pre-existing-device-id-123');
    expect(getDeviceId()).toBe('pre-existing-device-id-123');
  });

  it('two distinct "browsers" (independent localStorage) get two distinct ids', () => {
    const a = getDeviceId();
    window.localStorage.clear();
    const b = getDeviceId();
    expect(a).not.toBe(b);
  });

  it('never collides with ReplicationPanel\'s checkpoint/replicationId key', () => {
    // The capability-map gap explicitly warns against conflating a per-sync-
    // stream identity (checkpointIdFor -> 'offline-lens-replication[:filter:id]')
    // with a per-device identity. Assert the storage keys are provably distinct.
    expect(KEY).not.toBe('offline-lens-replication');
    getDeviceId();
    expect(window.localStorage.getItem('offline-lens-replication')).toBeNull();
  });

  it('falls back to null (never throws, never fabricates) when localStorage.getItem throws', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('quota/security error');
    });
    expect(() => getDeviceId()).not.toThrow();
    expect(getDeviceId()).toBeNull();
    spy.mockRestore();
  });

  it('falls back to null when window.localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    // @ts-expect-error - deliberately simulating an environment with no localStorage
    delete window.localStorage;
    try {
      expect(getDeviceId()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
