import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { OrdersPanel } from '@/components/marketplace/OrdersPanel';

const ORDERS = [
  {
    id: 'o1', number: 'ORD-1', listingTitle: 'Brass Ring', listingKind: 'physical_good',
    qty: 1, unitPriceUsd: 12, subtotalUsd: 12, shippingUsd: 2, totalUsd: 14,
    buyerName: 'Alice', buyerEmail: 'a@x.com', buyerAddress: '1 St',
    status: 'paid', placedAt: '2026-05-01T00:00:00Z', shippedAt: null, deliveredAt: null,
  },
  {
    id: 'o2', number: 'ORD-2', listingTitle: 'Wool Hat', listingKind: 'physical_good',
    qty: 2, unitPriceUsd: 8, subtotalUsd: 16, shippingUsd: 3, totalUsd: 19,
    buyerName: 'Bob', buyerEmail: '', buyerAddress: '2 St',
    status: 'shipped', placedAt: '2026-05-02T00:00:00Z', shippedAt: '2026-05-03', deliveredAt: null,
    trackingNumber: 'TRK1', carrier: 'USPS',
  },
  {
    id: 'o3', number: 'ORD-3', listingTitle: 'Old Item', listingKind: 'digital_download',
    qty: 1, unitPriceUsd: 5, subtotalUsd: 5, shippingUsd: 0, totalUsd: 5,
    buyerName: 'Carol', buyerEmail: 'c@x.com', buyerAddress: '',
    status: 'refunded', placedAt: '2026-05-04T00:00:00Z', shippedAt: null, deliveredAt: null,
  },
];

describe('OrdersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [] } } });
  });

  it('shows empty state when no orders', async () => {
    render(<OrdersPanel />);
    expect(await screen.findByText('No orders in this view.')).toBeInTheDocument();
  });

  it('renders orders with status badges and tracking info', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: ORDERS } } });
    render(<OrdersPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
    expect(screen.getByText('shipped')).toBeInTheDocument();
    expect(screen.getByText('refunded')).toBeInTheDocument();
    expect(screen.getByText(/USPS TRK1/)).toBeInTheDocument();
  });

  it('changes the filter and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: ORDERS } } });
    render(<OrdersPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shipped' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'orders-list', input: { status: 'shipped' } }),
      ),
    );
  });

  it('opens the ship form and saves shipment', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'orders-list')
        return Promise.resolve({ data: { ok: true, result: { orders: ORDERS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<OrdersPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByText('Ship'));
    fireEvent.change(screen.getByPlaceholderText('Tracking #'), { target: { value: 'NEW-TRK' } });
    fireEvent.change(screen.getByPlaceholderText(/Carrier/), { target: { value: 'FedEx' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'orders-mark-shipped',
          input: { id: 'o1', trackingNumber: 'NEW-TRK', carrier: 'FedEx' },
        }),
      ),
    );
  });

  it('cancels the ship form', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: ORDERS } } });
    render(<OrdersPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByText('Ship'));
    expect(screen.getByPlaceholderText('Tracking #')).toBeInTheDocument();
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByPlaceholderText('Tracking #')).not.toBeInTheDocument();
  });

  it('marks a shipped order delivered', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'orders-list')
        return Promise.resolve({ data: { ok: true, result: { orders: ORDERS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<OrdersPanel />);
    await screen.findByText('Wool Hat');
    fireEvent.click(screen.getByRole('button', { name: /Delivered/ }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'orders-mark-delivered', input: { id: 'o2' } }),
      ),
    );
  });

  it('refunds an order when a reason is given', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('item damaged');
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'orders-list')
        return Promise.resolve({ data: { ok: true, result: { orders: ORDERS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<OrdersPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByText('Refund')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'orders-refund',
          input: { id: 'o1', reason: 'item damaged' },
        }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('does not refund when the prompt is cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'orders-list')
        return Promise.resolve({ data: { ok: true, result: { orders: ORDERS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<OrdersPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByText('Refund')[0]);
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orders-refund' }),
    );
    promptSpy.mockRestore();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<OrdersPanel />);
    expect(await screen.findByText('No orders in this view.')).toBeInTheDocument();
  });
});
