/**
 * Dead-event-listener fix (verification-audit campaign): the whiteboard
 * "Live" tab's named-participant presence list (server/domains/whiteboard.js
 * presence-ping/presence-list) and reaction broadcast (reaction-send) had
 * real backend logic and a real UI, but:
 *   1. Nothing ever called presence-ping, so presence-list always polled
 *      empty — the labeled "Live cursors" section never showed anyone.
 *   2. Neither 'whiteboard:presence' nor 'whiteboard:reaction' were in the
 *      SocketEvent union or useSocket.ts's forwarded-events allowlist, so
 *      even a push from the server would never reach the event bus.
 *   3. A sent reaction only ever showed the sender their own confirmation —
 *      no peer ever saw anyone else's reaction.
 *
 * Fixed by piggybacking a slower-cadence presence-ping onto the already-real
 * cursor-broadcast position in useWhiteboardCollab, and subscribing to both
 * events via the event bus (matching the working scene-update/cursor/
 * vote-cast pattern in the same hook).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { eventHandlers, onEventMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    eventHandlers: handlers,
    onEventMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
vi.mock('@/lib/realtime/event-bus', () => ({
  onEvent: onEventMock,
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

import { useWhiteboardCollab } from '@/hooks/useWhiteboardCollab';
import { api } from '@/lib/api/client';

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe('useWhiteboardCollab — presence-ping + reaction/presence subscriptions', () => {
  beforeEach(() => {
    eventHandlers.clear();
    onEventMock.mockClear();
    mockedPost.mockClear();
  });

  it('subscribes to whiteboard:presence and whiteboard:reaction', () => {
    renderHook(() => useWhiteboardCollab({ boardId: 'board-1' }));
    expect(onEventMock).toHaveBeenCalledWith('whiteboard:presence', expect.any(Function));
    expect(onEventMock).toHaveBeenCalledWith('whiteboard:reaction', expect.any(Function));
  });

  it('broadcastCursor also pings presence with the real cursor position', () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: 'board-1' }));

    act(() => { result.current.broadcastCursor(120, 340); });

    expect(mockedPost).toHaveBeenCalledWith('/api/lens/run', {
      domain: 'whiteboard', action: 'presence-ping',
      input: { boardId: 'board-1', x: 120, y: 340 },
    });
  });

  it('does not re-ping presence on every cursor move — throttled independently from the cursor push', () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: 'board-1' }));

    act(() => { result.current.broadcastCursor(1, 1); });
    const presencePings = mockedPost.mock.calls.filter((c) => c[1]?.action === 'presence-ping');
    expect(presencePings.length).toBe(1);

    act(() => { result.current.broadcastCursor(2, 2); });
    const presencePingsAfter = mockedPost.mock.calls.filter((c) => c[1]?.action === 'presence-ping');
    expect(presencePingsAfter.length).toBe(1); // immediate second call: still throttled
  });

  it('merges a pushed whiteboard:presence event into livePresence, scoped to this board', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: 'board-1' }));
    await waitFor(() => expect(eventHandlers.has('whiteboard:presence')).toBe(true));

    act(() => {
      eventHandlers.get('whiteboard:presence')!({
        boardId: 'board-1', userId: 'user-2', name: 'Riko', color: '#f00', x: 5, y: 9, updatedAt: 123,
      });
    });

    expect(result.current.livePresence['user-2']).toMatchObject({
      userId: 'user-2', name: 'Riko', color: '#f00', x: 5, y: 9,
    });

    act(() => {
      eventHandlers.get('whiteboard:presence')!({
        boardId: 'other-board', userId: 'user-3', name: 'Wrong Board', color: '#0f0', x: 0, y: 0,
      });
    });
    expect(result.current.livePresence['user-3']).toBeUndefined();
  });

  it('surfaces a pushed whiteboard:reaction event as lastPeerReaction, scoped to this board', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: 'board-1' }));
    await waitFor(() => expect(eventHandlers.has('whiteboard:reaction')).toBe(true));

    act(() => {
      eventHandlers.get('whiteboard:reaction')!({
        id: 'rxn-1', boardId: 'board-1', emoji: '🔥', x: 1, y: 2, authorId: 'user-2', authorName: 'Riko', ts: 999,
      });
    });

    expect(result.current.lastPeerReaction).toMatchObject({ id: 'rxn-1', emoji: '🔥', authorName: 'Riko' });
  });
});
