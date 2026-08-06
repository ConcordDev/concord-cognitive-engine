import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import TickerTape from '@/components/finance/TickerTape';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('TickerTape — honest poll-based crypto.live_top strip', () => {
  it('shows a loading state before the first poll resolves', () => {
    lensRunMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<TickerTape />);
    expect(screen.getByText(/loading live prices/i)).toBeInTheDocument();
  });

  it('renders real coins from crypto.live_top, doubled for the scroll loop', async () => {
    lensRunMock.mockResolvedValue({
      data: { result: { ok: true, coins: [
        { symbol: 'BTC', price: 65000, changePct24h: 2.5 },
        { symbol: 'ETH', price: 3200.5, changePct24h: -1.1 },
      ] } },
    });
    render(<TickerTape />);
    await waitFor(() => expect(screen.getByRole('marquee')).toBeInTheDocument());
    // doubled (twice through the array) for the seamless CSS scroll loop
    expect(screen.getAllByText('BTC')).toHaveLength(2);
    expect(screen.getAllByText('ETH')).toHaveLength(2);
    expect(screen.getAllByText('$65,000')).toHaveLength(2);
    expect(screen.getAllByText(/▲ 2.50%/)).toHaveLength(2);
    expect(screen.getAllByText(/▼ 1.10%/)).toHaveLength(2);
  });

  it('shows an honest "unavailable" state on first-load failure, not a frozen empty tape', async () => {
    lensRunMock.mockRejectedValue(new Error('network down'));
    render(<TickerTape />);
    await waitFor(() => expect(screen.getByText(/price feed unavailable/i)).toBeInTheDocument());
  });

  it('keeps the last-known-good tape and marks it "stale" on a later failed poll, never fabricating fresh data', async () => {
    vi.useFakeTimers();
    lensRunMock.mockResolvedValueOnce({
      data: { result: { ok: true, coins: [{ symbol: 'BTC', price: 65000, changePct24h: 1 }] } },
    });
    render(<TickerTape />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush the initial (non-timer-gated) poll
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);

    lensRunMock.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); }); // fires the setInterval-scheduled second poll
    expect(screen.getByText('stale')).toBeInTheDocument();
    // last-known-good BTC tick is still visible, not wiped
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
  });
});
