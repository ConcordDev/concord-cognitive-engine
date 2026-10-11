/**
 * EnviroPanel AQI stays click-to-load and labels Open-Meteo CAMS data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { EnviroPanel } from '@/components/environment/EnviroPanel';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnviroPanel />
    </QueryClientProvider>,
  );
}

describe('EnviroPanel air quality', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });

  it('does not fetch AQI on mount, then renders the Open-Meteo reading', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          source: 'Open-Meteo',
          sourceNote: 'Modeled CAMS data, not EPA monitor readings',
          observations: [
            {
              parameterName: 'US AQI',
              aqi: 42,
              category: 'Good',
              reportingArea: 'San Francisco',
              stateCode: 'CA',
              dateObserved: '2026-10-11',
              hourObserved: 9,
            },
            {
              parameterName: 'PM2.5',
              aqi: null,
              value: 8.1,
              unit: 'µg/m³',
              reportingArea: 'San Francisco',
              stateCode: 'CA',
              dateObserved: '2026-10-11',
              hourObserved: 9,
            },
          ],
        },
      },
    });
    renderPanel();

    expect(screen.getByText('Current AQI (Open-Meteo)')).toBeInTheDocument();
    expect(screen.getByText(/not EPA monitor readings/)).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(runDomain).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load AQI' }));
    await waitFor(() => expect(runDomain).toHaveBeenCalledTimes(1));
    expect(runDomain).toHaveBeenCalledWith('environment', 'airnow-current', { input: { zipCode: '94110' } });
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('US AQI')).toBeInTheDocument();
    expect(screen.getByText('PM2.5')).toBeInTheDocument();
    expect(screen.getByText(/8\.1/)).toBeInTheDocument();
    expect(screen.getByText('Modeled CAMS data, not EPA monitor readings')).toBeInTheDocument();
    expect(screen.queryByText('API key required')).not.toBeInTheDocument();
  });
});
