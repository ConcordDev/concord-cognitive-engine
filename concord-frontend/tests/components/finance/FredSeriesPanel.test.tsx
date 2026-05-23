import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FredSeriesPanel } from '@/components/finance/FredSeriesPanel';

describe('FredSeriesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders real series data with latest + earliest values', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        seriesId: 'GDP',
        observations: [
          { date: '2025-01-01', value: 100 },
          { date: '2025-04-01', value: 110 },
          { date: '2025-07-01', value: null },
          { date: '2025-10-01', value: 120 },
        ],
      },
    });
    render(<FredSeriesPanel />);
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('was 100')).toBeInTheDocument();
  });

  it('renders the missing-api-key state with signup link', async () => {
    lensRun.mockResolvedValue({
      data: { ok: false, reason: 'missing_api_key', envVar: 'FRED_API_KEY', signupUrl: 'https://fred.example/signup' },
    });
    render(<FredSeriesPanel />);
    expect(await screen.findByText('API key required')).toBeInTheDocument();
    expect(screen.getByText('FRED_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('Free signup')).toBeInTheDocument();
  });

  it('renders an unreachable error state for non-key failures', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, reason: 'network_error' } });
    render(<FredSeriesPanel />);
    expect(await screen.findByText(/FRED unreachable \(network_error\)/)).toBeInTheDocument();
  });

  it('renders the no-data state for an ok response with no observations', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, observations: [] } });
    render(<FredSeriesPanel />);
    expect(await screen.findByText(/No data for that series/)).toBeInTheDocument();
  });

  it('changes the series via the select and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, observations: [] } });
    render(<FredSeriesPanel className="extra" />);
    await screen.findByText(/No data for that series/);
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'UNRATE' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ series_id: 'UNRATE' }) })),
    );
  });

  it('refreshes on the refresh button click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, observations: [] } });
    render(<FredSeriesPanel />);
    await screen.findByText(/No data for that series/);
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Refresh'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('tolerates a rejected macro call', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<FredSeriesPanel />);
    expect(await screen.findByText(/Source: Federal Reserve Bank/)).toBeInTheDocument();
  });
});
