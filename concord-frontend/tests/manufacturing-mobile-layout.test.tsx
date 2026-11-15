/**
 * FIX-manufacturing-004 — Manufacturing at 390px.
 *
 * (1) The selected view rendered BELOW the always-on Industry Wire feed
 * and the four KPI stat cards — on mobile the cards stack to ~400px, so
 * switching to the OEE Board pushed it under the fold instead of
 * replacing the view. The column now orders the view first below sm;
 * desktop order is unchanged. (2) The Actions bench header did not
 * wrap, so its trailing badge crowded the "Shop-floor bench" title.
 * (3) The floating "Open work orders" CTA was a self-switch on the
 * work-order board; it now renders only from the other views.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => <div>industry wire</div> }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/manufacturing/ManufacturingFeed', () => ({ ManufacturingFeed: () => null }));
vi.mock('@/components/manufacturing/ManufacturingActionPanel', () => ({ ManufacturingActionPanel: () => <div>action bench</div> }));
vi.mock('@/components/manufacturing/ShopFloorToolsPanel', () => ({ ShopFloorToolsPanel: () => null }));
vi.mock('@/components/manufacturing/OEEDashboard', () => ({ default: () => <div>oee dashboard</div> }));
vi.mock('@/components/manufacturing/WorkOrderBoard', () => ({ default: () => <div>work order board</div> }));
vi.mock('@/components/manufacturing/QualitySPC', () => ({ default: () => null }));
vi.mock('@/components/manufacturing/ShopFloorSuite', () => ({ default: () => <div>shop floor suite</div> }));
vi.mock('@/components/manufacturing/DeleteSafety', () => ({ DeleteReceiptToast: () => null }));
vi.mock('@/lib/community/CommunityRedditSlot', () => ({
  CommunityRedditSlot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/community/reddit-flag', () => ({
  omitCommunityRedditViews: (tabs: unknown) => tabs,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ data: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: {},
}));

import ManufacturingLensPage from '@/app/lenses/manufacturing/page';
import { PipingProvider } from '@/components/panel-polish';

describe('FIX-manufacturing-004 — view order + CTA at 390px', () => {
  it('orders the selected view first below sm and drops the self-switch CTA on Work Orders', () => {
    const { container } = render(<ManufacturingLensPage />);
    const skip = container.querySelector('#manufacturing-skip');
    expect(skip).toBeTruthy();
    expect(skip!.className).toContain('order-1');
    expect(skip!.className).toContain('sm:order-3');
    const kpis = container.querySelector('[aria-busy]');
    expect(kpis!.className).toContain('order-3');
    expect(kpis!.className).toContain('sm:order-2');
    expect(screen.getByText('shop floor suite')).toBeTruthy();
    const cta = screen.getByTestId('north-star-cta');
    expect(cta.textContent).toContain('Open work orders');
    fireEvent.click(cta);
    expect(screen.getByText('work order board')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
  });

  it('switching to the OEE Board replaces the shop-floor view in the lead slot', () => {
    render(<ManufacturingLensPage />);
    fireEvent.click(screen.getByRole('button', { name: /OEE Board/ }));
    expect(screen.getByText('oee dashboard')).toBeTruthy();
    expect(screen.queryByText('shop floor suite')).toBeNull();
  });
});

describe('FIX-manufacturing-004 — Actions bench header', () => {
  it('wraps so the badge cannot crowd the title', async () => {
    const { ManufacturingActionPanel } = await vi.importActual<typeof import('@/components/manufacturing/ManufacturingActionPanel')>(
      '@/components/manufacturing/ManufacturingActionPanel',
    );
    render(
      <PipingProvider>
        <ManufacturingActionPanel />
      </PipingProvider>,
    );
    const title = screen.getByText('Shop-floor bench');
    const header = title.closest('header');
    expect(header).toBeTruthy();
    expect(header!.className).toContain('flex-wrap');
  });
});
