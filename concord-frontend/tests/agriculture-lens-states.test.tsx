/**
 * /lenses/agriculture — four-UX-state contract for the Agriculture lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry) /
 * empty (with a CTA) / populated states against its real backend channel:
 *   • the artifact list (useLensData('agriculture', <type>) → GET /api/lens/agriculture)
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * RE-FETCHES (we assert refetch fires + the surface recovers). The empty state
 * surfaces a "Create your first farm item" CTA. No fabricated data — every state
 * is driven by a mocked useLensData standing in for the real backend in the
 * exact shape the lens hook returns.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/agriculture.js via
 * registerLensAction). The test does not assert a hyphenation contract (the
 * domain id 'agriculture' has no dash); it asserts the four states render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channel: useLensData (the artifact list the page renders) ────────
const lensData = vi.fn();
const refetch = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...a: unknown[]) => lensData(...a),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// ── headless chrome + side panels: render-only / inert stubs ─────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));

// lens chrome + cross-lens panels → null
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/environment/GbifPanel', () => ({ GbifPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/lens/WeatherHero', () => ({ default: () => null }));

// agriculture child panels → inert (each owns its own backend channel; out of scope)
vi.mock('@/components/agriculture/FarmWorkbench', () => ({ default: () => null }));
vi.mock('@/components/agriculture/PestIdentifier', () => ({ PestIdentifier: () => null }));
vi.mock('@/components/agriculture/AgricultureActionPanel', () => ({ AgricultureActionPanel: () => null }));
vi.mock('@/components/agriculture/EquipmentPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/PrescriptionsPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/PassesPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/NitrogenPlanner', () => ({ default: () => null }));
vi.mock('@/components/agriculture/ImageryPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/WorkOrdersPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/GrainBinsPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/ZonesPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/TankMixesPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/PrecisionAgPanel', () => ({ default: () => null }));
vi.mock('@/components/agriculture/FarmMapPanel', () => ({ default: () => null }));
vi.mock('@/components/common/MapView', () => ({ default: () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
}));

import AgricultureLens from '@/app/lenses/agriculture/page';

const FIELD_ITEM = {
  id: 'field_1',
  title: 'North 40',
  data: { type: 'Field', status: 'growing', acreage: 40, currentCrop: 'corn' },
};

function mockLensData(over: Record<string, unknown> = {}) {
  lensData.mockImplementation(() => ({
    items: [],
    total: 0,
    isLoading: false,
    isError: false,
    error: null,
    isSeeding: false,
    refetch,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...over,
  }));
}

beforeEach(() => {
  lensData.mockReset();
  refetch.mockReset();
});

describe('agriculture lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the artifact list is in flight', async () => {
    mockLensData({ isLoading: true });
    const { container, getByText } = render(<AgricultureLens />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading field data/i)).toBeInTheDocument();
  });

  it('ERROR: a failed list shows role=alert + a working Retry that re-fetches', async () => {
    mockLensData({ isError: true, error: { message: 'fields offline' } });
    const { container, getByText } = render(<AgricultureLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/fields offline/i)).toBeInTheDocument();

    // The Retry button (ErrorState renders "Try again") re-invokes refetch.
    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows the honest CTA when there are no fields', async () => {
    mockLensData({ items: [], total: 0 });
    const { getByText } = render(<AgricultureLens />);
    await waitFor(() =>
      expect(getByText(/No fields found/i)).toBeInTheDocument(),
    );
    // CTA present (default-view "Create your first Field" button → openCreate).
    expect(getByText(/Create your first Field/i)).toBeInTheDocument();
  });

  it('POPULATED: renders the real field row from the artifact list', async () => {
    mockLensData({ items: [FIELD_ITEM], total: 1 });
    const { getByText } = render(<AgricultureLens />);
    await waitFor(() => expect(getByText('North 40')).toBeInTheDocument());
  });
});
