/**
 * forecast-build.test.tsx — the forecast build's FE pins (B10, 2026-11-03).
 *
 * S2: the sibling panels fetch once on mount; the page's compose version
 * (refreshKey) is their re-read signal. A bumped key must re-fire the load
 * and render the fresh data — the in-session consistency the first pass
 * found missing (views held the previous forecast until a reload).
 * S4b: the Accuracy panel's visible language is consistency — it compares
 * forecasts to the model's own later forecasts, and says so on its face.
 * S4a: the Hourly panel carries its model note (diurnal model, day-over-day
 * drift, simulated not observed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  lensRun,
  api: { post: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
}));

import { MultiDayOutlook } from '@/components/forecast/MultiDayOutlook';
import { ForecastAccuracy } from '@/components/forecast/ForecastAccuracy';
import { HourlyBreakdown } from '@/components/forecast/HourlyBreakdown';

function dayRow(kind: string, i: number) {
  return {
    day_index: i,
    date_ts: 1794000000 + i * 86400,
    weather: { kind, confidence: 0.6, temperature_c: 10, humidity_pct: 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Multi-day outlook (S2)', () => {
  it('a bumped refreshKey re-reads and renders the fresh outlook', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { ok: true, days: 7, outlook: [dayRow('rain', 0)] } },
    });
    const { rerender } = render(<MultiDayOutlook worldId="concordia-hub" refreshKey={0} />);
    expect(await screen.findByText('rain')).toBeTruthy();
    expect(lensRun).toHaveBeenCalledTimes(1);

    lensRun.mockResolvedValue({
      data: { ok: true, result: { ok: true, days: 7, outlook: [dayRow('snow', 0)] } },
    });
    rerender(<MultiDayOutlook worldId="concordia-hub" refreshKey={1} />);
    expect(await screen.findByText('snow')).toBeTruthy();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });
});

describe('Consistency panel (S4b)', () => {
  it('labels itself consistency, states its basis, and drops the accuracy claims', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ok: true,
          summary: { sample_count: 1, kind_accuracy: 1, mean_temp_error_c: 2 },
          comparisons: [{
            forecast_ts: 1700000000, target_ts: 1700086400, realized_ts: 1700090000,
            predicted_kind: 'rain', realized_kind: 'rain', kind_hit: true,
            predicted_temp_c: 10, realized_temp_c: 12, temp_abs_error_c: 2,
          }],
        },
      },
    });
    render(<ForecastAccuracy worldId="concordia-hub" />);
    expect(await screen.findByText(/Consistency, not verification/)).toBeTruthy();
    expect(screen.getByText(/model's own later forecast/)).toBeTruthy();
    expect(screen.getByText('Kind agreement')).toBeTruthy();
    expect(screen.getByText('Mean temp drift')).toBeTruthy();
    expect(screen.getByText('agrees')).toBeTruthy();
    expect(screen.queryByText('Kind hit-rate')).toBeNull();
    expect(screen.queryByText('Mean temp error')).toBeNull();
  });
});

describe('Hourly breakdown (S4a)', () => {
  it('carries the model note', async () => {
    const breakdown = Array.from({ length: 48 }, (_, h) => ({
      hour_offset: h,
      clock_hour: h % 24,
      temperature_c: h < 24 ? 10 : 12,
      humidity_pct: 50,
      confidence: 0.5,
    }));
    lensRun.mockResolvedValue({
      data: { ok: true, result: { ok: true, hours: 48, breakdown } },
    });
    render(<HourlyBreakdown worldId="concordia-hub" />);
    expect(await screen.findByText(/Diurnal model on the measured embodied baseline/)).toBeTruthy();
    expect(screen.getByText(/simulated\s+values, not observations/)).toBeTruthy();
  });
});
