/**
 * AirQualityPanel stays click-to-load. Open-Meteo readings render as
 * modeled CAMS data. A failure is an honest unavailable state, never
 * an AirNow API-key wall.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { AirQualityPanel } from '@/components/environment/AirQualityPanel';

const READING = {
  data: {
    ok: true,
    result: {
      ok: true,
      source: 'Open-Meteo',
      sourceNote: 'Modeled CAMS data, not EPA monitor readings',
      observations: [
        {
          parameter: 'US AQI',
          parameterName: 'US AQI',
          aqi: 42,
          category: 'Good',
          reportingArea: 'San Francisco',
          stateCode: 'CA',
          dateObserved: '2026-10-11',
          hourObserved: 9,
          pm2_5: 8.1,
          pm10: 12.4,
          ozone: 68.2,
          no2: 11.5,
          co: 190,
        },
      ],
    },
    error: null,
  },
};

describe('AirQualityPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('does not call live_air_quality until Load AQI, then renders Open-Meteo', async () => {
    lensRun.mockResolvedValue(READING);
    render(<AirQualityPanel />);

    expect(screen.getByText(/Load AQI to query Open-Meteo/)).toBeInTheDocument();
    expect(screen.getByText(/modeled CAMS data, not EPA monitor readings/)).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(lensRun).not.toHaveBeenCalled();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledTimes(1);
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    expect(lensRun).toHaveBeenCalledWith({
      domain: 'environment',
      name: 'live_air_quality',
      input: { zipCode: '94110' },
    });
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('8.1')).toBeInTheDocument();
    expect(screen.getByText('12.4')).toBeInTheDocument();
    expect(screen.getByText('68.2')).toBeInTheDocument();
    expect(screen.getByText(/US AQI · San Francisco, CA/)).toBeInTheDocument();
    expect(screen.getByText(/Source: Open-Meteo/)).toBeInTheDocument();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();
    expect(screen.queryByText(/AirNow/)).not.toBeInTheDocument();
  });

  it('renders an honest unavailable state and does not invent an AQI', async () => {
    lensRun.mockResolvedValue({
      data: { ok: false, result: null, error: 'Open-Meteo air quality unreachable: HTTP 502' },
    });
    render(<AirQualityPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));
    await waitFor(() => {
      expect(screen.getByText(/Air quality unavailable/)).toBeInTheDocument();
    });
    expect(screen.getByText(/HTTP 502/)).toBeInTheDocument();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();
  });
});
