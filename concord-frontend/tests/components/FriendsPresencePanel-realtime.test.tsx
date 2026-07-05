/**
 * Pins the realtime dead-event fix for FriendsPresencePanel:
 * `friend:request-received`, `friend:request-accepted`, and
 * `world:invite-received` used to be `window.addEventListener` calls that
 * nothing ever dispatched (the server emits all three via `realtimeEmit`, a
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

vi.mock('@/hooks/useWorldTravel', () => ({
  useWorldTravel: () => ({ travel: vi.fn() }),
}));

import { FriendsPresencePanel } from '@/components/world/FriendsPresencePanel';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('FriendsPresencePanel — realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: true, presence: [], incoming: [] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(['friend:request-received', 'friend:request-accepted', 'world:invite-received'])(
    'refetches on a real %s socket event',
    async (event) => {
      render(<FriendsPresencePanel myWorldId="concordia-hub" />);
      await waitFor(() =>
        expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
      );

      const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      emitSocket(event, { id: 'req_1' });

      await waitFor(() =>
        expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
      );
    },
  );
});
