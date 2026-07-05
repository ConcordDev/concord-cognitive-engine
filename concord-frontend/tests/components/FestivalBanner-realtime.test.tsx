/**
 * Pins the realtime dead-event fix for FestivalBanner: `festival:started`
 * used to be a `window.addEventListener` call that nothing ever dispatched
 * (the server emits it via `io.emit` from festival-trigger-cycle.js, a
 * Socket.IO broadcast — never a window CustomEvent). The component now uses
 * `subscribe()` from `lib/realtime/socket`.
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

import { FestivalBanner } from '@/components/world/FestivalBanner';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('FestivalBanner — realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, festivals: [] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refetches on a real festival:started socket event', async () => {
    render(<FestivalBanner worldId="concordia-hub" />);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('festival:started', { festivalId: 'winter_lights', name: 'Winter Lights', worldId: 'concordia-hub' });

    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });
});
