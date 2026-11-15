/**
 * FIX-bounties-001 — a posted bounty gains owner lifecycle exits:
 * edit (pre-submission), cancel (two-step, with the no-escrow note in
 * words), and delete once cancelled. Pins:
 *  - Edit opens a form; Save sends bounties/update with the new title.
 *  - Cancel: the arm click fires nothing; the confirm sends
 *    bounties/cancel; the "nothing to refund" note is rendered.
 *  - A cancelled bounty offers Delete (two-step) → bounties/delete →
 *    onRemoved(id).
 *  - A non-owner sees none of the owner lifecycle controls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { BountyCard } from '@/components/bounties/BountyCard';
import type { PlatformBounty } from '@/components/bounties/types';

const BASE: PlatformBounty = {
  id: 'bty_1',
  title: 'Fix the flaky widget test',
  description: 'The widget test fails one run in five; find and fix the race.',
  ownerId: 'u1',
  category: 'bug',
  tags: ['ci'],
  difficulty: 'intermediate',
  rewardCc: 50,
  poolCc: 50,
  paidCc: 0,
  status: 'open',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deadline: null,
  milestones: [],
  submissions: [],
  submissionCount: 0,
  acceptedSubmissionId: null,
  dispute: null,
};

const onChanged = vi.fn();
const onRemoved = vi.fn();

beforeEach(() => {
  lensRunMock.mockReset();
  onChanged.mockReset();
  onRemoved.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string, input: Record<string, unknown>) => {
    if (action === 'update') return { data: { ok: true, result: { bounty: { ...BASE, title: String(input.title) } } } };
    if (action === 'cancel') return { data: { ok: true, result: { bounty: { ...BASE, status: 'cancelled' } } } };
    if (action === 'delete') return { data: { ok: true, result: { deleted: true, bountyId: 'bty_1' } } };
    return { data: { ok: true, result: {} } };
  });
});

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /Details/ }));
}

describe('FIX-bounties-001 owner lifecycle', () => {
  it('edit opens a form and Save sends bounties/update', async () => {
    render(<BountyCard bounty={BASE} currentUserId="u1" onChanged={onChanged} onRemoved={onRemoved} />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: /Edit bounty/ }));
    const title = screen.getByLabelText('Edit bounty title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Fix the flaky gadget test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('bounties', 'update', expect.objectContaining({ bountyId: 'bty_1', title: 'Fix the flaky gadget test' })),
    );
  });

  it('cancel is two-step and carries the no-escrow note', async () => {
    render(<BountyCard bounty={BASE} currentUserId="u1" onChanged={onChanged} onRemoved={onRemoved} />);
    expand();
    expect(screen.getByText(/nothing to refund/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel bounty' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel bounty' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('bounties', 'cancel', { bountyId: 'bty_1' }),
    );
  });

  it('a cancelled bounty deletes behind a confirm and reports removal', async () => {
    render(<BountyCard bounty={{ ...BASE, status: 'cancelled' }} currentUserId="u1" onChanged={onChanged} onRemoved={onRemoved} />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: 'Delete bounty' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete bounty' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('bounties', 'delete', { bountyId: 'bty_1' }),
    );
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('bty_1'));
  });

  it('a non-owner sees no owner lifecycle controls', () => {
    render(<BountyCard bounty={BASE} currentUserId="u2" onChanged={onChanged} onRemoved={onRemoved} />);
    expand();
    expect(screen.queryByRole('button', { name: /Edit bounty/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel bounty' })).not.toBeInTheDocument();
  });
});
