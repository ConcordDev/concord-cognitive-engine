import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// PinDropMap is dynamically imported; replace it with a stub exposing the onPick callback
vi.mock('next/dynamic', () => ({
  default: () => {
    const PinStub = (props: { onPick: (lat: number, lng: number) => void; pin: unknown }) => (
      <div data-testid="pin-map">
        <button data-testid="drop-pin" onClick={() => props.onPick(40.5, -73.5)}>drop</button>
        <span data-testid="has-pin">{props.pin ? 'pinned' : 'no-pin'}</span>
      </div>
    );
    return PinStub;
  },
}));

import { ServiceRequestReporter } from '@/components/government/ServiceRequestReporter';

const REQUESTS = [
  { id: 'r1', referenceNumber: 'SR-1', category: 'pothole', description: 'hole', lat: 40, lng: -73, address: '1 St', status: 'submitted', priority: 'high', createdAt: '2026-01-01' },
];

describe('ServiceRequestReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { requests: [] } } });
  });

  it('shows the no-reports empty state', async () => {
    render(<ServiceRequestReporter />);
    expect(await screen.findByText('No reports yet.')).toBeInTheDocument();
  });

  it('renders recent reports list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { requests: REQUESTS } } });
    render(<ServiceRequestReporter />);
    expect(await screen.findByText('SR-1')).toBeInTheDocument();
    expect(screen.getByText(/1 mapped/)).toBeInTheDocument();
  });

  it('errors when submitting without a pin', async () => {
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByText('Submit report'));
    expect(await screen.findByText('Click the map to drop a pin first.')).toBeInTheDocument();
  });

  it('errors when submitting with a pin but no description', async () => {
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByTestId('drop-pin'));
    expect(screen.getByTestId('has-pin').textContent).toBe('pinned');
    fireEvent.click(screen.getByText('Submit report'));
    expect(await screen.findByText('Describe the issue.')).toBeInTheDocument();
  });

  it('submits a report when pin and description are present', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'service-requests-create'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { requests: [] } } }),
    );
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByTestId('drop-pin'));
    fireEvent.change(screen.getByPlaceholderText(/Describe the issue/), { target: { value: 'deep pothole' } });
    fireEvent.click(screen.getByText('Submit report'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service-requests-create', input: expect.objectContaining({ lat: 40.5, lng: -73.5 }) }),
      ),
    );
  });

  it('surfaces a submit error on ok:false', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'service-requests-create'
        ? Promise.resolve({ data: { ok: false, error: 'spam blocked' } })
        : Promise.resolve({ data: { ok: true, result: { requests: [] } } }),
    );
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByTestId('drop-pin'));
    fireEvent.change(screen.getByPlaceholderText(/Describe the issue/), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Submit report'));
    expect(await screen.findByText('spam blocked')).toBeInTheDocument();
  });

  it('uses geolocation to set the pin', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 12, longitude: 34 } }) },
    });
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByText('Use my location'));
    await waitFor(() => expect(screen.getByTestId('has-pin').textContent).toBe('pinned'));
  });

  it('shows an error when geolocation fails', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
    });
    render(<ServiceRequestReporter />);
    await screen.findByText('No reports yet.');
    fireEvent.click(screen.getByText('Use my location'));
    expect(await screen.findByText(/Could not get your location/)).toBeInTheDocument();
  });

  it('tolerates a fetch rejection on load', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ServiceRequestReporter />);
    expect(await screen.findByText('No reports yet.')).toBeInTheDocument();
  });
});
