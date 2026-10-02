/**
 * Forecast lens — UX-state contract test.
 *
 * Pins the four canonical states of the primary ("24h"/now) tab against the
 * REAL forecast.recent / forecast.compose wiring (mocked at the lensRun
 * boundary only — no network):
 *   1. loading  — role="status"
 *   2. error    — role="alert" + a Retry button that re-fetches
 *   3. empty    — "No forecast yet" when the macro returns forecast:null
 *   4. populated — renders the composed weather/ecology sections
 * plus a11y: the world-id input is labelled and the Retry button is focusable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// lensRun is the only backend boundary — controlled per-test.
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Lens shell + chrome primitives → inert passthroughs (no KeyboardProvider in test).
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// Child tab components — the now-tab test doesn't exercise them.
vi.mock('@/components/forecast/WeatherForecast', () => ({ WeatherForecast: () => null }));
vi.mock('@/components/forecast/MultiDayOutlook', () => ({ MultiDayOutlook: () => null }));
vi.mock('@/components/forecast/HourlyBreakdown', () => ({ HourlyBreakdown: () => null }));
vi.mock('@/components/forecast/RegionalForecast', () => ({ RegionalForecast: () => null }));
vi.mock('@/components/forecast/ForecastAccuracy', () => ({ ForecastAccuracy: () => null }));
vi.mock('@/components/forecast/ForecastArchive', () => ({ ForecastArchive: () => null }));
vi.mock('@/components/forecast/AlertSubscriptions', () => ({ AlertSubscriptions: () => null }));

import ForecastPage from '@/app/lenses/forecast/page';

const POPULATED = {
  window_hours: 24,
  weather: { kind: 'storm', confidence: 0.6, temperature_c: 1.5, humidity_pct: 82 },
  ecology: { ecosystem_score: 0.4, trend: 'rising', ecosystem_score_delta: 0 },
  factions: [],
  events: [],
  drift: null,
  composedAt: 1700000000,
};

function ok(forecast: unknown) {
  return { data: { ok: true, result: { ok: true, worldId: 'concordia-hub', forecast } } };
}

describe('forecast lens — four UX states (now tab)', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows a role=status loading state before data resolves', async () => {
    let resolve!: (v: unknown) => void;
    lensRun.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<ForecastPage />);
    expect(screen.getByRole('status')).toBeTruthy();
    resolve(ok(null));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('renders the populated forecast when recent returns a forecast', async () => {
    lensRun.mockResolvedValueOnce(ok(POPULATED));
    render(<ForecastPage />);
    await waitFor(() => expect(screen.getByText(/storm/i)).toBeTruthy());
    expect(screen.getByText(/1\.5°C/)).toBeTruthy();
    expect(screen.getByText(/rising/i)).toBeTruthy();
  });

  it('shows the empty state when recent returns forecast:null', async () => {
    lensRun.mockResolvedValueOnce(ok(null));
    render(<ForecastPage />);
    await waitFor(() => expect(screen.getByText(/No forecast yet/i)).toBeTruthy());
  });

  it('shows a role=alert error with a Retry that re-fetches', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'no_db' } });
    render(<ForecastPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/no_db/)).toBeTruthy();

    // Retry re-invokes the macro; the second call succeeds → error clears.
    lensRun.mockResolvedValueOnce(ok(POPULATED));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/storm/i)).toBeTruthy();
    expect(lensRun).toHaveBeenCalledWith('forecast', 'recent', expect.objectContaining({ worldId: 'concordia-hub' }));
  });

  it('labels the world-id input for a11y', async () => {
    lensRun.mockResolvedValue(ok(null));
    render(<ForecastPage />);
    await waitFor(() => expect(screen.getByLabelText(/world id/i)).toBeTruthy());
  });
});
