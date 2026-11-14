// FIX-death-insurance-011 (GB-1539): the beneficiary handshake is a
// consequential choice — Accept / Decline (and reversing either) arm
// a confirm step that shows the terms (share, payout, expiry, what
// the choice means) and send nothing until confirmed.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: { domain: string; action: string; input: Record<string, unknown> }[] = [];
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((domain: string, action: string, input: Record<string, unknown>) => {
    calls.push({ domain, action, input });
    return Promise.resolve({ data: { ok: true, result: {} } });
  }),
}));

import { BeneficiaryPactCard } from '@/components/death-insurance/BeneficiaryPactCard';
import type { Pact } from '@/components/death-insurance/types';

function pactWith(myShare: Pact['myShare']): Pact {
  return {
    id: 'pact_1',
    insuredUserId: 'user_insured_abcdef',
    beneficiaries: [],
    payoutSparks: 1000,
    premiumSparks: 10,
    premiumFrequency: 'upfront',
    autoRenew: false,
    requireHandshake: true,
    writtenAt: 1762000000,
    durationDays: 30,
    expiresAt: 1764000000,
    armsAt: 1762000000,
    status: 'active',
    armed: false,
    renewCount: 0,
    premiumPaidSparks: 10,
    nextPremiumDueAt: null,
    myShare,
  };
}

describe('BeneficiaryPactCard confirm (FIX-death-insurance-011)', () => {
  beforeEach(() => { calls.length = 0; });

  it('Accept arms a terms-showing confirm; only Confirm sends the response', async () => {
    const onChanged = vi.fn();
    render(<BeneficiaryPactCard pact={pactWith({ sharePct: 25, accepted: false, respondedAt: null })} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(calls).toHaveLength(0);
    // Terms are shown before anything is sent.
    expect(screen.getByText(/Your share: 25% of 1000 ⚡ = 250 ⚡/)).toBeTruthy();
    expect(screen.getByText(/You can withdraw while the pact stays active/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm accept' }));
    await waitFor(() => expect(calls).toEqual([{ domain: 'insurance', action: 'pact-respond', input: { pactId: 'pact_1', accept: true } }]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('Decline arms too, and Keep deciding sends nothing', async () => {
    render(<BeneficiaryPactCard pact={pactWith({ sharePct: 25, accepted: false, respondedAt: null })} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Declining gives up your share for now/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep deciding' }));
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Confirm decline' })).toBeNull();
    // Back at the choice, Confirm decline does send.
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));
    await waitFor(() => expect(calls).toEqual([{ domain: 'insurance', action: 'pact-respond', input: { pactId: 'pact_1', accept: false } }]));
  });

  it("'Accept after all' (the reversal) also confirms first", async () => {
    render(<BeneficiaryPactCard pact={pactWith({ sharePct: 25, accepted: false, respondedAt: 1762100000 })} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept after all' }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/Your share: 25% of 1000 ⚡ = 250 ⚡/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm accept' }));
    await waitFor(() => expect(calls).toEqual([{ domain: 'insurance', action: 'pact-respond', input: { pactId: 'pact_1', accept: true } }]));
  });
});
