import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SpendingInsights } from '@/components/finance/SpendingInsights';

const INSIGHTS = {
  latestMonth: '2026-05',
  priorMonth: '2026-04',
  trends: [
    { category: 'Dining', current: 600, prior: 300, delta: 300, deltaPct: 100, anomaly: true },
    { category: 'Groceries', current: 400, prior: 500, delta: -100, deltaPct: -20, anomaly: false },
  ],
  anomalies: [
    { category: 'Dining', current: 600, prior: 300, delta: 300, deltaPct: 100, anomaly: true },
  ],
  topGrowth: [],
  topShrink: [],
};

describe('SpendingInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no trends', async () => {
    lensRun.mockResolvedValue({ data: { result: { latestMonth: '', priorMonth: '', trends: [], anomalies: [], topGrowth: [], topShrink: [] } } });
    render(<SpendingInsights />);
    expect(await screen.findByText(/No spending data yet/)).toBeInTheDocument();
  });

  it('shows empty state when result is null', async () => {
    lensRun.mockResolvedValue({ data: { result: null } });
    render(<SpendingInsights />);
    expect(await screen.findByText(/No spending data yet/)).toBeInTheDocument();
  });

  it('renders trends with anomaly badge and up/down deltas', async () => {
    lensRun.mockResolvedValue({ data: { result: INSIGHTS } });
    render(<SpendingInsights />);
    expect(await screen.findByText('Dining')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('1 anomaly')).toBeInTheDocument();
    expect(screen.getByText(/\+\$300/)).toBeInTheDocument();
  });

  it('pluralises anomalies', async () => {
    lensRun.mockResolvedValue({
      data: { result: { ...INSIGHTS, anomalies: [INSIGHTS.anomalies[0], { ...INSIGHTS.anomalies[0], category: 'Travel' }] } },
    });
    render(<SpendingInsights />);
    expect(await screen.findByText('2 anomalies')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SpendingInsights />);
    await waitFor(() => expect(screen.getByText(/No spending data yet/)).toBeInTheDocument());
  });
});
