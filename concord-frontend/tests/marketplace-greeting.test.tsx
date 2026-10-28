/**
 * Marketplace app northstar greeting.
 *
 * The Marketplace concept (docs/lens-northstar/66) opens on the
 * serif headline "What's for sale, Ramaj". This pins the app header
 * carrying it with the signed-in username. The workspace panels are
 * mocked away (same harness shape as marketplace-app.test.tsx) —
 * the greeting lives in MarketplaceApp's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
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
        tab, setTab,
        cart: [], watchlist: new Set(),
        setViewMode: vi.fn(), setShowNewListing: vi.fn(),
        paletteOpen, setPaletteOpen, paletteQuery, setPaletteQuery, paletteIdx, setPaletteIdx,
        allItems: [], setSelectedArtifactId: vi.fn(), selectedArtifactId: null,
        previewItem: null, isPlaying: false, setIsPlaying: vi.fn(), closePreview: vi.fn(),
        royaltyVizDtuId: null, setRoyaltyVizDtuId: vi.fn(), deferredReady: false,
      };
    },
  };
});
vi.mock('@/components/marketplace/BrowsePanel', () => ({ BrowsePanel: () => null }));
vi.mock('@/components/marketplace/SellPanel', () => ({ SellPanel: () => null }));
vi.mock('@/components/marketplace/CartPanel', () => ({ CartPanel: () => null }));
vi.mock('@/components/marketplace/PurchasesPanel', () => ({ PurchasesPanel: () => null }));
vi.mock('@/components/marketplace/WatchlistPanel', () => ({ WatchlistPanel: () => null }));
vi.mock('@/components/marketplace/AnalyticsPanel', () => ({ AnalyticsPanel: () => null }));
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

describe('Marketplace app greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<MarketplaceApp />);
    const greeting = screen.getByTestId('marketplace-greeting');
    expect(greeting.textContent).toBe("What's for sale, ramaj");
    expect(greeting.className).toContain('font-vault');
  });
});
