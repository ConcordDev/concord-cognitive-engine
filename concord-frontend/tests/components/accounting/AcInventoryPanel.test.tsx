import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcInventoryPanel } from '@/components/accounting/AcInventoryPanel';

const ITEMS = [
  { id: 'i1', name: 'Widget', type: 'inventory', sku: 'W-1', price: 20, cost: 8, qtyOnHand: 2, reorderPoint: 5 },
  { id: 'i2', name: 'Gadget', type: 'inventory', sku: null, price: 50, cost: 25, qtyOnHand: 100, reorderPoint: 5 },
  { id: 'i3', name: 'Consulting', type: 'service', sku: null, price: 150, cost: 0, qtyOnHand: null, reorderPoint: null },
];

function wire(opts: { items?: unknown; low?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'item-list') return Promise.resolve({ data: { ok: true, result: { items: opts.items ?? ITEMS } } });
    if (spec.action === 'inventory-low-stock') return Promise.resolve({ data: { ok: true, result: opts.low ?? { count: 1, inventoryValue: 2540 } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('AcInventoryPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcInventoryPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the empty state when no items exist', async () => {
    wire({ items: [], low: { count: 0, inventoryValue: 0 } });
    render(<AcInventoryPanel />);
    expect(await screen.findByText('No items yet.')).toBeInTheDocument();
  });

  it('renders stats and a low-stock alert icon for under-reorder items', async () => {
    wire();
    render(<AcInventoryPanel />);
    expect(await screen.findByText('$2,540')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('Consulting')).toBeInTheDocument();
    // Widget is low stock (2 <= 5)
    expect(screen.getByText('2 on hand')).toBeInTheDocument();
    expect(screen.getByText('100 on hand')).toBeInTheDocument();
  });

  it('shows the inventory-only fields and hides them for service type', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    // Qty/reorder fields appear because default form.type is inventory
    expect(screen.getByPlaceholderText('Qty on hand')).toBeInTheDocument();
    // change to service hides them
    const typeSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(typeSelect, { target: { value: 'service' } });
    expect(screen.queryByPlaceholderText('Qty on hand')).toBeNull();
  });

  it('does not add an item with a blank name', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'item-create' })),
    );
  });

  it('adds an item with a name entered', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Bolt' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'item-create', input: expect.objectContaining({ name: 'Bolt', price: 3 }) }),
      ),
    );
  });

  it('does not adjust stock when delta is empty/zero', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    const adjustBtns = screen.getAllByText('adjust');
    fireEvent.click(adjustBtns[0]);
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'item-adjust-stock' })),
    );
  });

  it('adjusts stock with a non-zero delta', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    const deltaInputs = screen.getAllByPlaceholderText('±');
    fireEvent.change(deltaInputs[0], { target: { value: '10' } });
    fireEvent.click(screen.getAllByText('adjust')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'item-adjust-stock', input: { id: 'i1', delta: 10 } }),
      ),
    );
  });

  it('deletes an item via the trash button', async () => {
    wire();
    render(<AcInventoryPanel />);
    await screen.findByText('Widget');
    // delete buttons are the only buttons with no text inside list rows; use last in row 1
    const rows = screen.getAllByRole('listitem');
    const delBtn = rows[0].querySelectorAll('button');
    fireEvent.click(delBtn[delBtn.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'item-delete' })),
    );
  });
});
