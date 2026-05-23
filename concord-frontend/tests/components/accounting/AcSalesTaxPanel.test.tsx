import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcSalesTaxPanel } from '@/components/accounting/AcSalesTaxPanel';

const CODES = [
  { id: 'c1', name: 'CA', rate: 7.25 },
  { id: 'c2', name: 'NY', rate: 8 },
];

function wire(opts: { codes?: unknown; liability?: number } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'tax-code-list') return Promise.resolve({ data: { ok: true, result: { taxCodes: opts.codes ?? CODES } } });
    if (spec.action === 'tax-liability') return Promise.resolve({ data: { ok: true, result: { salesTaxPayable: opts.liability ?? 1200 } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('AcSalesTaxPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcSalesTaxPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders liability and tax codes when populated', async () => {
    wire();
    render(<AcSalesTaxPanel />);
    expect(await screen.findByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('CA')).toBeInTheDocument();
    expect(screen.getByText('7.25%')).toBeInTheDocument();
    expect(screen.getByText('NY')).toBeInTheDocument();
  });

  it('renders the no-tax-codes empty state', async () => {
    wire({ codes: [], liability: 0 });
    render(<AcSalesTaxPanel />);
    expect(await screen.findByText('No tax codes.')).toBeInTheDocument();
  });

  it('does not add a tax code with a blank name', async () => {
    wire();
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'tax-code-create' })),
    );
  });

  it('adds a tax code with a name entered', async () => {
    wire();
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    fireEvent.change(screen.getByPlaceholderText('Code name (e.g. CA)'), { target: { value: 'TX' } });
    fireEvent.change(screen.getByPlaceholderText('Rate %'), { target: { value: '6.25' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tax-code-create', input: { name: 'TX', rate: 6.25 } }),
      ),
    );
  });

  it('does not record a payment for a non-positive amount', async () => {
    wire();
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    fireEvent.click(screen.getByText('Record payment'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'tax-payment-record' })),
    );
  });

  it('records a successful payment and shows the success note', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'tax-code-list') return Promise.resolve({ data: { ok: true, result: { taxCodes: CODES } } });
      if (spec.action === 'tax-liability') return Promise.resolve({ data: { ok: true, result: { salesTaxPayable: 1200 } } });
      if (spec.action === 'tax-payment-record') return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    fireEvent.change(screen.getByPlaceholderText('Amount paid'), { target: { value: '500' } });
    fireEvent.click(screen.getByText('Record payment'));
    expect(await screen.findByText(/Recorded \$500 remittance/)).toBeInTheDocument();
  });

  it('shows the error note when the payment fails', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'tax-code-list') return Promise.resolve({ data: { ok: true, result: { taxCodes: CODES } } });
      if (spec.action === 'tax-liability') return Promise.resolve({ data: { ok: true, result: { salesTaxPayable: 1200 } } });
      if (spec.action === 'tax-payment-record') return Promise.resolve({ data: { ok: false, error: 'over-remitted' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    fireEvent.change(screen.getByPlaceholderText('Amount paid'), { target: { value: '999' } });
    fireEvent.click(screen.getByText('Record payment'));
    expect(await screen.findByText('over-remitted')).toBeInTheDocument();
  });

  it('deletes a tax code', async () => {
    wire();
    render(<AcSalesTaxPanel />);
    await screen.findByText('CA');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'tax-code-delete' })),
    );
  });
});
