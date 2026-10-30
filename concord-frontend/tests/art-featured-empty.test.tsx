/**
 * ArtMarketDesk "Featured Artwork" honesty.
 *
 * The Featured grid renders the caller's real published artwork
 * (apiHelpers.artistry.assets.list). When that list is empty it must
 * say so — it previously rendered eight fabricated artworks with
 * invented titles ("Neon Dreams", "Digital Horizons", …) presented
 * as real featured pieces (REMAINING-WORK-AUDIT fake-content row).
 * Mock setup mirrors tests/art-lens-sweep.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { ok: false } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
  apiHelpers: {
    artistry: {
      assets: {
        list: () => Promise.resolve({ data: { assets: [] } }),
        create: vi.fn(),
      },
      marketplace: {
        art: { list: () => Promise.resolve({ data: { artworks: [] } }), create: vi.fn() },
        purchase: vi.fn(),
      },
    },
    lens: { runDomain: vi.fn() },
    durableArtifacts: { download: vi.fn() },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null, isConnected: false,
  }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u', username: 'ramaj', email: 'r@concord.test', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    contextDTUs: [],
    hyperDTUs: [],
    megaDTUs: [],
    regularDTUs: [],
    publishToMarketplace: vi.fn(),
    refetch: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/art/ArtGenerateFromText', () => ({
  ArtGenerateFromText: () => null,
  pickGeneratedArt: () => ({ url: null }),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode),
  }),
}));

import { ArtMarketDesk } from '@/components/art/ArtMarketDesk';

const FAKE_LISTINGS = ['Album Cover Pack', 'Neon Logo Kit', 'Abstract Backgrounds', 'Character Set', 'Social Media Kit', 'Poster Templates'];

function renderDesk(mode: 'gallery' | 'marketplace') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ArtMarketDesk mode={mode} />
    </QueryClientProvider>,
  );
}

describe('ArtMarketDesk with an empty catalogue', () => {
  it('gallery: Featured Artwork shows an honest empty state and no fabricated titles', async () => {
    const utils = renderDesk('gallery');
    await waitFor(() => expect(utils.getByText('No artwork featured yet.')).toBeInTheDocument());
    for (const fake of ['Neon Dreams', 'Digital Horizons', 'Abstract Flow', 'Cosmic Pulse', 'Neural Art', 'Pixel Paradise', 'Wave Form', 'Fractal Mind']) {
      expect(utils.queryByText(fake)).toBeNull();
    }
  });

  it('marketplace: shows an honest empty state, no fabricated priced listings, no dead View buttons', async () => {
    const utils = renderDesk('marketplace');
    await waitFor(() => expect(utils.getByText('No listings yet.')).toBeInTheDocument());
    for (const fake of FAKE_LISTINGS) expect(utils.queryByText(fake)).toBeNull();
    expect(utils.queryByText('$25')).toBeNull();
    expect(utils.queryByRole('button', { name: 'View' })).toBeNull();
  });
});
