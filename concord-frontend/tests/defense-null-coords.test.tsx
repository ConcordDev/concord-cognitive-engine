import { beforeEach, describe, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const persist = vi.fn();
let restoredState: Record<string, unknown> | null = null;

vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => restoredState, persist, clear: vi.fn() }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div> }),
}));
vi.mock('@/components/viz', () => ({
  MapView: ({ markers }: { markers: Array<{ lat: number }> }) => {
    markers.forEach((m) => m.lat.toFixed(2)); // what the real map does with each marker
    return <div data-testid="map-markers">{markers.length}</div>;
  },
}));

import { CommonOperatingPicture } from '@/components/defense/CommonOperatingPicture';

const MARKERS = [
  { id: 'ast_1', kind: 'asset', label: 'PR2DEFENSE-ASSET-1101', lat: null, lon: null, affiliation: 'friendly' },
  { id: 'thr_1', kind: 'threat', label: 'Placed threat', lat: 12.5, lon: -45.25, affiliation: 'hostile' },
];

beforeEach(() => { lensRun.mockReset(); persist.mockReset(); restoredState = null; });

describe('defense map with an asset that has no coordinates', () => {
  it('renders without throwing, skips the asset on the map and says so in the list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { markers: MARKERS, count: 2, byKind: { asset: 1, threat: 1, operation: 0 } } } });
    render(<CommonOperatingPicture />);
    await waitFor(() => expect(screen.getByText('PR2DEFENSE-ASSET-1101')).toBeInTheDocument());
    expect(screen.getByTestId('map-markers')).toHaveTextContent('1');
    expect(screen.getByText('no coordinates')).toBeInTheDocument();
    expect(screen.getByText('12.50, -45.25')).toBeInTheDocument();
  });
});
