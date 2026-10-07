import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; action: () => void }>,
  setShowNewListing: vi.fn(),
}));

vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ id: string; action: () => void }>) => {
    mocks.commands = commands;
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ada' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], isLive: true, lastUpdated: new Date() }),
}));
vi.mock('@/components/marketplace/MarketplaceProvider', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    useMarketplace: () => {
      const [tab, setTab] = ReactModule.useState('browse');
      const [paletteOpen, setPaletteOpen] = ReactModule.useState(false);
      const [paletteQuery, setPaletteQuery] = ReactModule.useState('');
      const [paletteIdx, setPaletteIdx] = ReactModule.useState(0);
      return {
        tab,
        setTab,
        cart: [{ id: 'cart-1' }],
        watchlist: new Set(['listing-1']),
        setViewMode: vi.fn(),
        setShowNewListing: mocks.setShowNewListing,
        paletteOpen,
        setPaletteOpen,
        paletteQuery,
        setPaletteQuery,
        paletteIdx,
        setPaletteIdx,
        allItems: [{ id: 'listing-1', title: 'Signal Pack', creator: { name: 'Ada' }, tags: ['audio'], type: 'sample', prices: { standard: 12 } }],
        setSelectedArtifactId: vi.fn(),
        selectedArtifactId: null,
        previewItem: null,
        isPlaying: false,
        setIsPlaying: vi.fn(),
        closePreview: vi.fn(),
        royaltyVizDtuId: null,
        setRoyaltyVizDtuId: vi.fn(),
        deferredReady: false,
      };
    },
  };
});

vi.mock('@/components/marketplace/BrowsePanel', () => ({ BrowsePanel: () => <div>BrowsePanel</div> }));
vi.mock('@/components/marketplace/SellPanel', () => ({ SellPanel: () => <div>SellPanel</div> }));
vi.mock('@/components/marketplace/CartPanel', () => ({ CartPanel: () => <div>CartPanel</div> }));
vi.mock('@/components/marketplace/PurchasesPanel', () => ({ PurchasesPanel: () => <div>PurchasesPanel</div> }));
vi.mock('@/components/marketplace/WatchlistPanel', () => ({ WatchlistPanel: () => <div>WatchlistPanel</div> }));
vi.mock('@/components/marketplace/AnalyticsPanel', () => ({ AnalyticsPanel: () => <div>AnalyticsPanel</div> }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/platform/ActivityBadge', () => ({ ActivityBadge: () => null }));
vi.mock('@/components/market/ArtifactDetailModal', () => ({ ArtifactDetailModal: () => null }));
vi.mock('@/components/visualizations/RoyaltyCascadeViz', () => ({ default: () => null }));

import { MarketplaceApp } from '@/components/marketplace/MarketplaceApp';

describe('MarketplaceApp', () => {
  beforeEach(() => {
    mocks.commands = [];
    mocks.setShowNewListing.mockReset();
  });

  it('navigates every workspace, creates listings, and opens searchable palette', () => {
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open cart' }));
    for (const label of ['Browse', 'Sell', 'Cart', 'Purchases', 'Watchlist', 'Analytics']) {
      fireEvent.click(screen.getByTitle(new RegExp(`^${label}`)));
      expect(screen.getByText(`${label}Panel`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTitle('New listing (N)'));
    expect(mocks.setShowNewListing).toHaveBeenCalledWith(true);

    act(() => {
      for (const command of mocks.commands) command.action();
    });
    expect(screen.getByRole('dialog', { name: 'Quick search marketplace' })).toBeInTheDocument();
    const search = screen.getByPlaceholderText(/Search by title/);
    fireEvent.change(search, { target: { value: 'signal' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(screen.getByText('Signal Pack')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText('Signal Pack'));
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.keyDown(search, { key: 'Escape' });
  });
});
