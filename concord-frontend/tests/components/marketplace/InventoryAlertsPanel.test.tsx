import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/viz', () => ({
  ChartKit: ({ data }: { data: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'chartkit' }, `rows:${data.length}`),
}));

import { InventoryAlertsPanel } from '@/components/marketplace/InventoryAlertsPanel';

const RESULT = {
  threshold: 5,
  outOfStock: 1,
  lowStock: 2,
  total: 3,
  alerts: [
    { listingId: 'l1', title: 'Brass Ring', level: 'out_of_stock', stockQty: 0, scope: 'listing' },
    { listingId: 'l2', title: 'Silk Scarf', level: 'low_stock', stockQty: 3, scope: 'variation', sku: 'SK-1' },
    { listingId: 'l3', title: 'Wool Hat', level: 'low_stock', stockQty: 2, scope: 'listing' },
  ],
};

describe('InventoryAlertsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { threshold: 5, alerts: [], outOfStock: 0, lowStock: 0, total: 0 } } });
  });

  it('shows loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<InventoryAlertsPanel />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.getByText(/Scanning inventory/)).toBeInTheDocument();
  });

  it('shows empty state when total is zero', async () => {
    render(<InventoryAlertsPanel />);
    expect(await screen.findByText(/No stock alerts/)).toBeInTheDocument();
  });

  it('renders alert summary, chart and list with populated data', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT } });
    render(<InventoryAlertsPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('Silk Scarf')).toBeInTheDocument();
    expect(screen.getByText('Wool Hat')).toBeInTheDocument();
    expect(screen.getByTestId('chartkit')).toHaveTextContent('rows:2');
    expect(screen.getByText('0 left')).toBeInTheDocument();
    expect(screen.getByText('3 left')).toBeInTheDocument();
    // variation sku appears
    expect(screen.getByText(/SK-1/)).toBeInTheDocument();
  });

  it('updates threshold and re-fetches with the new value', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT } });
    render(<InventoryAlertsPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '12' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'inventory-alerts', {
        lowStockThreshold: 12,
      }),
    );
  });

  it('clamps a negative threshold to zero', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT } });
    render(<InventoryAlertsPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-9' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'inventory-alerts', {
        lowStockThreshold: 0,
      }),
    );
  });

  it('refresh button re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: RESULT } });
    render(<InventoryAlertsPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Refresh'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<InventoryAlertsPanel />);
    expect(await screen.findByText(/No stock alerts/)).toBeInTheDocument();
  });
});
