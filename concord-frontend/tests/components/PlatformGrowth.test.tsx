/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const addSeriesMock = vi.fn();
const fitContentMock = vi.fn();
const removeChartMock = vi.fn();

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: (ctor: unknown, options: unknown) => {
      addSeriesMock(ctor, options);
      return { setData: vi.fn() };
    },
    timeScale: () => ({ fitContent: fitContentMock }),
    remove: removeChartMock,
  }),
  LineSeries: { __series: 'LineSeries' },
}));

const growthMock = vi.fn();
const marketplaceMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    analytics: {
      growth: (...args: unknown[]) => growthMock(...args),
      marketplace: () => marketplaceMock(),
    },
  },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => <button type="button">Save as DTU</button>,
}));

import { PlatformGrowth } from '@/components/analytics/PlatformGrowth';

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('PlatformGrowth', () => {
  beforeEach(() => {
    addSeriesMock.mockClear();
    fitContentMock.mockClear();
    removeChartMock.mockClear();
    growthMock.mockReset();
    marketplaceMock.mockReset();
  });

  it('uses the lightweight-charts v5 addSeries(LineSeries, ...) API', async () => {
    growthMock.mockResolvedValue({
      data: {
        series: [
          { ts: '2026-10-20', users: 10, dtus: 1 },
          { ts: '2026-10-21', users: 20, dtus: 2 },
        ],
        totals: {},
      },
    });
    marketplaceMock.mockResolvedValue({ data: {} });

    renderWithQuery(<PlatformGrowth />);
    await waitFor(() => expect(addSeriesMock).toHaveBeenCalledTimes(2));

    expect(addSeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ __series: 'LineSeries' }),
      expect.objectContaining({ color: '#22d3ee' }),
    );
    expect(addSeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ __series: 'LineSeries' }),
      expect.objectContaining({ color: '#f97316' }),
    );
    expect(fitContentMock).toHaveBeenCalled();
  });

  it('renders totals from the analytics response', async () => {
    growthMock.mockResolvedValue({
      data: {
        series: [],
        totals: { users: 1234, activeUsers: 567, dtus: 89, revenueUsd: 1200 },
      },
    });
    marketplaceMock.mockResolvedValue({
      data: { totalListings: 5, sold24h: 1, gmv24hUsd: 99 },
    });

    renderWithQuery(<PlatformGrowth />);
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(await screen.findByText('567')).toBeInTheDocument();
    expect(await screen.findByText('89')).toBeInTheDocument();
    expect(await screen.findByText('$1,200')).toBeInTheDocument();
  });
});
