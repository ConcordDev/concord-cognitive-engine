/**
 * whiteboard.comments-delete was previously UNSURFACED — comments could be
 * created (and resolved) from the UI but never deleted, even though the
 * backend handler was real and author-gated (see
 * docs/lens-specs/whiteboard-capability-map.md). CollabBoardSection's
 * CommentsTab now renders a delete (trash) affordance on each comment,
 * gated client-side to the current user's own comments (matching the
 * server's author-only enforcement), and wires it to the real macro.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

// jsdom doesn't implement a real canvas 2D context; the mounted
// WhiteboardCanvas already null-checks and early-returns, this just keeps
// the test run's console clean (see whiteboard-canvas-vote-click.test.tsx).
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

vi.mock('@/lib/realtime/event-bus', () => ({
  onEvent: vi.fn(() => () => {}),
}));
vi.mock('@/lib/realtime/socket', () => ({
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  onReconnected: vi.fn(() => () => {}),
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
}));

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { post: vi.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

import { CollabBoardSection } from '@/components/whiteboard/CollabBoardSection';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}

function callKey(args: unknown[]): string {
  const first = args[0] as { domain?: string; action?: string } | string;
  if (first && typeof first === 'object' && 'domain' in first) return `${first.domain}.${first.action}`;
  const [domain, action] = args as [string, string];
  return `${domain}.${action}`;
}
function callInput(args: unknown[]): Record<string, unknown> | undefined {
  const first = args[0] as { input?: Record<string, unknown> } | string;
  if (first && typeof first === 'object' && 'input' in first) return first.input;
  return args[2] as Record<string, unknown> | undefined;
}

const BOARD = { id: 'board-1', title: 'My board', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', elementCount: 1 };
const SCENE_EL = { id: 'el1', kind: 'sticky', x: 0, y: 0, w: 100, h: 60, text: 'Hello' };
const COMMENT_MINE = { id: 'c1', elementId: 'el1', authorId: 'user-1', authorName: 'Me', body: 'nice', createdAt: '2026-01-01T00:00:00Z', resolved: false };
const COMMENT_OTHER = { id: 'c2', elementId: 'el1', authorId: 'user-2', authorName: 'Other', body: 'also nice', createdAt: '2026-01-01T00:00:00Z', resolved: false };

function wireLensRun(overrides: Record<string, (args: unknown[]) => Promise<unknown>> = {}) {
  lensRunMock.mockImplementation((...args: unknown[]) => {
    const key = callKey(args);
    if (key in overrides) return overrides[key](args);
    if (key === 'whiteboard.board-list') return ok({ boards: [BOARD] });
    if (key === 'whiteboard.board-load') return ok({ board: { ...BOARD, scene: { elements: [SCENE_EL] } } });
    if (key === 'whiteboard.comments-list') return ok({ comments: { el1: [COMMENT_MINE, COMMENT_OTHER] } });
    if (key === 'whiteboard.workspace-summary') return ok({ boardCount: 1, elementCount: 1, stickyCount: 1, sharedCount: 0, openCommentCount: 2 });
    return ok({});
  });
}

async function openCommentsTab() {
  // Wait for the board + comments to load, then switch to the Comments AI tab.
  await waitFor(() => expect(screen.getByText('My board')).toBeTruthy());
  const commentsTabBtn = await screen.findByRole('button', { name: /Comments/ });
  fireEvent.click(commentsTabBtn);
  // Expand the sticky's comment thread.
  const stickyRow = await screen.findByText('Hello');
  fireEvent.click(stickyRow);
}

describe('CollabBoardSection — comments-delete (author-gated delete affordance)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: 'user-1', username: 'me', email: 'me@x.com', role: 'user' }, isAuthenticated: true, isLoading: false });
  });

  it('renders a delete affordance only on the current user\'s own comment', async () => {
    wireLensRun();
    render(<CollabBoardSection />);
    await openCommentsTab();

    await waitFor(() => {
      const deleteButtons = screen.getAllByLabelText('Delete comment');
      expect(deleteButtons.length).toBe(1);
    });
    // The other participant's comment renders with no delete affordance.
    expect(screen.getByText('also nice')).toBeTruthy();
  });

  it('clicking delete calls whiteboard.comments-delete with { boardId, id } and refreshes the list', async () => {
    wireLensRun();
    render(<CollabBoardSection />);
    await openCommentsTab();

    const deleteBtn = await screen.findByLabelText('Delete comment');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      const deleteCalls = lensRunMock.mock.calls.filter((c) => callKey(c) === 'whiteboard.comments-delete');
      expect(deleteCalls.length).toBe(1);
      expect(callInput(deleteCalls[0])).toEqual({ boardId: 'board-1', id: 'c1' });
    });
    // refreshComments is called again after a successful delete.
    await waitFor(() => {
      const listCalls = lensRunMock.mock.calls.filter((c) => callKey(c) === 'whiteboard.comments-list');
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders no delete affordance at all when the viewer has no comments on the thread', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'user-9', username: 'someone-else', email: '', role: 'user' }, isAuthenticated: true, isLoading: false });
    wireLensRun();
    render(<CollabBoardSection />);
    await openCommentsTab();

    await waitFor(() => expect(screen.getByText('nice')).toBeTruthy());
    expect(screen.queryByLabelText('Delete comment')).toBeNull();
  });

  it('an ok:false response is not silently treated as success (no phantom refresh count on failure)', async () => {
    wireLensRun({ 'whiteboard.comments-delete': async () => fail('only author can delete') });
    render(<CollabBoardSection />);
    await openCommentsTab();

    const listCallsBefore = () => lensRunMock.mock.calls.filter((c) => callKey(c) === 'whiteboard.comments-list').length;
    const before = listCallsBefore();

    const deleteBtn = await screen.findByLabelText('Delete comment');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      const deleteCalls = lensRunMock.mock.calls.filter((c) => callKey(c) === 'whiteboard.comments-delete');
      expect(deleteCalls.length).toBe(1);
    });
    // No extra comments-list refetch happened since the delete failed.
    expect(listCallsBefore()).toBe(before);
  });
});
