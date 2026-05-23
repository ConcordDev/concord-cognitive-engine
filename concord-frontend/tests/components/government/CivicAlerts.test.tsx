import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CivicAlerts } from '@/components/government/CivicAlerts';

const ALERTS = [
  {
    id: 'al1', category: 'weather', severity: 'extreme', title: 'Flood Warning',
    summary: 'Severe flooding expected.', area: 'County A', issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-05-02T00:00:00Z', source: 'NWS', url: 'https://x',
  },
  {
    id: 'al2', category: 'fire', severity: 'minor', title: 'Smoke Advisory',
    summary: 'Light smoke.', area: 'County B', issuedAt: '2026-05-01T00:00:00Z', source: 'CalFire',
  },
];

function mockGeo(success: boolean) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: () => void) => {
        if (success) ok({ coords: { latitude: 40, longitude: -73 } });
        else fail();
      },
    },
  });
}

describe('CivicAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { alerts: [] } } });
  });

  it('uses real geolocation and shows empty state', async () => {
    mockGeo(true);
    render(<CivicAlerts />);
    expect(await screen.findByText('No active alerts for your area.')).toBeInTheDocument();
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'alerts-current', input: { lat: 40, lng: -73 } }),
      ),
    );
  });

  it('falls back to default coords when geolocation fails', async () => {
    mockGeo(false);
    render(<CivicAlerts />);
    await screen.findByText('No active alerts for your area.');
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ input: { lat: 37.7749, lng: -122.4194 } }),
    );
  });

  it('renders alerts with severity badges and expiry', async () => {
    mockGeo(true);
    lensRun.mockResolvedValue({ data: { ok: true, result: { alerts: ALERTS } } });
    render(<CivicAlerts />);
    expect(await screen.findByText('Flood Warning')).toBeInTheDocument();
    expect(screen.getByText('Smoke Advisory')).toBeInTheDocument();
    expect(screen.getByText('extreme')).toBeInTheDocument();
    expect(screen.getByText('minor')).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    mockGeo(true);
    lensRun.mockRejectedValue(new Error('down'));
    render(<CivicAlerts />);
    expect(await screen.findByText('No active alerts for your area.')).toBeInTheDocument();
  });
});
