/**
 * shared-vote-cast wiring, write-path half: useWhiteboardCollab already
 * exported `castVote(elementId)` (consumed by the "Shared" tab's tally
 * button family), but nothing on the canvas ever called it — see the
 * companion test tests/components/whiteboard-canvas-vote-click.test.tsx for
 * the click-handler half. This pins castVote's exact macro payload so the
 * two halves are provably compatible: WhiteboardCanvas's onVoteElement is
 * wired to `collab.castVote` in CollabBoardSection, and castVote must call
 * whiteboard.shared-vote-cast with `{ id: boardId, elementId }` — the shape
 * server/domains/whiteboard.js's shared-vote-cast macro actually reads
 * (`params.id || params.boardId`, `params.elementId`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/realtime/event-bus', () => ({
  onEvent: vi.fn(() => () => {}),
}));
vi.mock('@/lib/realtime/socket', () => ({
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  onReconnected: vi.fn(() => () => {}),
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

import { useWhiteboardCollab } from '@/hooks/useWhiteboardCollab';
import { api } from '@/lib/api/client';

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe('useWhiteboardCollab — castVote calls whiteboard.shared-vote-cast', () => {
  beforeEach(() => {
    mockedPost.mockClear();
  });

  it('posts the real macro shape: { id: boardId, elementId }', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: 'board-9' }));

    await act(async () => {
      await result.current.castVote('el-42');
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/lens/run', {
      domain: 'whiteboard', action: 'shared-vote-cast',
      input: { id: 'board-9', elementId: 'el-42' },
    });
  });

  it('is a no-op when there is no active board', async () => {
    const { result } = renderHook(() => useWhiteboardCollab({ boardId: null }));

    await act(async () => {
      await result.current.castVote('el-1');
    });

    const voteCalls = mockedPost.mock.calls.filter((c) => c[1]?.action === 'shared-vote-cast');
    expect(voteCalls.length).toBe(0);
  });
});
