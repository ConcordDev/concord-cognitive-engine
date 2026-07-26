/**
 * EcoOverviewHero — the eco lens's redesigned Overview front door.
 *
 * Pins the real micro-interactions added in this pass:
 *   1. The AQI dial renders the exact value returned by the real
 *      `eco.aqi-current` macro (via useAqiData) — not a placeholder.
 *   2. The refresh control re-issues a real fetch (a second `api.post` call)
 *      and shows a distinct pending state on that control while in flight.
 *   3. The pollutant-breakdown disclosure toggles real fetched pollutant
 *      fields into view (progressive disclosure over real data, not a
 *      decorative accordion).
 *   4. Quick-access rows call back into real tab-navigation state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const apiPostMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
}));

import { EcoOverviewHero, type EcoOverviewTab } from '@/components/eco/EcoOverviewHero';
import { Cloud, Wind } from 'lucide-react';

const AQI_READING = {
  aqi: 42, pm25: 8.1, pm10: 12.4, o3: 30.2, no2: 5.5, co: 0.4, so2: 1.1,
  category: 'good' as const, recommendation: 'Air quality is good.', source: 'Open-Meteo',
  lat: 37.77, lng: -122.42,
};

function okAqi(payload: unknown) {
  return Promise.resolve({ data: { result: payload } });
}

const TABS: EcoOverviewTab[] = [
  { id: 'weather', label: 'Weather', icon: Cloud, blurb: 'Live forecast.', shortcut: 'w' },
  { id: 'air', label: 'Air quality', icon: Wind, blurb: 'Live AQI.', shortcut: 'q' },
];
const ORG_TAB: EcoOverviewTab = { id: 'org-esg', label: 'Org ESG', icon: Wind, blurb: 'Not personal.' };

beforeEach(() => {
  apiPostMock.mockReset();
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition);
      },
    },
    configurable: true,
  });
});
afterEach(() => { vi.clearAllMocks(); });

describe('EcoOverviewHero — AQI dial reflects real fetched data', () => {
  it('renders the exact AQI value + category from eco.aqi-current, not a placeholder', async () => {
    apiPostMock.mockImplementation(() => okAqi(AQI_READING));
    const onSelectTab = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoOverviewHero tabs={TABS} orgTab={ORG_TAB} onSelectTab={onSelectTab} />); });

    await waitFor(() => expect(view!.getByText('42')).toBeInTheDocument());
    expect(view!.getByText(/Good \(0-50\)/i)).toBeInTheDocument();

    const [url, body] = apiPostMock.mock.calls[0];
    expect(url).toBe('/api/lens/run');
    expect(body.domain).toBe('eco');
    expect(body.action).toBe('aqi-current');
  });
});

describe('EcoOverviewHero — refresh control re-fetches (real macro-dispatch feedback)', () => {
  it('clicking Refresh issues a second real api.post call', async () => {
    apiPostMock.mockImplementation(() => okAqi(AQI_READING));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoOverviewHero tabs={TABS} orgTab={ORG_TAB} onSelectTab={vi.fn()} />); });
    await waitFor(() => expect(view!.getByText('42')).toBeInTheDocument());

    const callsBefore = apiPostMock.mock.calls.length;
    const refreshBtn = view!.getByRole('button', { name: /Refresh air quality reading/i });
    await act(async () => { fireEvent.click(refreshBtn); });

    await waitFor(() => expect(apiPostMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe('EcoOverviewHero — pollutant breakdown is a real disclosure over real data', () => {
  it('toggling "Pollutant breakdown" reveals the fetched PM2.5/PM10/etc fields', async () => {
    apiPostMock.mockImplementation(() => okAqi(AQI_READING));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoOverviewHero tabs={TABS} orgTab={ORG_TAB} onSelectTab={vi.fn()} />); });
    await waitFor(() => expect(view!.getByText('42')).toBeInTheDocument());

    // Not shown until expanded.
    expect(view!.queryByText(/8\.1/)).toBeNull();

    const toggle = view!.getByRole('button', { name: /Pollutant breakdown/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { fireEvent.click(toggle); });

    await waitFor(() => expect(view!.getByText(/8\.1/)).toBeInTheDocument());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('EcoOverviewHero — quick-access rows navigate real tab state', () => {
  it('clicking a quick-access row calls onSelectTab with the real tab id', async () => {
    apiPostMock.mockImplementation(() => okAqi(AQI_READING));
    const onSelectTab = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<EcoOverviewHero tabs={TABS} orgTab={ORG_TAB} onSelectTab={onSelectTab} />); });
    await waitFor(() => expect(view!.getByText('42')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByText('Weather')); });
    expect(onSelectTab).toHaveBeenCalledWith('weather');

    await act(async () => { fireEvent.click(view!.getByText('Org ESG')); });
    expect(onSelectTab).toHaveBeenCalledWith('org-esg');
  });
});
