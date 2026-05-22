import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { InsurancePanel } from '@/components/healthcare/InsurancePanel';

const policies = [
  { id: 'pol1', patientId: 'p1', payer: 'BlueCross', memberId: 'M1', groupNumber: 'G1', planName: 'Gold',
    planType: 'PPO', copayUsd: 25, deductibleUsd: 1000, deductibleMetUsd: 200, effectiveDate: '2026-01-01',
    eligibilityStatus: 'active', verifiedAt: null },
];
const claims = [
  { id: 'c1', claimNumber: 'CLM-1', patientId: 'p1', encounterId: 'e1', coverageId: 'pol1',
    diagnosisCodes: ['E11.9'], lines: [{ cpt: '99213', description: 'Visit', units: 1, chargeUsd: 150 }],
    totalChargeUsd: 150, allowedUsd: null, paidUsd: null, patientResponsibilityUsd: null,
    status: 'draft', denialReason: '', submittedAt: null, adjudicatedAt: null },
  { id: 'c2', claimNumber: 'CLM-2', patientId: 'p1', encounterId: 'e2', coverageId: 'pol1',
    diagnosisCodes: [], lines: [{ cpt: '99214', description: 'Visit', units: 1, chargeUsd: 200 }],
    totalChargeUsd: 200, allowedUsd: null, paidUsd: null, patientResponsibilityUsd: 50,
    status: 'submitted', denialReason: '', submittedAt: '2026-05-01', adjudicatedAt: null },
];

function mockLists(pol: unknown[], cl: unknown[], outstanding = 0) {
  lensRun.mockImplementation((d: string, a: string) => {
    if (a === 'coverage-list') return Promise.resolve({ data: { ok: true, result: { policies: pol } } });
    if (a === 'claim-list') return Promise.resolve({ data: { ok: true, result: { claims: cl, outstandingUsd: outstanding } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('InsurancePanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty states', async () => {
    mockLists([], []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No coverage on file/)).toBeInTheDocument());
    expect(screen.getByText(/No claims yet/)).toBeInTheDocument();
  });

  it('renders policies, claims and an outstanding balance', async () => {
    mockLists(policies, claims, 50);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('BlueCross')).toBeInTheDocument());
    expect(screen.getByText('CLM-1')).toBeInTheDocument();
    expect(screen.getByText('CLM-2')).toBeInTheDocument();
    expect(screen.getByText(/outstanding \$50.00/)).toBeInTheDocument();
  });

  it('toggles the add-policy form and does not save when blank', async () => {
    mockLists([], []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No coverage on file/));
    fireEvent.click(screen.getByRole('button', { name: /Add policy/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('adds a policy when payer and member id are provided', async () => {
    mockLists([], []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No coverage on file/));
    fireEvent.click(screen.getByRole('button', { name: /Add policy/ }));
    fireEvent.change(screen.getByPlaceholderText(/Payer/), { target: { value: 'Aetna' } });
    fireEvent.change(screen.getByPlaceholderText(/Member ID/), { target: { value: 'A100' } });
    fireEvent.change(screen.getByPlaceholderText(/Copay/), { target: { value: '20' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'coverage-add')).toBe(true));
  });

  it('verifies eligibility on a policy', async () => {
    mockLists(policies, []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText('BlueCross'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Verify eligibility/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'coverage-verify')).toBe(true));
  });

  it('creates a claim with line items and removes a line', async () => {
    mockLists([], []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No claims yet/));
    fireEvent.click(screen.getByRole('button', { name: /New claim/ }));
    fireEvent.click(screen.getByRole('button', { name: /\+ Line item/ }));
    // two line rows now -> two remove buttons; remove the second.
    const removeButtons = screen.getAllByLabelText('Remove line');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[1]);
    fireEvent.change(screen.getAllByPlaceholderText('CPT *')[0], { target: { value: '99213' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Create draft/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'claim-create')).toBe(true));
  });

  it('does not create a claim when no line has a CPT', async () => {
    mockLists([], []);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No claims yet/));
    fireEvent.click(screen.getByRole('button', { name: /New claim/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Create draft/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('submits a draft claim', async () => {
    mockLists([], claims);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText('CLM-1'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'claim-submit')).toBe(true));
  });

  it('adjudicates a submitted claim', async () => {
    mockLists([], claims);
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => screen.getByText('CLM-2'));
    fireEvent.click(screen.getByRole('button', { name: /Adjudicate/ }));
    fireEvent.change(screen.getByPlaceholderText(/Allowed/), { target: { value: '150' } });
    fireEvent.change(screen.getByPlaceholderText(/^Paid/), { target: { value: '120' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Post/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'claim-adjudicate')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<InsurancePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No coverage on file/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
