import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverviewPanel } from '@/components/finance/OverviewPanel';

const quote = { symbol: 'GSPC', name: 'S&P 500', price: 5000, change: 12.5, changePercent: 0.25 };

describe('finance OverviewPanel', () => {
  it('hides the market monitor and shows an empty trajectory', () => {
    render(<OverviewPanel indices={[]} isLive={false} history={[]} trend={null} hideMarketMonitor />);
    expect(screen.queryByText(/Market monitor/)).toBeNull();
    expect(screen.getByText('No net-worth snapshots yet.')).toBeTruthy();
    expect(screen.getByText('No ledger activity yet.')).toBeTruthy();
  });

  it('draws recorded snapshots and a live index when the monitor is on', () => {
    render(
      <OverviewPanel
        indices={[quote, { ...quote, symbol: 'VIX', name: 'VIX', price: 18, change: -1, changePercent: -2 }]}
        isLive
        history={[
          { date: '2026-10-01', total: 1000, cash: 100 },
          { date: '2026-10-02', total: 1100, cash: 200 },
        ]}
        trend={{
          series: [{ month: '2026-09', income: 4000, spend: 2000, net: 2000, savingsRate: 0.5 }],
          avgMonthlyIncome: 4000,
          avgMonthlySpend: 2000,
          avgNet: 2000,
        }}
      />,
    );
    expect(screen.getByText('Market monitor — live indices')).toBeTruthy();
    expect(screen.getByText('GSPC')).toBeTruthy();
    expect(screen.getByLabelText('Net worth over time')).toBeTruthy();
    expect(screen.getByText('2026-10-01')).toBeTruthy();
    fireEvent.click(screen.getByText('GSPC'));
    expect(screen.getAllByText('S&P 500').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText('GSPC'));
  });
});
