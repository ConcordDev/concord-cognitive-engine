import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-insurance-004: FNOL intakes, commission statements
// and reminders gain deletes behind confirmations; carrier removal
// gains a confirmation.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { AmsWorkbench } from '@/components/insurance/AmsWorkbench';
import { InsuranceVaultPanel } from '@/components/insurance/InsuranceVaultPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('insurance deletes (FIX-insurance-004)', () => {
  it('carrier removal arms first — nothing fires until the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'policy-list') return ok({ policies: [] });
      if (action === 'carrier-list') return ok({
        carriers: [{ id: 'c1', name: 'Acme Mutual', amBestRating: 'A', lines: ['home'], baseCommissionPct: 12, rateIndex: 1, claimsServiceScore: 8 }],
      });
      return ok({});
    });
    render(<AmsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove carrier Acme Mutual' }));
    expect(calls('carrier-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove carrier' }));
    await waitFor(() => expect(calls('carrier-delete')).toHaveLength(1));
    expect(calls('carrier-delete')[0][2]).toMatchObject({ id: 'c1' });
  });

  it('FNOL rows delete via fnol-delete behind the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'policy-list') return ok({ policies: [] });
      if (action === 'carrier-list') return ok({ carriers: [] });
      if (action === 'fnol-list') return ok({
        fnol: [{
          id: 'f1', severity: 'standard', lossType: 'property', lossDate: '2026-11-01', injuries: false,
          routedTo: 'general_claims', description: 'Kitchen fire', estimatedLoss: 5000,
          assignedAdjuster: null, sla: { contactByHours: 24 }, status: 'open',
        }],
      });
      return ok({});
    });
    render(<AmsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /FNOL Intake/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete FNOL' }));
    expect(calls('fnol-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete FNOL' }));
    await waitFor(() => expect(calls('fnol-delete')).toHaveLength(1));
    expect(calls('fnol-delete')[0][2]).toMatchObject({ id: 'f1' });
  });

  it('statements delete via statement-delete behind the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'policy-list') return ok({ policies: [] });
      if (action === 'carrier-list') return ok({ carriers: [] });
      if (action === 'statement-list') return ok({
        statements: [{ id: 's1', carrier: 'Acme', period: '2026-10', lines: [{ policyNumber: 'P-1', premium: 100, commission: 10 }], statedTotal: 10, reconciled: false }],
      });
      return ok({});
    });
    render(<AmsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Commission Recon/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete statement Acme 2026-10' }));
    expect(calls('statement-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete statement' }));
    await waitFor(() => expect(calls('statement-delete')).toHaveLength(1));
    expect(calls('statement-delete')[0][2]).toMatchObject({ id: 's1' });
  });

  it('vault reminders delete via reminder-delete behind the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'agent-list') return ok({ agents: [] });
      if (action === 'asset-list') return ok({ assets: [], totalValue: 0 });
      if (action === 'reminder-list') return ok({
        reminders: [{ id: 'r1', title: 'Renewal due', kind: 'renewal', dueDate: '2026-12-01', done: false, status: 'upcoming' }],
        overdue: 0, dueSoon: 0,
      });
      return ok({});
    });
    render(<InsuranceVaultPanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete reminder Renewal due' }));
    expect(calls('reminder-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete reminder' }));
    await waitFor(() => expect(calls('reminder-delete')).toHaveLength(1));
    expect(calls('reminder-delete')[0][2]).toMatchObject({ id: 'r1' });
  });
});
