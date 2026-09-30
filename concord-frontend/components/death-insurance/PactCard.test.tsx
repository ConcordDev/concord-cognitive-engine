/**
 * PactCard — a single pact card, tested directly (the death-insurance lens
 * tests mock this component out to isolate the page's own state machine,
 * so its real render + action wiring wasn't exercised anywhere). Pins:
 *   - real data renders (payout, beneficiaries, premium, handshake status)
 *   - renew/auto-renew/pay-premium/revoke each call the real lensRun
 *     ('insurance', <macro>, ...) with the right params
 *   - a defensive-guard regression: an empty beneficiaries array (the real
 *     bug fixed alongside this file) doesn't crash the render
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PactCard } from './PactCard';
import type { Pact } from './types';

const BASE_PACT: Pact = {
  id: 'pct_abc123',
  insuredUserId: 'u1',
  beneficiaries: [
    { userId: 'u2_beneficiary', sharePct: 60, accepted: true, respondedAt: 1700000000 },
    { userId: 'u3_beneficiary', sharePct: 40, accepted: false, respondedAt: null },
  ],
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
  onChanged.mockReset();
});

describe('PactCard', () => {
  it('renders real pact data — payout, beneficiaries, premium, handshake status', () => {
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);
    expect(screen.getByText(/5000 ⚡ payout/)).toBeInTheDocument();
    expect(screen.getByText(/pct_abc123/)).toBeInTheDocument();
    expect(screen.getByText(/u2_beneficiary/)).toBeInTheDocument();
    expect(screen.getByText(/u3_beneficiary/)).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText(/handshake 1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/premium 100 ⚡ monthly/)).toBeInTheDocument();
  });

  it('handles an empty beneficiaries array without crashing (real defensive-guard regression)', () => {
    const pact = { ...BASE_PACT, beneficiaries: [] };
    render(<PactCard pact={pact} onChanged={onChanged} />);
    expect(screen.getByText(/5000 ⚡ payout/)).toBeInTheDocument();
    expect(screen.getByText(/handshake 0\/0/)).toBeInTheDocument();
  });

  it('Renew calls lensRun(insurance, pact-renew, ...) with the entered duration and reports success', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true } });
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);

    const daysInput = screen.getByLabelText('Renewal days');
    fireEvent.change(daysInput, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^Renew$/i }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-renew', { pactId: 'pct_abc123', durationDays: 30 }),
    );
    await waitFor(() => expect(screen.getByText('Pact renewed.')).toBeInTheDocument());
    expect(onChanged).toHaveBeenCalled();
  });

  it('toggles auto-renew via pact-set-auto-renew', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true } });
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /Enable auto-renew/i }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-set-auto-renew', { pactId: 'pct_abc123', autoRenew: true }),
    );
    await waitFor(() => expect(screen.getByText('Auto-renew on.')).toBeInTheDocument());
  });

  it('pays the premium via pact-pay-premium (hidden for upfront-frequency pacts)', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true } });
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /Pay 100 ⚡ premium/i }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-pay-premium', { pactId: 'pct_abc123' }),
    );
    await waitFor(() => expect(screen.getByText('Paid 100 ⚡ premium.')).toBeInTheDocument());

    // upfront-frequency pacts don't show a pay-premium button at all.
    const upfrontPact = { ...BASE_PACT, premiumFrequency: 'upfront' as const };
    render(<PactCard pact={upfrontPact} onChanged={onChanged} />);
    expect(screen.queryAllByRole('button', { name: /Pay .* premium/i }).length).toBe(1); // only the first render's button
  });

  it('revokes an active pact via pact-revoke', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true } });
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('insurance', 'pact-revoke', { pactId: 'pct_abc123' }),
    );
    await waitFor(() => expect(screen.getByText('Pact revoked.')).toBeInTheDocument());
  });

  it('surfaces the real backend error reason on a rejected action, without a fabricated success', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'not the insured party' } });
    render(<PactCard pact={BASE_PACT} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));
    await waitFor(() => expect(screen.getByText('not the insured party')).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('revoked/fired pacts show no action row (only active/expired do)', () => {
    render(<PactCard pact={{ ...BASE_PACT, status: 'revoked' }} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: /^Renew$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/i })).not.toBeInTheDocument();
  });
});
