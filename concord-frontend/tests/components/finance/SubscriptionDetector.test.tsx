import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SubscriptionDetector } from '@/components/finance/SubscriptionDetector';

const SUBS = [
  { id: 's1', merchant: 'Netflix', monthlyAmount: 15.99, cadence: 'monthly', lastChargedAt: '2026-05-01', nextEstimated: '2026-06-01', category: 'Entertainment', status: 'active', insight: 'Price went up' },
  { id: 's2', merchant: 'Adobe', monthlyAmount: 52.99, cadence: 'annual', lastChargedAt: '2026-03-01', nextEstimated: '2027-03-01', category: 'Software', status: 'paused' },
  { id: 's3', merchant: 'Gym', monthlyAmount: 40, cadence: 'monthly', lastChargedAt: '2026-04-01', nextEstimated: '2026-05-01', category: 'Health', status: 'cancelled' },
];

describe('SubscriptionDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { subscriptions: [] } } });
  });

  it('shows empty state with no subscriptions', async () => {
    render(<SubscriptionDetector />);
    expect(await screen.findByText(/No subscriptions detected/)).toBeInTheDocument();
  });

  it('renders subscriptions with statuses, insight and totals', async () => {
    lensRun.mockResolvedValue({ data: { result: { subscriptions: SUBS } } });
    render(<SubscriptionDetector />);
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('Adobe')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByText(/Price went up/)).toBeInTheDocument();
  });

  it('changes the sort order', async () => {
    lensRun.mockResolvedValue({ data: { result: { subscriptions: SUBS } } });
    render(<SubscriptionDetector />);
    await screen.findByText('Netflix');
    fireEvent.click(screen.getByText('merchant'));
    fireEvent.click(screen.getByText('recent'));
    expect(screen.getByText('recent').className).toContain('cyan');
  });

  it('cancels a subscription when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockResolvedValue({ data: { result: { subscriptions: SUBS } } });
    render(<SubscriptionDetector />);
    await screen.findByText('Netflix');
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Cancel'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscriptions-cancel', input: { id: 's1' } })),
    );
    confirmSpy.mockRestore();
  });

  it('does not cancel when the confirm is dismissed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValue({ data: { result: { subscriptions: SUBS } } });
    render(<SubscriptionDetector />);
    await screen.findByText('Netflix');
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Cancel'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'subscriptions-cancel' }));
    confirmSpy.mockRestore();
  });

  it('rescans on the header button', async () => {
    lensRun.mockResolvedValue({ data: { result: { subscriptions: SUBS } } });
    render(<SubscriptionDetector />);
    await screen.findByText('Netflix');
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Rescan'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscriptions-detect' })));
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SubscriptionDetector />);
    expect(await screen.findByText(/No subscriptions detected/)).toBeInTheDocument();
  });
});
