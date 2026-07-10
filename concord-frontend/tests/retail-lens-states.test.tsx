/**
 * /lenses/retail — real-backend wiring contract for the Retail & Commerce lens.
 *
 * Historical note: this file used to pin a generic `useLensData`/`useRunArtifact`
 * artifact-CRUD system that stood in front of `server/domains/retail.js`'s 85
 * macros — six fake tabs (Products/Orders/Customers/Pipeline/Support/Displays)
 * backed by a client-side artifact store with NO backing macro for
 * create/update/delete, running in parallel to (and completely disconnected
 * from) the real STATE-backed product/order/customer system already surfaced
 * by RetailWorkbench, CustomersPanel, CommerceSuite, etc. That system has been
 * removed (Wave 3 Frontend Rebuild Program pass — see
 * docs/lens-specs/retail-capability-map.md). The page no longer imports
 * `useLensData` or `useRunArtifact` at all — every surface is one of the real,
 * macro-backed panels. This file now pins that the page mounts cleanly and
 * that the real panels + the Retail Workbench toggle are wired, instead of
 * asserting behavior of the removed fake CRUD system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
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
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));

const workbenchProps: { open?: boolean } = {};
vi.mock('@/components/retail/RetailWorkbench', () => ({
  default: (props: { open: boolean }) => {
    workbenchProps.open = props.open;
    return props.open ? React.createElement('div', { 'data-testid': 'retail-workbench-open' }, 'Workbench open') : null;
  },
}));
vi.mock('@/components/retail/TaxRatesPanel', () => ({ TaxRatesPanel: () => null }));
vi.mock('@/components/retail/LivePosTerminal', () => ({ LivePosTerminal: () => React.createElement('div', { 'data-testid': 'live-pos-terminal' }) }));
vi.mock('@/components/retail/RetailActionPanel', () => ({ RetailActionPanel: () => React.createElement('div', { 'data-testid': 'retail-action-panel' }) }));
vi.mock('@/components/retail/CustomersPanel', () => ({ default: () => React.createElement('div', { 'data-testid': 'customers-panel' }) }));
vi.mock('@/components/retail/DiscountsManager', () => ({ default: () => null }));
vi.mock('@/components/retail/AbandonedCartsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/ShippingZonesEditor', () => ({ default: () => null }));
vi.mock('@/components/retail/GiftCardsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/RefundsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/CollectionsPanel', () => ({ default: () => null }));
vi.mock('@/components/retail/InventoryTransfers', () => ({ default: () => null }));
vi.mock('@/components/retail/SalesAnalytics', () => ({ default: () => React.createElement('div', { 'data-testid': 'sales-analytics' }) }));
vi.mock('@/components/retail/CommerceSuite', () => ({ default: () => React.createElement('div', { 'data-testid': 'commerce-suite' }) }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import RetailLens from '@/app/lenses/retail/page';

beforeEach(() => {
  workbenchProps.open = undefined;
});

describe('retail lens — real macro-backed surfaces (no fabricated artifact CRUD)', () => {
  it('mounts inside LensShell without crashing', () => {
    render(<RetailLens />);
    expect(screen.getByTestId('lens-shell')).toBeInTheDocument();
  });

  it('mounts the real POS terminal, sales analytics (default workbench tab), commerce suite, and ops action panel', () => {
    render(<RetailLens />);
    expect(screen.getByTestId('live-pos-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('sales-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('commerce-suite')).toBeInTheDocument();
    expect(screen.getByTestId('retail-action-panel')).toBeInTheDocument();
  });

  it('Retail workbench sub-tabs switch to the real customers panel (not a fake CRM tab)', () => {
    render(<RetailLens />);
    expect(screen.queryByTestId('customers-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Customers'));
    expect(screen.getByTestId('customers-panel')).toBeInTheDocument();
  });

  it('Retail Workbench starts closed and opens on click (real POS/catalog/orders/low-stock modal, not a fake CRUD editor)', () => {
    render(<RetailLens />);
    expect(workbenchProps.open).toBe(false);
    fireEvent.click(screen.getByText('Retail Workbench'));
    expect(workbenchProps.open).toBe(true);
    expect(screen.getByTestId('retail-workbench-open')).toBeInTheDocument();
  });

  it('no longer imports the generic artifact-CRUD hooks (useLensData / useRunArtifact)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../app/lenses/retail/page.tsx'), 'utf8');
    expect(source).not.toMatch(/use-lens-data/);
    expect(source).not.toMatch(/use-lens-artifacts/);
    expect(source).not.toMatch(/useLensData|useRunArtifact/);
  });
});
