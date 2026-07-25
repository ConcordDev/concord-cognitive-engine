import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock socket with event listeners
const socketListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
const mockSocket = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (!socketListeners[event]) socketListeners[event] = [];
    socketListeners[event].push(handler);
  }),
  off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (socketListeners[event]) {
      socketListeners[event] = socketListeners[event].filter((h) => h !== handler);
    }
  }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
};

vi.mock('@/hooks/useSocket', () => ({
  useSocket: vi.fn(() => ({
    socket: mockSocket,
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useSocket } from '@/hooks/useSocket';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function emitSocketEvent(event: string, data: unknown) {
  if (socketListeners[event]) {
    socketListeners[event].forEach((handler) => handler(data));
  }
}

describe('useRealtimeLens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all listeners
    Object.keys(socketListeners).forEach((key) => {
      delete socketListeners[key];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null latestData initially', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.latestData).toBeNull();
    });

    it('returns empty alerts initially', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.alerts).toEqual([]);
    });

    it('returns empty insights initially', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.insights).toEqual([]);
    });

    // 2026-07-25: this assertion previously encoded the pessimistic-lie
    // bug directly — "isLive requires both isConnected AND
    // hasReceivedData" meant a connected domain that had (legitimately)
    // never received a payload reported isLive=false, which the
    // LiveIndicator badge renders as "Disconnected" even though the
    // socket is healthy (reproduced live on the world lens, keyed to
    // 'world:update' — an event nobody emits). isLive is now the
    // socket-health claim (isConnected) — see the hook's own interface
    // comment. hasReceivedData is the separate, weaker claim, pinned
    // below.
    it('returns isLive as true when connected, even before any domain data arrives', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      // The mocked useSocket() reports isConnected: true — isLive must
      // reflect that immediately, not wait on a domain event that may
      // never come.
      expect(result.current.isLive).toBe(true);
      expect(result.current.isConnected).toBe(true);
    });

    it('returns hasReceivedData as false before receiving data (the separate, weaker claim)', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasReceivedData).toBe(false);
    });

    it('never reports isLive as true when the socket is disconnected (the safety rail)', () => {
      vi.mocked(useSocket).mockReturnValue({
        socket: mockSocket,
        isConnected: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as ReturnType<typeof useSocket>);

      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLive).toBe(false);
      expect(result.current.isConnected).toBe(false);
    });

    it('keeps isLive true for a domain whose mapped event never fires (world-lens regression)', () => {
      // 'never-emits-domain' has no DOMAIN_EVENTS entry, so it falls back
      // to a `${domain}:update` event that (like the real 'world:update')
      // nothing server-side ever dispatches. Pre-fix this reported
      // isLive=false forever — the exact bug from the world lens.
      const { result } = renderHook(() => useRealtimeLens('never-emits-domain'), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLive).toBe(true);
      expect(result.current.hasReceivedData).toBe(false);
    });

    it('returns null lastUpdated initially', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(result.current.lastUpdated).toBeNull();
    });
  });

  describe('domain event mapping', () => {
    it('subscribes to known domain events for finance', () => {
      renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      // Finance subscribes to finance:ticker (a real, server-emitted
      // event — server/emergent/realtime-feeds.js#tickFinancialFeeds).
      // 'finance:market_update' and 'finance:alert' were removed from
      // DOMAIN_EVENTS 2026-07-25: verified dead (no realtimeEmit/socket
      // emit anywhere in server/, not in event-shapes.js's LENIENT_EVENTS
      // registry either) — subscribing to an event nobody ever dispatches
      // is dead weight, not a real capability. See
      // server/tests/invariants/realtime-lens-event-liveness.test.js.
      expect(mockSocket.on).toHaveBeenCalledWith('finance:ticker', expect.any(Function));
      expect(mockSocket.on).not.toHaveBeenCalledWith('finance:market_update', expect.any(Function));
      expect(mockSocket.on).not.toHaveBeenCalledWith('finance:alert', expect.any(Function));
    });

    it('subscribes to fallback domain:update for unknown domains', () => {
      renderHook(() => useRealtimeLens('custom-domain'), {
        wrapper: createWrapper(),
      });

      expect(mockSocket.on).toHaveBeenCalledWith('custom-domain:update', expect.any(Function));
    });

    it('subscribes to agent:insights', () => {
      renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(mockSocket.on).toHaveBeenCalledWith('agent:insights', expect.any(Function));
    });

    it('subscribes to domain-specific insight events', () => {
      renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      expect(mockSocket.on).toHaveBeenCalledWith('finance:insight', expect.any(Function));
    });
  });

  describe('data updates', () => {
    it('updates latestData when a domain event fires', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('finance:ticker', {
          symbol: 'AAPL',
          price: 150.25,
          fetchedAt: '2026-01-01T00:00:00Z',
        });
      });

      expect(result.current.latestData).toEqual(
        expect.objectContaining({ symbol: 'AAPL', price: 150.25 })
      );
    });

    it('updates lastUpdated when data arrives', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('finance:ticker', {
          fetchedAt: '2026-01-01T12:00:00Z',
        });
      });

      expect(result.current.lastUpdated).toBe('2026-01-01T12:00:00Z');
    });

    it('uses current time when fetchedAt is not provided', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('finance:ticker', { data: 'test' });
      });

      expect(result.current.lastUpdated).toBeTruthy();
    });
  });

  describe('alerts', () => {
    // 'finance:alert' was removed from DOMAIN_EVENTS 2026-07-25 (verified
    // dead — no realtimeEmit/socket emit anywhere in server/, see the
    // removal comment on DOMAIN_EVENTS and
    // server/tests/invariants/realtime-lens-event-liveness.test.js). The
    // generic alert-capture mechanism (filter events for ':alert'/
    // ':breaking' substrings) is still real code and still deserves
    // coverage, so these tests exercise it through a domain string whose
    // computed `${domain}:update` fallback event happens to contain the
    // ':alert' substring the filter looks for — this drives the actual,
    // unmodified filter/handler logic through the public hook API without
    // depending on a dead literal event name.
    it('captures alerts from alert-type events', () => {
      const { result } = renderHook(() => useRealtimeLens('custom:alert'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('custom:alert:update', {
          message: 'Market crash detected',
          severity: 'critical',
        });
      });

      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].message).toBe('Market crash detected');
      expect(result.current.alerts[0].severity).toBe('critical');
      expect(result.current.alerts[0].id).toMatch(/^alert-/);
    });

    it('caps alerts at 20', () => {
      const { result } = renderHook(() => useRealtimeLens('custom:alert'), {
        wrapper: createWrapper(),
      });

      for (let i = 0; i < 25; i++) {
        act(() => {
          emitSocketEvent('custom:alert:update', {
            message: `Alert ${i}`,
            severity: 'info',
          });
        });
      }

      expect(result.current.alerts.length).toBeLessThanOrEqual(20);
    });
  });

  describe('clearAlerts', () => {
    it('clears all alerts', () => {
      const { result } = renderHook(() => useRealtimeLens('custom:alert'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('custom:alert:update', { message: 'Test', severity: 'info' });
      });

      expect(result.current.alerts).toHaveLength(1);

      act(() => {
        result.current.clearAlerts();
      });

      expect(result.current.alerts).toEqual([]);
    });
  });

  describe('insights', () => {
    it('captures insights from agent:insights for matching domain', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('agent:insights', {
          domain: 'finance',
          insight: 'Bull market detected',
          confidence: 0.85,
          timestamp: '2026-01-01T00:00:00Z',
        });
      });

      expect(result.current.insights).toHaveLength(1);
      expect(result.current.insights[0].insight).toBe('Bull market detected');
      expect(result.current.insights[0].confidence).toBe(0.85);
    });

    it('ignores insights from agent:insights for non-matching domain', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('agent:insights', {
          domain: 'healthcare',
          insight: 'Health trend',
          confidence: 0.9,
          timestamp: '2026-01-01T00:00:00Z',
        });
      });

      expect(result.current.insights).toHaveLength(0);
    });

    it('captures domain-specific insights', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      act(() => {
        emitSocketEvent('finance:insight', {
          insight: 'Sector rotation underway',
          confidence: 0.78,
          timestamp: '2026-01-01T00:00:00Z',
        });
      });

      expect(result.current.insights).toHaveLength(1);
      expect(result.current.insights[0].domain).toBe('finance');
    });

    it('caps insights at 10', () => {
      const { result } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      for (let i = 0; i < 15; i++) {
        act(() => {
          emitSocketEvent('agent:insights', {
            domain: 'finance',
            insight: `Insight ${i}`,
            confidence: 0.5,
            timestamp: '2026-01-01T00:00:00Z',
          });
        });
      }

      expect(result.current.insights.length).toBeLessThanOrEqual(10);
    });
  });

  describe('cleanup on unmount', () => {
    it('removes event listeners on unmount', () => {
      const { unmount } = renderHook(() => useRealtimeLens('finance'), {
        wrapper: createWrapper(),
      });

      unmount();

      // Should have called off for each registered handler
      expect(mockSocket.off).toHaveBeenCalled();
    });
  });
});
