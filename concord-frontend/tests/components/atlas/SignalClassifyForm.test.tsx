/**
 * SignalClassifyForm — Wave 4 gap-closure coverage for the atlas
 * capability-map's `cortex.classify` item (docs/lens-specs/atlas-capability-map.md
 * §1d): the ONE write path into the Atlas Signal Cortex taxonomy store.
 *
 * Pins: renders a real designed form (not a JSON-paste textarea), a
 * validation error surfaces for missing required fields (frequency /
 * coordinates) WITHOUT calling the backend, and a happy-path submit calls
 * `apiHelpers.atlasTomography.signalsClassify` with the macro's real input
 * shape (frequency, origin{lat,lng}, optional enrichment fields) and shows
 * the classification result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const signalsClassify = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    atlasTomography: {
      signalsClassify: (...args: unknown[]) => signalsClassify(...args),
    },
  },
}));

import { SignalClassifyForm } from '@/components/atlas/SignalClassifyForm';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('SignalClassifyForm', () => {
  beforeEach(() => {
    signalsClassify.mockReset();
  });

  it('renders a real designed form with distinct fields, not a raw JSON textarea', () => {
    const { getByPlaceholderText, getByLabelText, getByText, queryByRole } = renderWithQuery(<SignalClassifyForm />);
    expect(getByText('Report a Signal')).toBeInTheDocument();
    expect(getByPlaceholderText('Frequency (MHz) *')).toBeInTheDocument();
    expect(getByPlaceholderText('Latitude *')).toBeInTheDocument();
    expect(getByPlaceholderText('Longitude *')).toBeInTheDocument();
    expect(getByPlaceholderText('Bandwidth (MHz)')).toBeInTheDocument();
    expect(getByPlaceholderText('Power / signal strength')).toBeInTheDocument();
    expect(getByPlaceholderText('Description (e.g. device or source)')).toBeInTheDocument();
    expect(getByPlaceholderText('Keywords (comma-separated)')).toBeInTheDocument();
    expect(getByLabelText('Modulation')).toBeInTheDocument();
    // No generic raw-JSON textarea escape hatch.
    expect(queryByRole('textbox', { name: /json/i })).not.toBeInTheDocument();
  });

  it('shows a validation error and does NOT call the backend when frequency is missing', async () => {
    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SignalClassifyForm />);
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '40.7' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '-74' } });
    fireEvent.click(getByText('Classify signal'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/frequency/i);
    expect(signalsClassify).not.toHaveBeenCalled();
  });

  it('shows a validation error and does NOT call the backend when coordinates are missing', async () => {
    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SignalClassifyForm />);
    fireEvent.change(getByPlaceholderText('Frequency (MHz) *'), { target: { value: '900' } });
    fireEvent.click(getByText('Classify signal'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/latitude|longitude/i);
    expect(signalsClassify).not.toHaveBeenCalled();
  });

  it('submits the macro\'s real input shape and shows the classification result on success', async () => {
    signalsClassify.mockResolvedValue({
      data: {
        ok: true,
        signal: { id: 'sig_1', category: 'COMMUNICATION', purpose: 'COMMUNICATION', frequency: 900, adjustability: 'RESPOND_ALLOWED' },
      },
    });

    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SignalClassifyForm />);
    fireEvent.change(getByPlaceholderText('Frequency (MHz) *'), { target: { value: '900' } });
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '40.7128' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '-74.006' } });
    fireEvent.change(getByPlaceholderText('Bandwidth (MHz)'), { target: { value: '20' } });
    fireEvent.change(getByPlaceholderText('Description (e.g. device or source)'), { target: { value: 'rooftop tower' } });
    fireEvent.click(getByText('Classify signal'));

    await waitFor(() => expect(signalsClassify).toHaveBeenCalledTimes(1));
    const [payload] = signalsClassify.mock.calls[0] as [Record<string, unknown>];
    expect(payload.frequency).toBe(900);
    expect(payload.origin).toEqual({ lat: 40.7128, lng: -74.006 });
    expect(payload.bandwidth).toBe(20);
    expect(payload.description).toBe('rooftop tower');

    const status = await findByRole('status');
    expect(status.textContent).toMatch(/COMMUNICATION/);
  });

  it('surfaces a server-side rejection (e.g. invalid coordinates) without a false success state', async () => {
    signalsClassify.mockResolvedValue({ data: { ok: false, error: 'origin.lat and origin.lng (valid coordinates) are required' } });

    const { getByPlaceholderText, getByText, findByRole, queryByRole } = renderWithQuery(<SignalClassifyForm />);
    fireEvent.change(getByPlaceholderText('Frequency (MHz) *'), { target: { value: '900' } });
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '0' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '0' } });
    fireEvent.click(getByText('Classify signal'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/coordinates/i);
    expect(queryByRole('status')).not.toBeInTheDocument();
  });
});
