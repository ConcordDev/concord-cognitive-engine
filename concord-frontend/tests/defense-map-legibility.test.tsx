import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// C2 — the Map's counts count what they label, and unmapped records are
// named. cop-map now returns registry totals + the unmapped lists beside
// the mapped markers; the header must read registry totals with the
// plotted scope stated, and the coordinate-less records must be listed
// as having no coordinates — never silently absent.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/components/viz', () => ({
  MapView: ({ markers }: { markers: Array<{ lat: number }> }) => (
    <div data-testid="map-markers">{markers.length}</div>
  ),
}));

import { CommonOperatingPicture } from '@/components/defense/CommonOperatingPicture';

beforeEach(() => { lensRun.mockReset(); });

describe('defense map legibility (C2)', () => {
  it('counts registry rows, labels the plotted scope, and names the unmapped', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          markers: [
            { id: 'ast_1', kind: 'asset', label: 'MAPPED-TRUCK', lat: 41.7, lon: -73.9, affiliation: 'friendly' },
            { id: 'cop_1', kind: 'operation', label: 'PLOT-1', lat: 41.7, lon: -73.9, affiliation: 'unknown' },
          ],
          count: 2,
          byKind: { asset: 1, threat: 0, operation: 1 },
          totals: { asset: 2, threat: 1, operation: 1 },
          unmapped: {
            assets: [{ id: 'ast_2', label: 'UNMAPPED-TRUCK' }],
            threats: [{ id: 'thr_1', label: 'UNMAPPED-THREAT' }],
          },
        },
      },
    });
    render(<CommonOperatingPicture />);
    await waitFor(() => expect(screen.getByText('UNMAPPED-TRUCK')).toBeInTheDocument());
    // Headline counts are the registry (2 assets, 1 threat), scope labelled.
    expect(screen.getByText('2 assets · 1 on map')).toBeInTheDocument();
    expect(screen.getByText('1 threats · 0 on map')).toBeInTheDocument();
    expect(screen.getByText('1 markers')).toBeInTheDocument();
    // The unmapped are a named list, not an absence.
    expect(screen.getByText(/No coordinates — not on the map \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('UNMAPPED-THREAT')).toBeInTheDocument();
    // Only the geolocated records reach the map itself.
    expect(screen.getByTestId('map-markers')).toHaveTextContent('2');
  });

  it('with nothing unmapped, no no-coordinates section renders', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          markers: [{ id: 'ast_1', kind: 'asset', label: 'MAPPED-TRUCK', lat: 41.7, lon: -73.9, affiliation: 'friendly' }],
          count: 1,
          byKind: { asset: 1, threat: 0, operation: 0 },
          totals: { asset: 1, threat: 0, operation: 0 },
          unmapped: { assets: [], threats: [] },
        },
      },
    });
    render(<CommonOperatingPicture />);
    await waitFor(() => expect(screen.getByText('1 assets · 1 on map')).toBeInTheDocument());
    expect(screen.queryByText(/No coordinates — not on the map/)).not.toBeInTheDocument();
  });
});
