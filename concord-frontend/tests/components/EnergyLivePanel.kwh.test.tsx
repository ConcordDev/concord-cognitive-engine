/**
 * EnergyLivePanel — the chart and kWh legs of FIX-energy-001.
 *
 * The walker's repro: submit one 100 W sample, reload — Now/Peak/Avg
 * showed 100 W, but the chart said "No live samples yet" (the chart
 * gated on more than one sample, so a single real sample read as none)
 * and no kWh figure existed anywhere for submitted samples. The chart
 * now renders from the first sample, the empty text appears only at
 * zero samples, and the panel shows the window's integrated kWh/cost
 * the server returns.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
}));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }) }));

import { EnergyLivePanel } from '@/components/energy/EnergyLivePanel';

const SAMPLE = (watts: number, at: string) => ({ id: `lp_${watts}_${at}`, watts, at, deviceName: 'Main panel' });

function mockStream(result: Record<string, unknown>) {
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'live-stream') return { data: { ok: true, result } };
    return { data: { ok: true, result: {} } };
  });
}
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };

beforeEach(() => { lensRun.mockReset(); });
afterEach(() => cleanup());

describe('EnergyLivePanel — samples feed the chart and the kWh line (FIX-energy-001)', () => {
  it('one sample is a live sample: the chart renders and no empty text shows', async () => {
    mockStream({ samples: [SAMPLE(100, new Date().toISOString())], current: 100, peak: 100, avgWatts: 100, count: 1, kwh: 0, cost: null });
    const view = render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await settle();
    expect(view.queryByTestId('chart')).toBeTruthy();
    expect(view.container.textContent).not.toContain('No live samples yet');
    expect(view.container.textContent).toContain('0 kWh from samples in this window');
  });

  it('the window kWh and cost from the server are shown', async () => {
    const now = Date.now();
    mockStream({
      samples: [SAMPLE(1000, new Date(now - 3600000).toISOString()), SAMPLE(1000, new Date(now).toISOString())],
      current: 1000, peak: 1000, avgWatts: 1000, count: 2, kwh: 1.5, cost: 0.38,
    });
    const view = render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await settle();
    expect(view.queryByTestId('chart')).toBeTruthy();
    expect(view.container.textContent).toContain('1.5 kWh from samples in this window');
    expect(view.container.textContent).toContain('≈ $0.38');
  });

  it('zero samples keep the honest empty state and no kWh line', async () => {
    mockStream({ samples: [], current: 0, peak: 0, avgWatts: 0, count: 0, kwh: 0, cost: null });
    const view = render(<EnergyLivePanel meterId="meter_1" meterName="Main panel" onChange={vi.fn()} />);
    await settle();
    expect(view.queryByTestId('chart')).toBeNull();
    expect(view.container.textContent).toContain('No live samples yet');
    expect(view.container.textContent).not.toContain('kWh from samples');
  });
});
