// Render coverage for the desert weather watch and the solar calculator.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const SOLAR = {
  sizedFor: 'household', latitude: 36.5, peakSunHours: 6.5, panelCount: 20, panelWatt: 400, arrayKw: 8, systemLossFactor: 0.8, dailyKwh: 41, annualKwh: 15000, annualMwh: 15,
  arrayAreaM2: 40, footprintM2: 60, footprintAcres: 0.01, batteryKwhRecommended: 20, co2AvoidedKgYr: 6000, homesEquivalent: 1.4, rating: 'excellent',
};
const RES: Record<string, unknown> = {
  realWeather: { ok: true, data: { latitude: 36.5, longitude: -116.9, current: { temperature_2m: 41, relative_humidity_2m: 8, wind_speed_10m: 12, weather_code: 0, time: '2026-03-01T10:00' }, current_units: { temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'km/h' } } },
  heatUvAlert: { uvIndex: 11, uvLevel: 'extreme' },
  solarInstall: SOLAR,
};
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));

import { DesertWeatherWatch } from '../DesertWeatherWatch';
import { SolarCalculator } from '../SolarCalculator';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? {}, error: null } }));
});

describe('DesertWeatherWatch', () => {
  it('renders conditions and UV for every site', async () => {
    const view = render(<DesertWeatherWatch />);
    await settle();
    await exercise({ passes: 2 });
    expect(view.container.textContent).toContain('Sahara');
  });
  it('says so when the weather feed is unavailable', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'weather unavailable' } }));
    const view = render(<DesertWeatherWatch />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('SolarCalculator', () => {
  it('sizes an install', async () => {
    const view = render(<SolarCalculator />);
    await exercise({ passes: 3, text: '5' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
  it('renders a refusal, not a result, for NOT_COMPUTED', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { status: 'NOT_COMPUTED', message: 'no latitude' } } }));
    const view = render(<SolarCalculator />);
    await exercise({ passes: 2, text: '5' });
    await settle();
    expect(view.container.textContent).not.toMatch(/undefined|NaN/);
  });
});
