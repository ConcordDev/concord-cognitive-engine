import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcRatiosPanel } from '@/components/accounting/AcRatiosPanel';

const POPULATED = {
  currentRatio: 2.1, quickRatio: 1.4, debtToEquity: 0.5,
  grossMarginPct: 62, netMarginPct: 18, workingCapital: 45000,
  totals: {
    currentAssets: 90000, totalAssets: 150000, currentLiabilities: 45000,
    totalLiabilities: 75000, revenue: 200000, netIncome: 36000,
  },
  note: 'Computed from posted journal entries.',
};

const NULLS = {
  ...POPULATED,
  currentRatio: null, quickRatio: null, debtToEquity: null,
  grossMarginPct: null, netMarginPct: null,
};

describe('AcRatiosPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner while the request is in flight', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcRatiosPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('stays in the spinner state when the result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    const { container } = render(<AcRatiosPanel />);
    // null result -> loading false but r still null -> still spinner branch
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders every ratio card with populated numeric data', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POPULATED } });
    render(<AcRatiosPanel />);
    expect(await screen.findByText('Current ratio')).toBeInTheDocument();
    expect(screen.getByText('2.1')).toBeInTheDocument();
    expect(screen.getByText('1.4')).toBeInTheDocument();
    expect(screen.getByText('0.5')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
    // workingCapital card value — also appears in the totals list, so >=1
    expect(screen.getAllByText('$45,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Working capital')).toBeInTheDocument();
    expect(screen.getByText('Computed from posted journal entries.')).toBeInTheDocument();
  });

  it('renders em-dash placeholders when ratios are null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: NULLS } });
    render(<AcRatiosPanel />);
    await screen.findByText('Current ratio');
    // 5 ratio fields are null -> 5 em-dash values
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });

  it('renders the underlying totals block', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: POPULATED } });
    render(<AcRatiosPanel />);
    expect(await screen.findByText('Underlying totals')).toBeInTheDocument();
    expect(screen.getByText('$150,000')).toBeInTheDocument();
    expect(screen.getByText('$36,000')).toBeInTheDocument();
  });
});
