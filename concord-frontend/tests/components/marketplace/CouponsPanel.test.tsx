import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CouponsPanel } from '@/components/marketplace/CouponsPanel';

const COUPONS = [
  {
    id: 'c1', number: 'CP-1', code: 'SAVE10', kind: 'percent', amount: 10,
    tiers: [], buyQty: 1, getQty: 1, minOrderUsd: 0, maxRedemptions: 0,
    startsAt: '', endsAt: '', active: true, live: true, redemptions: 2,
  },
  {
    id: 'c2', number: 'CP-2', code: 'FIVE', kind: 'fixed', amount: 5,
    tiers: [], buyQty: 1, getQty: 1, minOrderUsd: 25, maxRedemptions: 100,
    startsAt: '', endsAt: '', active: true, live: false, redemptions: 4,
  },
  {
    id: 'c3', number: 'CP-3', code: 'SHIP', kind: 'free_shipping', amount: 0,
    tiers: [], buyQty: 1, getQty: 1, minOrderUsd: 0, maxRedemptions: 0,
    startsAt: '', endsAt: '', active: false, live: false, redemptions: 0,
  },
  {
    id: 'c4', number: 'CP-4', code: 'BOGO', kind: 'bogo', amount: 0,
    tiers: [], buyQty: 2, getQty: 1, minOrderUsd: 0, maxRedemptions: 0,
    startsAt: '', endsAt: '', active: true, live: true, redemptions: 0,
  },
  {
    id: 'c5', number: 'CP-5', code: 'TIER', kind: 'tiered', amount: 0,
    tiers: [{ minSpendUsd: 50, percentOff: 10 }], buyQty: 1, getQty: 1,
    minOrderUsd: 0, maxRedemptions: 0, startsAt: '', endsAt: '', active: true, live: true, redemptions: 0,
  },
];

