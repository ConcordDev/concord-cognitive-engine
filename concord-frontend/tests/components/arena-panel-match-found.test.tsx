/**
 * Dead-event-listener fix (verification-audit campaign): server/routes/
 * arena.js#createMatch emits 'arena:match:found' to BOTH participants, but
 * only the player who initiated the queue join ever saw a match alert (via
 * the direct POST /api/arena/queue response). The player who was already
 * waiting in queue had their arena_queue row silently deleted server-side
 * with zero notification — ArenaPanel never subscribed to the socket event
 * at all. Fixed by subscribing directly (matching the working
 * world:refusal-field consumer pattern), not by extending useSocket.ts's
 * window-bridge list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const { subscribeHandlers, subscribeMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    subscribeHandlers: handlers,
    subscribeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: subscribeMock,
}));

import { ArenaPanel } from '@/components/concordia/world/ArenaPanel';

describe('ArenaPanel — subscribes to arena:match:found for the waiting player', () => {
  beforeEach(() => {
    subscribeHandlers.clear();
    subscribeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, queueSize: 1, inQueue: true, matches: [] }) })));
  });

  it('subscribes to the real server event name', () => {
    render(<ArenaPanel playerId="waiting-user" />);
    expect(subscribeMock).toHaveBeenCalledWith('arena:match:found', expect.any(Function));
  });

  it('shows the "Match Found!" alert when the event fires, without needing to have initiated the join', async () => {
    const { container, getByText } = render(<ArenaPanel playerId="waiting-user" />);
    await waitFor(() => expect(subscribeHandlers.has('arena:match:found')).toBe(true));

    act(() => {
      subscribeHandlers.get('arena:match:found')!({ matchId: 'match-1', opponentId: 'joining-user' });
    });

    await waitFor(() => {
      expect(getByText('Match Found!')).toBeTruthy();
      expect(container.textContent).toContain('joining-');
    });
  });
});
