/**
 * S14 (PR #1707): Live Share terminal records its own traffic; the
 * workbench DM resolves usernames (F14).
 *
 * Terminal: the bus relays with socket.to(room) — the sender is
 * excluded by design, so a sent line never appeared in the sender's
 * own panel ("0 lines" forever). The tile now echoes locally and
 * reports the line to the session activity feed.
 *
 * DM: the /api/social/dm route resolves recipients by user id only.
 * The panel now resolves a typed username through the platform's own
 * by-username lookup before posting, and a genuine miss renders one
 * specific reason — never the raw duplicated server string.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
    delete: vi.fn(),
  },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => undefined }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: { div: (props: Record<string, unknown>) => <div {...props} /> },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('socket.io-client', () => ({
  io: () => ({ emit: vi.fn(), on: vi.fn(), disconnect: vi.fn() }),
}));

import { SharedDebugTerminalTile } from '@/components/code/CodeAdvancedPanel';
import { CodeActionPanel } from '@/components/code/CodeActionPanel';

beforeEach(() => {
  lensRunMock.mockReset(); apiGetMock.mockReset(); apiPostMock.mockReset(); runDomainMock.mockReset();
  runDomainMock.mockResolvedValue({ data: { ok: true, result: {} } });
  lensRunMock.mockResolvedValue({ data: { ok: true, result: {} } });
});

describe('shared terminal (S14)', () => {
  it('a typed line appears in the sender\'s own log and the activity callback fires', async () => {
    const onTerminalLine = vi.fn();
    render(<SharedDebugTerminalTile code="SESS1" onTerminalLine={onTerminalLine} />);
    const input = screen.getByPlaceholderText(/Type and Enter to broadcast/);
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('ls -la')).toBeTruthy();
    expect(screen.getByText('1 lines')).toBeTruthy();
    expect(onTerminalLine).toHaveBeenCalledWith('ls -la');
    expect((input as HTMLInputElement).value).toBe('');
  });
});

describe('DM reviewer resolution (S14)', () => {
  async function fillAndDm() {
    render(<CodeActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Reviewer username or user id'), { target: { value: 'concordosdev' } });
    const codeBoxes = document.querySelectorAll('textarea');
    fireEvent.change(codeBoxes[0], { target: { value: 'function f() { return 1; }' } });
    fireEvent.click(screen.getByRole('button', { name: /DM reviewer/ }));
  }

  it('resolves a username to the canonical id before posting', async () => {
    apiGetMock.mockResolvedValue({ data: { ok: true, user: { id: 'user-123', username: 'concordosdev' } } });
    apiPostMock.mockResolvedValue({ data: { ok: true, message: { id: 'm1' } } });
    await fillAndDm();
    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(apiGetMock).toHaveBeenCalledWith('/api/social/users/by-username/concordosdev');
    expect(apiPostMock.mock.calls[0][1]).toMatchObject({ toUserId: 'user-123' });
    expect(await screen.findByText(/Sent to concordosdev\./)).toBeTruthy();
  });

  it('a genuine miss renders ONE specific reason, not the raw duplicated string', async () => {
    apiGetMock.mockRejectedValue(new Error('404'));
    apiPostMock.mockResolvedValue({ data: { ok: false, error: 'recipient not found' } });
    await fillAndDm();
    const note = await screen.findByText(/No user matches "concordosdev" — check the username, or use their user id\./);
    expect(note).toBeTruthy();
    expect(screen.queryByText(/not found not found/)).toBeNull();
  });
});
