/**
 * FIX-death-insurance-007 — Revoke gains a two-step confirm, and a
 * revoked pact can be removed from the writer's list (pact-remove).
 * Pins:
 *  - Revoke: the arm click fires nothing; Cancel disarms; Confirm
 *    fires pact-revoke.
 *  - A revoked pact renders a Remove control (two-step) that fires
 *    pact-remove on confirm.
 *  - An active pact renders no Remove control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PactCard } from '@/components/death-insurance/PactCard';
import type { Pact } from '@/components/death-insurance/types';

const BASE_PACT: Pact = {
  id: 'pct_abc123',
  insuredUserId: 'u1',
  beneficiaries: [{ userId: 'u2_beneficiary', sharePct: 100, accepted: true, respondedAt: 1700000000 }],
  payoutSparks: 5000,
  premiumSparks: 100,
  premiumFrequency: 'monthly',
  autoRenew: false,
  requireHandshake: true,
  writtenAt: 1700000000,
  durationDays: 90,
  expiresAt: 1700090000,
  armsAt: 1700000100,
  status: 'active',
  armed: true,
  renewCount: 0,
  premiumPaidSparks: 100,
  nextPremiumDueAt: 1700500000,
};

const onChanged = vi.fn();

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({ data: { ok: true } });
  onChanged.mockReset();
});

describe('FIX-death-insurance-007 pact lifecycle exits', () => {
  it('revoke is two-step: arm fires nothing, cancel disarms, confirm fires pact-revoke', async () => {
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke pact' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel revoke' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).not.toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke pact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-revoke', { pactId: 'pct_abc123' }),
    );
  });

  it('a revoked pact can be removed behind a two-step confirm (pact-remove)', async () => {
    render(<PactCard pact={{ ...BASE_PACT, status: 'revoked' }} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove pact' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-remove', { pactId: 'pct_abc123' }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('an active pact has no Remove control', () => {
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: 'Remove pact' })).not.toBeInTheDocument();
  });
});
