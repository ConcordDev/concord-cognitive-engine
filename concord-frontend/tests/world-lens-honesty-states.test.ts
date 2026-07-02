/**
 * W4 world-lens honesty — pure state reducers.
 *
 * Two honesty rules pinned:
 *   1. The socket connection pill has a TERMINAL 'offline' state; it never
 *      shows an eternal "Connecting…" after the socket.io manager has given up.
 *   2. The 3D scene boots on DEMO_DISTRICT seed geometry; the derived
 *      world-data state labels that as loading/preview until a real world
 *      fetch resolves — so the seed render is never presented as live state.
 */

import { describe, it, expect } from 'vitest';
import {
  nextConnectionStatus,
  connectionLabel,
  connectionDotClass,
  type ConnectionStatus,
} from '@/lib/realtime/connection-status';
import {
  deriveWorldDataState,
  initialWorldFetchOutcomes,
  WORLD_DATA_SOURCES,
  type WorldFetchOutcome,
  type WorldDataSource,
} from '@/lib/world-lens/world-data-state';

describe('connection-status reducer', () => {
  it('connect → connected regardless of prior state', () => {
    for (const prev of ['connecting', 'connected', 'offline'] as ConnectionStatus[]) {
      expect(nextConnectionStatus(prev, 'connect')).toBe('connected');
    }
  });

  it('reconnect_failed is terminal → offline', () => {
    expect(nextConnectionStatus('connecting', 'reconnect_failed')).toBe('offline');
    expect(nextConnectionStatus('connected', 'reconnect_failed')).toBe('offline');
  });

  it('a trailing disconnect/connect_error does NOT resurrect eternal Connecting once offline', () => {
    expect(nextConnectionStatus('offline', 'disconnect')).toBe('offline');
    expect(nextConnectionStatus('offline', 'connect_error')).toBe('offline');
  });

  it('reconnect_attempt from offline re-enters connecting (honest new cycle)', () => {
    expect(nextConnectionStatus('offline', 'reconnect_attempt')).toBe('connecting');
  });

  it('disconnect/connect_error from a live socket → connecting', () => {
    expect(nextConnectionStatus('connected', 'disconnect')).toBe('connecting');
    expect(nextConnectionStatus('connected', 'connect_error')).toBe('connecting');
  });

  it('labels + dot classes never say "Connecting" when offline', () => {
    expect(connectionLabel('offline')).toBe('Offline');
    expect(connectionLabel('connected')).toBe('Live connection');
    expect(connectionLabel('connecting')).toMatch(/Connecting/);
    expect(connectionDotClass('offline')).toBe('bg-gray-500');
    expect(connectionDotClass('connected')).toBe('bg-green-400');
    expect(connectionDotClass('connecting')).toBe('bg-red-400');
  });
});

describe('world-data-state derivation', () => {
  const all = (o: WorldFetchOutcome): Record<WorldDataSource, WorldFetchOutcome> =>
    Object.fromEntries(WORLD_DATA_SOURCES.map((s) => [s, o])) as Record<
      WorldDataSource,
      WorldFetchOutcome
    >;

  it('all pending → loading (fresh boot on the seed district)', () => {
    expect(deriveWorldDataState(initialWorldFetchOutcomes())).toBe('loading');
  });

  it('any ok → live (an HTTP-ok empty world is still genuine live state)', () => {
    const o = all('pending');
    o.buildings = 'ok';
    expect(deriveWorldDataState(o)).toBe('live');
  });

  it('every source errored → offline (seed render is a labeled preview)', () => {
    expect(deriveWorldDataState(all('error'))).toBe('offline');
  });

  it('some errored, some pending, none ok → still loading (not yet terminal)', () => {
    const o = all('pending');
    o.nodes = 'error';
    o.npcs = 'error';
    expect(deriveWorldDataState(o)).toBe('loading');
  });

  it('initial outcomes returns a fresh object each call (safe as useState init)', () => {
    const a = initialWorldFetchOutcomes();
    const b = initialWorldFetchOutcomes();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
