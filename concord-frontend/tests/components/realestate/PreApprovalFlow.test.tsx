import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PreApprovalFlow } from '@/components/realestate/PreApprovalFlow';

const LENDERS = [
  { id: 'le1', name: 'First Bank', loanType: 'conventional', quotedRate: 6.5, phone: '', email: 'a@b.c', nmlsId: '123' },
  { id: 'le2', name: 'Vet Loans', loanType: 'va', quotedRate: 0, phone: '', email: '', nmlsId: '' },
];
const PREAPPROVALS = [
  { id: 'pa1', lenderName: 'First Bank', loanType: 'conventional', creditScore: 760, creditTier: 'excellent', rate: 6.5, maxLoanAmount: 480000, maxHomePrice: 600000, maxMonthlyPayment: 3200, status: 'approved', requestedAt: '2026-05-01', expiresAt: '2026-08-01' },
  { id: 'pa2', lenderName: 'Vet Loans', loanType: 'va', creditScore: 640, creditTier: 'fair', rate: 7.1, maxLoanAmount: 300000, maxHomePrice: 320000, maxMonthlyPayment: 2100, status: 'conditional', requestedAt: '2026-05-02', expiresAt: '2026-08-02' },
];

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('PreApprovalFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { lenders: [], preapprovals: [] } } });
  });

  it('shows empty states for lenders and pre-approvals', async () => {
    render(<PreApprovalFlow />);
    expect(await screen.findByText('No lenders yet. Add one to request a pre-approval.')).toBeInTheDocument();
    expect(screen.getByText('No pre-approvals yet.')).toBeInTheDocument();
  });

  it('renders lenders and pre-approval letters when populated', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: LENDERS } } };
      return { data: { ok: true, result: { preapprovals: PREAPPROVALS } } };
    });
    render(<PreApprovalFlow />);
    expect((await screen.findAllByText('First Bank'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Vet Loans').length).toBeGreaterThan(0);
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('conditional')).toBeInTheDocument();
    expect(screen.getByText('$600,000')).toBeInTheDocument();
  });

  it('adds a lender through the form', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: [] } } };
      if (action === 'preapprovals-list') return { data: { ok: true, result: { preapprovals: [] } } };
      return { data: { ok: true } };
    });
    render(<PreApprovalFlow />);
    await screen.findByText('No lenders yet. Add one to request a pre-approval.');
    const plus = document.querySelectorAll('button');
    fireEvent.click(plus[0]);
    fireEvent.change(screen.getByPlaceholderText('Lender name'), { target: { value: 'New Lender' } });
    fireEvent.change(screen.getByPlaceholderText('Rate %'), { target: { value: '6.25' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lenders-add', input: expect.objectContaining({ name: 'New Lender', quotedRate: 6.25 }) }),
      ),
    );
  });

  it('surfaces an error when add lender fails', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: [] } } };
      if (action === 'preapprovals-list') return { data: { ok: true, result: { preapprovals: [] } } };
      return { data: { ok: false, error: 'dup lender' } };
    });
    render(<PreApprovalFlow />);
    await screen.findByText('No lenders yet. Add one to request a pre-approval.');
    fireEvent.click(document.querySelectorAll('button')[0]);
    fireEvent.change(screen.getByPlaceholderText('Lender name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText('dup lender')).toBeInTheDocument();
  });

  it('validates required fields before requesting a pre-approval', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: LENDERS } } };
      return { data: { ok: true, result: { preapprovals: [] } } };
    });
    render(<PreApprovalFlow />);
    (await screen.findAllByText('First Bank'))[0];
    fireEvent.click(screen.getByRole('button', { name: /Get pre-approved/ }));
    expect(await screen.findByText('Lender, annual income, and credit score are required.')).toBeInTheDocument();
  });

  it('requests a pre-approval with valid inputs', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: LENDERS } } };
      if (action === 'preapprovals-list') return { data: { ok: true, result: { preapprovals: [] } } };
      return { data: { ok: true } };
    });
    render(<PreApprovalFlow />);
    (await screen.findAllByText('First Bank'))[0];
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'le1' } });
    fireEvent.change(screen.getByPlaceholderText('Annual income'), { target: { value: '120000' } });
    fireEvent.change(screen.getByPlaceholderText('Monthly debts'), { target: { value: '500' } });
    fireEvent.change(screen.getByPlaceholderText('Down payment'), { target: { value: '60000' } });
    fireEvent.change(screen.getByPlaceholderText('Credit score'), { target: { value: '760' } });
    fireEvent.click(screen.getByRole('button', { name: /Get pre-approved/ }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'preapproval-request',
          input: expect.objectContaining({ lenderId: 'le1', annualIncome: 120000, creditScore: 760, downPayment: 60000 }),
        }),
      ),
    );
  });

  it('surfaces an error when the pre-approval request fails', async () => {
    route((action) => {
      if (action === 'lenders-list') return { data: { ok: true, result: { lenders: LENDERS } } };
      if (action === 'preapprovals-list') return { data: { ok: true, result: { preapprovals: [] } } };
      return { data: { ok: false, error: 'rejected' } };
    });
    render(<PreApprovalFlow />);
    (await screen.findAllByText('First Bank'))[0];
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'le1' } });
    fireEvent.change(screen.getByPlaceholderText('Annual income'), { target: { value: '120000' } });
    fireEvent.change(screen.getByPlaceholderText('Credit score'), { target: { value: '760' } });
    fireEvent.click(screen.getByRole('button', { name: /Get pre-approved/ }));
    expect(await screen.findByText('rejected')).toBeInTheDocument();
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PreApprovalFlow />);
    expect(await screen.findByText('No lenders yet. Add one to request a pre-approval.')).toBeInTheDocument();
  });
});
