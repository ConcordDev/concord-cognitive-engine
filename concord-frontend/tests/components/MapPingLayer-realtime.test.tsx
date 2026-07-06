/**
 * Pins the realtime dead-event fix for MapPingLayer: `world:marker-placed`
 * used to be a `window.addEventListener` call that nothing ever dispatched
 * (the server emits it via `realtimeEmit`, a Socket.IO broadcast — never a
 * window CustomEvent). The component now uses `subscribe()` from
 * `lib/realtime/socket`, and filters by `data.worldId` (the raw payload
 * field, not a wrapped `CustomEvent.detail`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import { MapPingLayer } from '@/components/world/MapPingLayer';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('MapPingLayer — realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: true, markers: [] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refetches on a real world:marker-placed event for its own world', async () => {
    render(<MapPingLayer worldId="concordia-hub" />);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('world:marker-placed', { id: 'm1', worldId: 'concordia-hub', kind: 'poi', label: 'Camp' });

    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });

  it('ignores a world:marker-placed event for a different world', async () => {
    render(<MapPingLayer worldId="concordia-hub" />);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('world:marker-placed', { id: 'm2', worldId: 'other-world', kind: 'poi', label: 'Elsewhere' });

    // Give any (incorrect) refetch a chance to happen, then assert it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterMount);
  });
});
