// FIX-social-001 (FE half) — ReplyTree offers Delete on the viewer's own
// replies only, with a confirm step, wired to social.deleteReply.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { ReplyTree } from '@/components/social/feed/ReplyTree';

const TREE = [
  { id: 'r-mine', postId: 'p1', parentId: null, userId: 'u-me', username: 'me', displayName: 'Me', body: 'my reply', createdAt: new Date().toISOString(), children: [] },
  { id: 'r-theirs', postId: 'p1', parentId: null, userId: 'u-other', username: 'other', displayName: 'Other', body: 'their reply', createdAt: new Date().toISOString(), children: [] },
];

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, name: string) => {
    if (name === 'replyTree') return { data: { ok: true, result: { tree: TREE, total: 2 } } };
    return { data: { ok: true, result: {} } };
  });
});
afterEach(() => cleanup());

describe('ReplyTree delete', () => {
  it('shows Delete only on own replies; confirm fires social.deleteReply', async () => {
    render(<ReplyTree postId="p1" username="me" currentUserId="u-me" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show replies/ })); });
    const deleteButtons = await screen.findAllByRole('button', { name: /^Delete$/ });
    expect(deleteButtons).toHaveLength(1);
    await act(async () => { fireEvent.click(deleteButtons[0]); });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'deleteReply')).toBe(false);
    const confirm = await screen.findByRole('button', { name: /Confirm delete/ });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => c[1] === 'deleteReply');
    expect(del?.[2]).toMatchObject({ postId: 'p1', replyId: 'r-mine' });
  });
});
