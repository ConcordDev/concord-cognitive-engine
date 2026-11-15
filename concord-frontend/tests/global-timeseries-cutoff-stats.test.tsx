// FIX-global-005 — the Time Series year-cutoff slider shortened the
// chart but the stat cards kept describing the FULL series: "Latest"
// still showed the newest year (2025) after the cutoff was moved to
// 2005. The cards now derive from the same valued points the chart
// draws, using the server's own first/last + pct formula — identical
// numbers at the default cutoff, cutoff-true numbers when trimmed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SERIES = {
  country: 'CAN', countryName: 'Canada', indicator: 'TEST.IND', indicatorName: 'Test indicator',
  points: [
    { year: 2000, value: 100 }, { year: 2001, value: 110 }, { year: 2002, value: 120 },
    { year: 2003, value: 130 }, { year: 2004, value: 140 }, { year: 2005, value: 150 },
    { year: 2010, value: 200 }, { year: 2020, value: 250 }, { year: 2025, value: 300 },
  ],
  minYear: 2000, maxYear: 2025,
  latest: { year: 2025, value: 300 }, earliest: { year: 2000, value: 100 },
  pctChange: 200, source: 'World Bank Open Data',
};
const lensRunMock = vi.fn(async (_domain: string, action: string) => {
  if (action === 'listViews') return { data: { ok: true, result: { views: [] } } };
  if (action === 'indicatorTimeseries') return { data: { ok: true, result: SERIES } };
  return { data: { ok: true, result: {} } };
});
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...(a as [string, string, Record<string, unknown>])) }));
vi.mock('@/components/global/ChoroplethMap', () => ({ ChoroplethMap: () => null }));
vi.mock('@/components/global/IndicatorPicker', () => ({ IndicatorPicker: () => null }));
vi.mock('@/components/global/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({ StickyDeleteConfirm: () => null }));

import { DataExplorer } from '@/components/global/DataExplorer';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DataExplorer />
    </QueryClientProvider>,
  );
}

describe('FIX-global-005 time-series cutoff stats', () => {
  beforeEach(() => lensRunMock.mockClear());

  it('Latest and Change follow the year cutoff slider', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Time Series/ }));
    fireEvent.click(screen.getByRole('button', { name: /Run query/ }));

    // Default cutoff = maxYear: the full-range stats, as before.
    expect(await screen.findByText('Latest (2025)')).toBeTruthy();
    expect(screen.getByText('300.00')).toBeTruthy();
    expect(screen.getByText('+200%')).toBeTruthy();

    // Move the cutoff to 2005: the stats must describe the visible window.
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: '2005' } });

    expect(await screen.findByText('Latest (2005)')).toBeTruthy();
    expect(screen.getByText('150.00')).toBeTruthy();
    expect(screen.getByText('+50%')).toBeTruthy();
    expect(screen.queryByText('Latest (2025)')).toBeNull();
  });
});
