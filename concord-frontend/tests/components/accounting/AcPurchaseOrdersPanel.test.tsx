import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcPurchaseOrdersPanel } from '@/components/accounting/AcPurchaseOrdersPanel';

const VENDORS = [
  { id: 'v1', name: 'Acme' },
  { id: 'v2', name: 'Globex' },
];
const POS = [
  { id: 'p1', number: 'PO-1', vendorName: 'Acme', lines: [{ description: 'Bolts', qty: 100, unitCost: 1 }], total: 100, status: 'open' },
  { id: 'p2', number: 'PO-2', vendorName: 'Globex', lines: [{ description: 'Nuts', qty: 50, unitCost: 2 }], total: 100, status: 'received' },
];

function wire(opts: { pos?: unknown; vendors?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'po-list') return Promise.resolve({ data: { ok: true, result: { purchaseOrders: opts.pos ?? POS } } });
    if (spec.action === 'vendors-list') return Promise.resolve({ data: { ok: true, result: { vendors: opts.vendors ?? VENDORS } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('AcPurchaseOrdersPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcPurchaseOrdersPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders POs with open and received statuses', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    expect(await screen.findByText('PO-1')).toBeInTheDocument();
    expect(screen.getByText('PO-2')).toBeInTheDocument();
    expect(screen.getByText('Receive')).toBeInTheDocument(); // open PO has a Receive button
    expect(screen.getByText('received')).toBeInTheDocument(); // received PO shows status label
    expect(screen.getByText('100× Bolts')).toBeInTheDocument();
  });

  it('renders the no-purchase-orders empty state', async () => {
    wire({ pos: [] });
    render(<AcPurchaseOrdersPanel />);
    expect(await screen.findByText('No purchase orders.')).toBeInTheDocument();
  });

  it('does not create a PO without a vendor', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Screws' } });
    fireEvent.change(screen.getByPlaceholderText('Unit cost'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Create PO'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'po-create' })),
    );
  });

  it('does not create a PO with no valid lines', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByText('Create PO'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'po-create' })),
    );
  });

  it('creates a PO with a vendor and a valid line', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Screws' } });
    fireEvent.change(screen.getByPlaceholderText('Unit cost'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Create PO'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'po-create', input: expect.objectContaining({ vendorId: 'v1' }) }),
      ),
    );
  });

  it('adds another line row when "+ line" is clicked', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    expect(screen.getAllByPlaceholderText('Description')).toHaveLength(1);
    fireEvent.click(screen.getByText('+ line'));
    expect(screen.getAllByPlaceholderText('Description')).toHaveLength(2);
  });

  it('receives an open purchase order', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByText('Receive'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'po-receive', input: { id: 'p1' } }),
      ),
    );
  });

  it('deletes a purchase order', async () => {
    wire();
    render(<AcPurchaseOrdersPanel />);
    await screen.findByText('PO-1');
    const rows = screen.getAllByRole('listitem');
    const btns = rows[0].querySelectorAll('button');
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'po-delete' })),
    );
  });
});
