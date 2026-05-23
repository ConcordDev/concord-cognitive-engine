import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { VendorsPanel } from '@/components/accounting/VendorsPanel';

const VENDORS = [
  { id: 'v1', number: 'VEND-1', name: 'Acme', email: 'a@x.com', phone: '555-1', taxId: '99-1', is1099: true, defaultExpenseAccountId: 'a1', paymentTerms: 'net30', notes: '' },
  { id: 'v2', number: 'VEND-2', name: 'Globex', email: '', phone: '', taxId: '', is1099: false, defaultExpenseAccountId: '', paymentTerms: 'net15', notes: '' },
];
const ACCOUNTS = [
  { id: 'a1', code: '6000', name: 'Supplies', category: 'expense', archived: false },
  { id: 'a2', code: '5000', name: 'COGS', category: 'cogs', archived: false },
  { id: 'a3', code: '1000', name: 'Cash', category: 'asset', archived: false },
];

function wire(opts: { vendors?: unknown; accounts?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'vendors-list') return Promise.resolve({ data: { ok: true, result: { vendors: opts.vendors ?? VENDORS } } });
    if (spec.action === 'coa-list') return Promise.resolve({ data: { ok: true, result: { accounts: opts.accounts ?? ACCOUNTS } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('VendorsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<VendorsPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no vendors', async () => {
    wire({ vendors: [] });
    render(<VendorsPanel />);
    expect(await screen.findByText('No vendors yet.')).toBeInTheDocument();
  });

  it('renders vendors with a 1099 badge and the count summary', async () => {
    wire();
    render(<VendorsPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('2 · 1 1099')).toBeInTheDocument();
    expect(screen.getAllByText('1099').length).toBeGreaterThan(0);
    expect(screen.getByText('Net 30')).toBeInTheDocument();
  });

  it('toggles the create form and does not save with a blank name', async () => {
    wire();
    render(<VendorsPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByPlaceholderText('Vendor name *')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save vendor'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'vendors-create' })),
    );
  });

  it('creates a vendor, including toggling the 1099 checkbox', async () => {
    wire();
    render(<VendorsPanel />);
    await screen.findByText('Acme');
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Vendor name *'), { target: { value: 'Initech' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save vendor'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vendors-create', input: expect.objectContaining({ name: 'Initech', is1099: true }) }),
      ),
    );
  });

  it('deletes a vendor when confirm is accepted', async () => {
    wire();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VendorsPanel />);
    await screen.findByText('Acme');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'vendors-delete' })),
    );
  });

  it('does not delete a vendor when confirm is cancelled', async () => {
    wire();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<VendorsPanel />);
    await screen.findByText('Acme');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'vendors-delete' })),
    );
  });
});
