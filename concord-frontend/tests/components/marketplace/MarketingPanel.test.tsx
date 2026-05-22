import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MarketingPanel } from '@/components/marketplace/MarketingPanel';

const PROMOS = [
  {
    id: 'p1', number: 'P-1', code: 'SUMMER', kind: 'percent', amount: 15,
    validFrom: '', validUntil: '2026-09-01', minOrderUsd: 20, active: true, usageCount: 5,
  },
  {
    id: 'p2', number: 'P-2', code: 'FLAT', kind: 'fixed', amount: 8,
    validFrom: '', validUntil: '', minOrderUsd: 0, active: false, usageCount: 0,
  },
  {
    id: 'p3', number: 'P-3', code: 'FREESHIP', kind: 'free_shipping', amount: 0,
    validFrom: '', validUntil: '', minOrderUsd: 0, active: true, usageCount: 2,
  },
];

describe('MarketingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { promotions: [] } } });
  });

  it('shows empty state when no promotions', async () => {
    render(<MarketingPanel />);
    expect(await screen.findByText('No promotions yet.')).toBeInTheDocument();
  });

  it('renders promotions with all kind labels and active toggles', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { promotions: PROMOS } } });
    render(<MarketingPanel />);
    expect(await screen.findByText('SUMMER')).toBeInTheDocument();
    expect(screen.getByText('15% off')).toBeInTheDocument();
    expect(screen.getByText('$8 off')).toBeInTheDocument();
    expect(screen.getByText('Free shipping')).toBeInTheDocument();
    expect(screen.getByText(/expires 2026-09-01/)).toBeInTheDocument();
    expect(screen.getByText(/min \$20/)).toBeInTheDocument();
  });

  it('opens the create form and hides amount input for free_shipping', async () => {
    render(<MarketingPanel />);
    await screen.findByText('No promotions yet.');
    fireEvent.click(screen.getByText('New code'));
    expect(screen.getByPlaceholderText('CODE *')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Percent (1-100)')).toBeInTheDocument();
    const kindSelect = screen.getByDisplayValue('% off');
    fireEvent.change(kindSelect, { target: { value: 'free_shipping' } });
    expect(screen.queryByPlaceholderText(/Percent|Amount/)).not.toBeInTheDocument();
    fireEvent.change(kindSelect, { target: { value: 'fixed' } });
    expect(screen.getByPlaceholderText('Amount (USD)')).toBeInTheDocument();
  });

  it('upper-cases the code input', async () => {
    render(<MarketingPanel />);
    await screen.findByText('No promotions yet.');
    fireEvent.click(screen.getByText('New code'));
    const codeInput = screen.getByPlaceholderText('CODE *') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'spring' } });
    expect(codeInput.value).toBe('SPRING');
  });

  it('does not create when code or amount missing', async () => {
    render(<MarketingPanel />);
    await screen.findByText('No promotions yet.');
    fireEvent.click(screen.getByText('New code'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Create code'));
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotions-create' }),
    );
  });

  it('creates a promotion and refreshes', async () => {
    const calls: unknown[][] = [];
    lensRun.mockImplementation((...a: unknown[]) => {
      calls.push(a);
      return Promise.resolve({ data: { ok: true, result: { promotions: [] } } });
    });
    render(<MarketingPanel />);
    await screen.findByText('No promotions yet.');
    fireEvent.click(screen.getByText('New code'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'NEW' } });
    fireEvent.change(screen.getByPlaceholderText('Percent (1-100)'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('Create code'));
    await waitFor(() =>
      expect(calls.some((c) => (c[0] as { action?: string }).action === 'promotions-create')).toBe(true),
    );
  });

  it('alerts when create returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'promotions-create')
        return Promise.resolve({ data: { ok: false, error: 'dup code' } });
      return Promise.resolve({ data: { ok: true, result: { promotions: [] } } });
    });
    render(<MarketingPanel />);
    await screen.findByText('No promotions yet.');
    fireEvent.click(screen.getByText('New code'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Percent (1-100)'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Create code'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('dup code'));
    alertSpy.mockRestore();
  });

  it('toggles a promotion active state', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'promotions-list')
        return Promise.resolve({ data: { ok: true, result: { promotions: PROMOS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<MarketingPanel />);
    await screen.findByText('SUMMER');
    fireEvent.click(screen.getAllByTitle(/Active — click to disable/)[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'promotions-toggle', input: { id: 'p1' } }),
      ),
    );
  });

  it('tolerates a list rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<MarketingPanel />);
    expect(await screen.findByText('No promotions yet.')).toBeInTheDocument();
  });
});