describe('CouponsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { coupons: [] } } });
  });

  it('shows empty state when no coupons', async () => {
    render(<CouponsPanel />);
    expect(await screen.findByText('No coupons yet.')).toBeInTheDocument();
  });

  it('renders coupon list with all kind summaries and status badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { coupons: COUPONS } } });
    render(<CouponsPanel />);
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(screen.getByText('10% off')).toBeInTheDocument();
    expect(screen.getByText(/\$5 off/)).toBeInTheDocument();
    expect(screen.getAllByText('Free shipping').length).toBeGreaterThan(0);
    expect(screen.getByText('Buy 2, get 1 free')).toBeInTheDocument();
    expect(screen.getByText(/\$50\+ → 10%/)).toBeInTheDocument();
    expect(screen.getAllByText('live').length).toBeGreaterThan(0);
    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
  });

  it('toggles the create form and shows percent amount input', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    expect(screen.getByPlaceholderText('CODE *')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('% off')).toBeInTheDocument();
  });

  it('shows bogo inputs when kind=bogo and tiered inputs when kind=tiered', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    const kindSelect = screen.getByDisplayValue('Percent off');
    fireEvent.change(kindSelect, { target: { value: 'bogo' } });
    expect(screen.getByPlaceholderText('Buy qty')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Get free qty')).toBeInTheDocument();
    fireEvent.change(kindSelect, { target: { value: 'tiered' } });
    expect(screen.getByText('Spend tiers')).toBeInTheDocument();
    // add + remove a tier row
    fireEvent.click(screen.getByText('Add tier'));
    expect(screen.getAllByPlaceholderText('Min spend $').length).toBe(2);
    fireEvent.click(screen.getAllByLabelText('Remove tier')[0]);
    expect(screen.getAllByPlaceholderText('Min spend $').length).toBe(1);
  });

  it('updates every draft field — exercises all onChange handlers', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'ABC' } });
    fireEvent.change(screen.getByPlaceholderText('% off'), { target: { value: '20' } });
    fireEvent.change(screen.getByPlaceholderText('Min order $'), { target: { value: '30' } });
    fireEvent.change(screen.getByPlaceholderText(/Max redemptions/), { target: { value: '50' } });
    const dates = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: '2026-06-01' } });
    fireEvent.change(dates[1], { target: { value: '2026-07-01' } });
    expect(screen.getByDisplayValue('ABC')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-06-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument();
  });

  it('updates bogo buy/get quantity inputs', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByDisplayValue('Percent off'), { target: { value: 'bogo' } });
    fireEvent.change(screen.getByPlaceholderText('Buy qty'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('Get free qty'), { target: { value: '2' } });
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('updates tester subtotal and qty inputs', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: '4' } });
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  it('creates a bogo coupon passing buy/get quantities', async () => {
    const calls: unknown[][] = [];
    lensRun.mockImplementation((...a: unknown[]) => {
      calls.push(a);
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'BG' } });
    fireEvent.change(screen.getByDisplayValue('Percent off'), { target: { value: 'bogo' } });
    fireEvent.change(screen.getByPlaceholderText('Buy qty'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Create coupon'));
    await waitFor(() => expect(calls.some((c) => c[1] === 'coupons-create')).toBe(true));
    const createCall = calls.find((c) => c[1] === 'coupons-create')!;
    expect((createCall[2] as { buyQty: number }).buyQty).toBe(2);
  });

  it('does not call create when code is blank', async () => {
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Create coupon'));
    expect(lensRun).not.toHaveBeenCalledWith('marketplace', 'coupons-create', expect.anything());
  });

  it('creates a tiered coupon and refreshes', async () => {
    const calls: unknown[][] = [];
    lensRun.mockImplementation((...a: unknown[]) => {
      calls.push(a);
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'NEW' } });
    fireEvent.change(screen.getByDisplayValue('Percent off'), { target: { value: 'tiered' } });
    fireEvent.change(screen.getByPlaceholderText('Min spend $'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('% off'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('Create coupon'));
    await waitFor(() =>
      expect(calls.some((c) => c[1] === 'coupons-create')).toBe(true),
    );
    const createCall = calls.find((c) => c[1] === 'coupons-create')!;
    expect((createCall[2] as { tiers: unknown[] }).tiers.length).toBe(1);
  });

  it('shows an error when create returns ok:false', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-create')
        return Promise.resolve({ data: { ok: false, error: 'duplicate code' } });
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'DUP' } });
    fireEvent.click(screen.getByText('Create coupon'));
    expect(await screen.findByText('duplicate code')).toBeInTheDocument();
  });

  it('tolerates a create rejection', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-create') return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('New coupon'));
    fireEvent.change(screen.getByPlaceholderText('CODE *'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Create coupon'));
    expect(await screen.findByText('Could not create coupon')).toBeInTheDocument();
  });

  it('toggles a coupon active state', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-list')
        return Promise.resolve({ data: { ok: true, result: { coupons: COUPONS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CouponsPanel />);
    await screen.findByText('SAVE10');
    fireEvent.click(screen.getAllByTitle(/Pause|Activate/)[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'coupons-toggle', { id: 'c1' }),
    );
  });

  it('deletes a coupon after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-list')
        return Promise.resolve({ data: { ok: true, result: { coupons: COUPONS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CouponsPanel />);
    await screen.findByText('SAVE10');
    fireEvent.click(screen.getAllByLabelText('Delete coupon')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'coupons-delete', { id: 'c1' }),
    );
    confirmSpy.mockRestore();
  });

  it('does not delete when confirm is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-list')
        return Promise.resolve({ data: { ok: true, result: { coupons: COUPONS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CouponsPanel />);
    await screen.findByText('SAVE10');
    fireEvent.click(screen.getAllByLabelText('Delete coupon')[0]);
    expect(lensRun).not.toHaveBeenCalledWith('marketplace', 'coupons-delete', expect.anything());
    confirmSpy.mockRestore();
  });

  it('applies a coupon in the tester and shows the discount result', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-apply')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              code: 'SAVE10', kind: 'percent', discountUsd: 4.5,
              subtotalUsd: 45, totalAfterDiscountUsd: 40.5,
            },
          },
        });
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.change(screen.getByPlaceholderText('Code'), { target: { value: 'SAVE10' } });
    fireEvent.change(screen.getByPlaceholderText('Subtotal $'), { target: { value: '45' } });
    fireEvent.click(screen.getByText('Apply coupon'));
    expect(await screen.findByText('$4.50')).toBeInTheDocument();
    expect(screen.getByText('$40.50')).toBeInTheDocument();
  });

  it('shows tester error when apply returns ok:false', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-apply')
        return Promise.resolve({ data: { ok: false, error: 'expired' } });
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('Apply coupon'));
    expect(await screen.findByText('expired')).toBeInTheDocument();
  });

  it('tolerates an apply rejection', async () => {
    lensRun.mockImplementation((...a: unknown[]) => {
      if (a[1] === 'coupons-apply') return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { ok: true, result: { coupons: [] } } });
    });
    render(<CouponsPanel />);
    await screen.findByText('No coupons yet.');
    fireEvent.click(screen.getByText('Apply coupon'));
    expect(await screen.findByText('Coupon could not be applied')).toBeInTheDocument();
  });

  it('tolerates a list rejection', async () => {
    lensRun.mockRejectedValue(new Error('list down'));
    render(<CouponsPanel />);
    expect(await screen.findByText('No coupons yet.')).toBeInTheDocument();
  });
});
