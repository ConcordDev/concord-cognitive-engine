import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { SessionRail } from '@/components/lens/SessionRail';

describe('SessionRail — canonical lensRun path', () => {
  beforeEach(() => lensRun.mockReset());

  it('fetches open + paused sessions through sessions.list_mine and renders rows', async () => {
    lensRun.mockImplementation((_domain: string, _macro: string, input: Record<string, unknown>) => {
      const status = input?.status;
      const session = status === 'open'
        ? { id: 's1', lensId: 'forge', title: 'Forge session', status: 'open', currentStep: null, stepCount: 0, createdAt: 1, updatedAt: 2, closedAt: null }
        : { id: 's2', lensId: 'forge', title: 'Paused Forge session', status: 'paused', currentStep: null, stepCount: 0, createdAt: 3, updatedAt: 4, closedAt: null };
      return Promise.resolve({ data: { ok: true, result: { ok: true, sessions: [session] } } });
    });
    render(<SessionRail lensId="forge" hideWhenEmpty={false} />);
    await waitFor(() => expect(screen.getByText('Forge session')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Paused Forge session')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('sessions', 'list_mine', expect.objectContaining({ lensId: 'forge', status: 'open' }));
    expect(lensRun).toHaveBeenCalledWith('sessions', 'list_mine', expect.objectContaining({ lensId: 'forge', status: 'paused' }));
  });

  it('degrades silently when sessions.list_mine fails', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: false, reason: 'no_user' } } });
    render(<SessionRail lensId="forge" hideWhenEmpty={false} />);
    await waitFor(() => expect(screen.getByText(/fetch_failed|no_user/)).toBeInTheDocument());
  });
});
