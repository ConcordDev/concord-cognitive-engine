/**
 * ForecastPanel stays click-to-load and renders National Weather Service
 * periods. A point outside the US is an honest unavailable state unless
 * the server already fell back to OpenWeatherMap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { ForecastPanel } from '@/components/weather/ForecastPanel';

const NWS = {
  data: {
    ok: true,
    result: {
      ok: true,
      source: 'NWS api.weather.gov',
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
      current: { description: 'Partly Cloudy', tempF: 65, humidity: 72, stationId: 'KSFO' },
      alerts: [{ event: 'Wind Advisory', severity: 'Moderate' }],
      forecasts: [
        {
          dtTxt: 'This Afternoon',
          description: 'Partly Cloudy',
          temp: 68,
          temperatureUnit: 'F',
          pop: 0.2,
          humidity: null,
        },
      ],
    },
  },
};

describe('ForecastPanel', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('does not fetch on mount, then renders the NWS forecast', async () => {
    post.mockResolvedValue(NWS);
    render(<ForecastPanel />);

    expect(screen.getByText(/Load the forecast to query the National Weather Service/)).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load forecast' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/api/lens/run', {
      domain: 'weather',
      name: 'live_forecast',
      input: { city: 'San Francisco' },
    });
    expect(screen.getByText('This Afternoon')).toBeInTheDocument();
    expect(screen.getAllByText('Partly Cloudy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('68°F')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText(/65°F/)).toBeInTheDocument();
    expect(screen.getByText(/Wind Advisory/)).toBeInTheDocument();
    expect(screen.getByText(/api\.weather\.gov/)).toBeInTheDocument();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();
  });

  it('shows unavailable outside the US without a fake temperature', async () => {
    post.mockResolvedValue({
      data: {
        ok: false,
        reason: 'unavailable_outside_us',
        error: 'unavailable outside the US',
        message: 'National Weather Service covers US points only. No OpenWeatherMap key is configured, so this location stays unavailable.',
      },
    });
    render(<ForecastPanel />);
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'London' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await waitFor(() => {
      expect(screen.getByText(/unavailable outside the US|stays unavailable/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/°F/)).not.toBeInTheDocument();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();
  });
});
