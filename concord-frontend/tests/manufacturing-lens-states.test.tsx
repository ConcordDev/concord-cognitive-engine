/**
 * /lenses/manufacturing — four-UX-state contract for the Manufacturing lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Retry that
 * RE-FETCHES) / empty (with a CTA) / populated states against its real backend
 * channel: the artifact list (useLensData('manufacturing', <type>) → GET
 * /api/lens/manufacturing). No fabricated data — every state is driven by a
 * mocked useLensData standing in for the real backend in the exact shape the
 * lens hook returns.
 *
 * This lens is ALREADY-WIRED (PATH 3 — server/domains/manufacturing.js via
 * registerLensAction). The domain id 'manufacturing' has no dash, so there is
 * no hyphenation contract to assert; this test asserts the four states render
 * and that a failed list does NOT silently fall through to an empty surface
 * (the swallowed-fetch → silent-empty class).
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
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// lens chrome + cross-lens panels → null
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));

// manufacturing child panels → inert (each owns its own backend channel; out of scope)
vi.mock('@/components/manufacturing/ManufacturingFeed', () => ({ ManufacturingFeed: () => null }));
vi.mock('@/components/manufacturing/ManufacturingActionPanel', () => ({ ManufacturingActionPanel: () => null }));
vi.mock('@/components/manufacturing/OEEDashboard', () => ({ default: () => null }));
vi.mock('@/components/manufacturing/WorkOrderBoard', () => ({ default: () => null }));
vi.mock('@/components/manufacturing/QualitySPC', () => ({ default: () => null }));
vi.mock('@/components/manufacturing/ShopFloorSuite', () => ({ default: () => null }));

// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import ManufacturingLens from '@/app/lenses/manufacturing/page';

const WO_ITEM = {
  id: 'wo_1',
  title: 'WO-0301 Pump body',
  data: { type: 'WorkOrder', product: 'Pump body', qty: 100, completedQty: 40 },
  meta: { status: 'in_progress' },
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

describe('manufacturing lens — four UX states', () => {
  it('LOADING: shows the loading indicator while the artifact list is in flight', async () => {
    mockLensData({ isLoading: true });
    const { getByText } = render(<ManufacturingLens />);
    await waitFor(() => expect(getByText(/Loading manufacturing/i)).toBeInTheDocument());
  });

  it('ERROR: a failed list shows the error message + a working Retry that re-fetches (no silent-empty)', async () => {
    mockLensData({ isError: true, error: { message: 'manufacturing feed offline' } });
    const { getByText } = render(<ManufacturingLens />);
    await waitFor(() => expect(getByText(/manufacturing feed offline/i)).toBeInTheDocument());

    // The Retry button (ErrorState renders "Try again") re-invokes refetch —
    // proving the error surface is NOT a swallowed-fetch silent-empty.
    const before = refetch.mock.calls.length;
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: the Work Orders tab shows the honest "No work orders found" CTA', async () => {
    mockLensData({ items: [], total: 0 });
    const { getByText } = render(<ManufacturingLens />);
    // Default mode is the dashboard; switch to the Work Orders tab to reach the
    // artifact-list view (where empty/populated render).
    await act(async () => { fireEvent.click(getByText('Work Orders')); });
    await waitFor(() => expect(getByText(/No work orders found/i)).toBeInTheDocument());
    expect(getByText(/Create one/i)).toBeInTheDocument();
  });

  it('POPULATED: the Work Orders tab renders the real work-order row from the artifact list', async () => {
    mockLensData({ items: [WO_ITEM], total: 1 });
    const { getByText } = render(<ManufacturingLens />);
    await act(async () => { fireEvent.click(getByText('Work Orders')); });
    await waitFor(() => expect(getByText('WO-0301 Pump body')).toBeInTheDocument());
  });
});
