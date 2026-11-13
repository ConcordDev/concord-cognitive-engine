// SocietyShareChartSelection.test.tsx
//
// FIX-society-007: each Data Explorer view kept its own country /
// indicator state and unmounted on view switch, so the selection
// reset to USA · gdpPerCapita — plot population, switch views, come
// back, Share link, and the saved chart was the default. The
// selection now lives in the DataExplorer parent and survives
// switching; Share saves the chart actually being viewed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['Globe2', 'LineChart', 'CircleDot', 'Map', 'LayoutDashboard', 'Trophy', 'Link2',
    'Search', 'Loader2', 'Download', 'AlertTriangle'];
  return Object.fromEntries(names.map((n) => [n, createIcon(n)]));
});

vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

const savedSpecs: Record<string, unknown>[] = [];
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown>) => {
    if (action === 'wb-common-indicators') {
      return { data: { ok: true, result: { indicators: { population: 'Population', gdpPerCapita: 'GDP per capita' } } } };
    }
    if (action === 'wb-chart-series') {
      const series = [{ year: 2020, value: 100 }, { year: 2021, value: 110 }];
      return { data: { ok: true, result: {
        country: input.country, indicator: input.indicator,
        alias: input.indicator === 'population' ? 'Population' : 'GDP per capita',
        chartKind: 'line', xKey: 'year', series, points: 2, transforms: [],
        min: 100, max: 110, first: series[0], last: series[1],
      } } };
    }
    if (action === 'wb-save-chart') {
      savedSpecs.push(input);
      return { data: { ok: true, result: { permalink: '/lenses/society?chart=soc_1' } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { DataExplorer } from '@/components/society/DataExplorer';

describe('Society DataExplorer share saves the viewed chart (FIX-society-007)', () => {
  afterEach(() => cleanup());

  it('selection survives a view switch and Share saves it', async () => {
    render(React.createElement(DataExplorer));
    const indicatorInput = await screen.findByLabelText('Indicator');
    fireEvent.change(indicatorInput, { target: { value: 'population' } });

    // Switch away and back — ChartView unmounts and remounts.
    fireEvent.click(screen.getByRole('button', { name: /Rankings/ }));
    fireEvent.click(screen.getByRole('button', { name: /Chart/ }));

    const remounted = await screen.findByLabelText('Indicator');
    expect((remounted as HTMLInputElement).value).toBe('population');

    fireEvent.click(screen.getByRole('button', { name: /Plot/ }));
    await screen.findByText('USA — Population');
    fireEvent.click(screen.getByRole('button', { name: /Share link/ }));
    await vi.waitFor(() => expect(savedSpecs).toHaveLength(1));
    expect((savedSpecs[0].spec as Record<string, unknown>).indicator).toBe('population');
    expect(savedSpecs[0].title).toBe('USA · Population');
  });
});
