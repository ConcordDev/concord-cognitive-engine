/**
 * AirQualityPanel must not call EPA AirNow on mount. Prod has no
 * EPA_AIRNOW_API_KEY, and a mount-time live_air_quality with the
 * hardcoded ZIP 94110 was logging HTTP 422 on every /lenses/environment
 * visit. The request waits for Load AQI, and a missing_api_key result
 * renders the honest needs-a-key state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { AirQualityPanel } from '@/components/environment/AirQualityPanel';

const MISSING_KEY = {
  data: {
    ok: false,
    result: null,
    error: 'missing_api_key',
    reason: 'missing_api_key',
    envVar: 'EPA_AIRNOW_API_KEY',
    signupUrl: 'https://docs.airnowapi.org/account/request/',
  },
};

describe('AirQualityPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('does not call live_air_quality until Load AQI, then renders a missing key', async () => {
    lensRun.mockResolvedValue(MISSING_KEY);
    render(<AirQualityPanel />);

    expect(screen.getByText(/Load AQI to query EPA AirNow/)).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(lensRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledTimes(1);
    });
    expect(lensRun).toHaveBeenCalledWith({
      domain: 'environment',
      name: 'live_air_quality',
      input: { zipCode: '94110' },
    });
    expect(screen.getByText('API key required')).toBeInTheDocument();
    expect(screen.getByText('EPA_AIRNOW_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Free signup/ })).toHaveAttribute(
      'href',
      'https://docs.airnowapi.org/account/request/'
    );
    expect(screen.queryByText(/AirNow unreachable/)).not.toBeInTheDocument();
  });
});
