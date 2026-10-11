/**
 * EPA/USGS "Load AQI" must not call AirNow on mount. A missing or
 * rejected key is the missing_api_key envelope (or the old HTTP 400
 * body "AIRNOW_API_KEY invalid"). The panel renders an honest failure
 * and does not log it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      runDomain: (...args: unknown[]) => runDomain(...args),
    },
  },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { EnviroPanel } from '@/components/environment/EnviroPanel';

const KEY_FAILURE = 'Air quality data unavailable: AirNow API key missing or rejected';

const MISSING_KEY = {
  data: {
    ok: false,
    error: 'missing_api_key',
    reason: 'missing_api_key',
    envVar: 'EPA_AIRNOW_API_KEY',
    signupUrl: 'https://docs.airnowapi.org/account/request/',
    message: 'Set EPA_AIRNOW_API_KEY in .env to enable this panel.',
  },
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EnviroPanel />
    </QueryClientProvider>,
  );
}

describe('EnviroPanel AirNow', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runDomain.mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('does not call airnow-current until Load AQI, then renders the key failure', async () => {
    runDomain.mockResolvedValue(MISSING_KEY);
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Environmental data (EPA / USGS)' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(runDomain).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(KEY_FAILURE);
    });
    expect(runDomain).toHaveBeenCalledTimes(1);
    expect(runDomain).toHaveBeenCalledWith('environment', 'airnow-current', {
      input: { zipCode: '94110' },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('renders the same failure when the request rejects with AIRNOW_API_KEY invalid', async () => {
    runDomain.mockRejectedValue({
      response: { status: 400, data: { ok: false, error: 'AIRNOW_API_KEY invalid' } },
      message: 'Request failed with status code 400',
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(KEY_FAILURE);
    });
    expect(runDomain).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
