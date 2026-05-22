import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub every child panel so EtsySection's own logic is isolated.
// vi.hoisted keeps `stub` available inside the hoisted vi.mock factories.
const { stub } = vi.hoisted(() => {
  const React = require('react');
  return {
    stub: (name: string) => () => React.createElement('div', { 'data-testid': name }, name),
  };
});
vi.mock('@/components/marketplace/ShopDashboard', () => ({
  ShopDashboard: ({ onJumpTo }: { onJumpTo: (n: string) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'ShopDashboard', onClick: () => onJumpTo('listings') },
      'ShopDashboard',
    ),
}));
vi.mock('@/components/marketplace/ListingsPanel', () => ({ ListingsPanel: stub('ListingsPanel') }));
vi.mock('@/components/marketplace/OrdersPanel', () => ({ OrdersPanel: stub('OrdersPanel') }));
vi.mock('@/components/marketplace/StatsPanel', () => ({
  StatsPanel: stub('StatsPanel'),
  SearchVisibilityPanel: stub('SearchVisibilityPanel'),
}));
vi.mock('@/components/marketplace/MarketingPanel', () => ({ MarketingPanel: stub('MarketingPanel') }));
vi.mock('@/components/marketplace/InsightsPanel', () => ({ InsightsPanel: stub('InsightsPanel') }));
vi.mock('@/components/marketplace/ShopSettingsPanel', () => ({
  ShopSettingsPanel: stub('ShopSettingsPanel'),
}));
vi.mock('@/components/marketplace/StorefrontPanel', () => ({
  StorefrontPanel: stub('StorefrontPanel'),
}));
vi.mock('@/components/marketplace/ReviewsPanel', () => ({ ReviewsPanel: stub('ReviewsPanel') }));
vi.mock('@/components/marketplace/MessagesPanel', () => ({ MessagesPanel: stub('MessagesPanel') }));
vi.mock('@/components/marketplace/VariationsPanel', () => ({
  VariationsPanel: stub('VariationsPanel'),
}));
vi.mock('@/components/marketplace/ShippingProfilesPanel', () => ({
  ShippingProfilesPanel: stub('ShippingProfilesPanel'),
}));
vi.mock('@/components/marketplace/CouponsPanel', () => ({ CouponsPanel: stub('CouponsPanel') }));
vi.mock('@/components/marketplace/InventoryAlertsPanel', () => ({
  InventoryAlertsPanel: stub('InventoryAlertsPanel'),
}));

import { EtsySection } from '@/components/marketplace/EtsySection';

describe('EtsySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('loads the shop on mount and renders home dashboard by default', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'shop-get') {
        return Promise.resolve({ data: { ok: true, result: { shop: { name: 'Aria Goods', currency: 'USD' } } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<EtsySection />);
    expect(await screen.findByTestId('ShopDashboard')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Aria Goods/)).toBeInTheDocument());
  });

  it('navigates between panels via the shell nav', async () => {
    render(<EtsySection />);
    await screen.findByTestId('ShopDashboard');
    fireEvent.click(screen.getByText('Orders'));
    expect(await screen.findByTestId('OrdersPanel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Storefront'));
    expect(await screen.findByTestId('StorefrontPanel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tools'));
    expect(await screen.findByText(/AI tools live inline/)).toBeInTheDocument();
  });

  it('dashboard onJumpTo switches the active panel', async () => {
    render(<EtsySection />);
    fireEvent.click(await screen.findByTestId('ShopDashboard'));
    expect(await screen.findByTestId('ListingsPanel')).toBeInTheDocument();
  });

  it('computes nav badges from summary / alerts / threads', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'shop-get') return Promise.resolve({ data: { ok: true, result: { shop: null } } });
      if (spec.action === 'dashboard-summary')
        return Promise.resolve({
          data: { ok: true, result: { draftCount: 4, pendingOrders: 2, activePromos: 1 } },
        });
      if (spec.action === 'inventory-alerts')
        return Promise.resolve({ data: { ok: true, result: { total: 7 } } });
      if (spec.action === 'messages-threads')
        return Promise.resolve({
          data: { ok: true, result: { threads: [{ unread: true }, { unread: false }] } },
        });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<EtsySection />);
    await screen.findByTestId('ShopDashboard');
    // listings draftCount badge 4, orders 2, inventory 7, messages 1 unread
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('tolerates a shop-get rejection without crashing', async () => {
    lensRun.mockRejectedValue(new Error('network'));
    render(<EtsySection />);
    expect(await screen.findByTestId('ShopDashboard')).toBeInTheDocument();
  });
});
