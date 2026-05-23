import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { DividendTracker } from '@/components/finance/DividendTracker';

const SUMMARY = {
  perHolding: [
    { symbol: 'SCHD', value: 10000, yieldPct: 3.5, annualDividend: 350, monthlyDividend: 29.16 },
    { symbol: 'JEPI', value: 5000, yieldPct: 8.0, annualDividend: 400, monthlyDividend: 33.33 },
  ],
  totalAnnual: 750,
  monthlyAverage: 62.5,
  portfolioYieldPct: 5.0,
};

const CAL = { events: [{ date: '2026-06-15', symbol: 'SCHD', amount: 87.5, kind: 'dividend' }] };
const EARN = { events: [{ date: '2026-07-20', symbol: 'AAPL', name: 'Apple Inc', when: 'after_close', estimateEps: 1.45 }] };

describe('DividendTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { perHolding: [], totalAnnual: 0, monthlyAverage: 0, portfolioYieldPct: 0 } } });
  });

  it('shows empty summary when no dividend holdings', async () => {
    render(<DividendTracker />);
    expect(await screen.findByText(/No dividend-paying holdings/)).toBeInTheDocument();
  });

  it('renders the summary table and header stats', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'dividends-summary') return Promise.resolve({ data: { result: SUMMARY } });
      if (spec.action === 'dividends-calendar') return Promise.resolve({ data: { result: CAL } });
      if (spec.action === 'earnings-calendar') return Promise.resolve({ data: { result: EARN } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<DividendTracker />);
    expect(await screen.findByText('SCHD')).toBeInTheDocument();
    expect(screen.getByText('JEPI')).toBeInTheDocument();
    expect(screen.getByText(/\$750\/yr/)).toBeInTheDocument();
  });

  it('switches to dividend calendar and earnings tabs', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'dividends-summary') return Promise.resolve({ data: { result: SUMMARY } });
      if (spec.action === 'dividends-calendar') return Promise.resolve({ data: { result: CAL } });
      if (spec.action === 'earnings-calendar') return Promise.resolve({ data: { result: EARN } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<DividendTracker />);
    await screen.findByText('SCHD');
    fireEvent.click(screen.getByText('Dividend calendar'));
    expect(await screen.findByText('+$87.50')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Earnings'));
    expect(await screen.findByText('Apple Inc · after close')).toBeInTheDocument();
  });

  it('shows empty states for calendar and earnings tabs', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'dividends-summary') return Promise.resolve({ data: { result: SUMMARY } });
      return Promise.resolve({ data: { result: { events: [] } } });
    });
    render(<DividendTracker />);
    await screen.findByText('SCHD');
    fireEvent.click(screen.getByText('Dividend calendar'));
    expect(await screen.findByText(/No upcoming dividend events/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Earnings'));
    expect(await screen.findByText(/No upcoming earnings/)).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<DividendTracker />);
    expect(await screen.findByText(/No dividend-paying holdings/)).toBeInTheDocument();
  });
});
