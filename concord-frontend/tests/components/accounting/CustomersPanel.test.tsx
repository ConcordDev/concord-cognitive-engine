import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CustomersPanel } from '@/components/accounting/CustomersPanel';

const CUSTOMERS = [
  { id: 'c1', number: 'CUST-1', name: 'Alice Co', email: 'a@x.com', phone: '555-1', company: 'Alice Inc', billingAddress: '', taxId: '99-1', notes: '' },
  { id: 'c2', number: 'CUST-2', name: 'Bob LLC', email: '', phone: '', company: '', billingAddress: '', taxId: '', notes: '' },
];

describe('CustomersPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<CustomersPanel />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no customers', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: [] } } });
    render(<CustomersPanel />);
    expect(await screen.findByText('No customers yet.')).toBeInTheDocument();
  });

  it('renders customers with and without optional fields', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: CUSTOMERS } } });
    render(<CustomersPanel />);
    expect(await screen.findByText('Alice Co')).toBeInTheDocument();
    expect(screen.getByText('· Alice Inc')).toBeInTheDocument();
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('Bob LLC')).toBeInTheDocument();
  });

  it('toggles the create form and does not save with a blank name', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: CUSTOMERS } } });
    render(<CustomersPanel />);
    await screen.findByText('Alice Co');
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByPlaceholderText('Customer name *')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save customer'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'customers-create' })),
    );
  });

  it('creates a customer with a name entered', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: CUSTOMERS } } });
    render(<CustomersPanel />);
    await screen.findByText('Alice Co');
    fireEvent.click(screen.getByText('New'));
    fireEvent.change(screen.getByPlaceholderText('Customer name *'), { target: { value: 'New Cust' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'n@x.com' } });
    fireEvent.click(screen.getByText('Save customer'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customers-create', input: expect.objectContaining({ name: 'New Cust' }) }),
      ),
    );
  });

  it('deletes a customer when the confirm dialog is accepted', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: CUSTOMERS } } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CustomersPanel />);
    await screen.findByText('Alice Co');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'customers-delete' })),
    );
  });

  it('does not delete a customer when the confirm dialog is cancelled', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { customers: CUSTOMERS } } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CustomersPanel />);
    await screen.findByText('Alice Co');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'customers-delete' })),
    );
  });

  it('survives a rejected list request', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<CustomersPanel />);
    expect(await screen.findByText('No customers yet.')).toBeInTheDocument();
  });
});
