/** SyncedBranchesSection — lists account-saved branches, opens one, deletes one. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { SyncedBranchesSection } from '@/components/chat/SyncedBranchesSection';

const BRANCH = {
  id: 'br1', sourceThreadId: 't1', atMessageIdx: 1, note: '',
  seededMessages: [{ role: 'user', content: 'How do tides work?' }, { role: 'assistant', content: 'The moon pulls the oceans' }],
  createdAt: '2026-10-03T12:00:00Z',
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) =>
    Promise.resolve({ data: { ok: true, result: action === 'branches-list' ? { branches: [BRANCH] } : { deleted: 'br1' } } }));
});

describe('SyncedBranchesSection', () => {
  it('loads on expand and opens a branch with its seeded messages', async () => {
    const onOpen = vi.fn();
    render(<SyncedBranchesSection onOpen={onOpen} />);
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /synced branches/i }));
    fireEvent.click(await screen.findByText('The moon pulls the oceans'));
    expect(onOpen).toHaveBeenCalledWith(BRANCH);
    expect(screen.getByText(/2 messages/)).toBeTruthy();
  });

  it('deletes a branch through branch-delete', async () => {
    render(<SyncedBranchesSection onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /synced branches/i }));
    fireEvent.click(await screen.findByRole('button', { name: /delete synced branch/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('chat', 'branch-delete', { id: 'br1' }));
    expect(screen.queryByText('The moon pulls the oceans')).toBeNull();
  });
});
