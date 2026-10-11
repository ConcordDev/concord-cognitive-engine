/**
 * Art lens sweep: Studio stays under a button budget (no macro dump),
 * Create asks for a canvas name, Art DTUs and My art drop non-art rows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { apiGet, lensRun, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  lensRun: vi.fn(),
  apiDelete: vi.fn(),
}));

const COMPUTE_ACTIONS = Array.from({ length: 40 }, (_, i) => ({
  action: `computeMacro${i}`,
  desc: 'compute',
  brain: null,
  isAi: false,
  isGenerative: false,
  isAnalysis: false,
  isLive: false,
  isCompute: true,
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: (...args: unknown[]) => apiDelete(...args),
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
  lensRun: (...args: unknown[]) => lensRun(...args),
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
    contextDTUs: [
      { id: 'art-1', title: 'Oil Study', domain: 'art', tier: 'regular', machine: { kind: 'artwork' } },
      { id: 'music-1', title: 'Bass Loop', domain: 'music', tier: 'regular', machine: { kind: 'track' } },
    ],
    hyperDTUs: [],
    megaDTUs: [],
    regularDTUs: [
      { id: 'art-1', title: 'Oil Study', domain: 'art', tier: 'regular', machine: { kind: 'artwork' } },
      { id: 'music-1', title: 'Bass Loop', domain: 'music', tier: 'regular', machine: { kind: 'track' } },
    ],
    publishToMarketplace: vi.fn(),
    refetch: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
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

import ArtLensPage from '@/app/lenses/art/page';
import { ArtMarketDesk } from '@/components/art/ArtMarketDesk';
import { filterArtDtus } from '@/lib/art/art-dtus';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  apiGet.mockReset();
  apiDelete.mockReset();
  lensRun.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (String(url).includes('/api/lens-actions/art')) {
      return Promise.resolve({ data: { ok: true, actions: COMPUTE_ACTIONS } });
    }
    if (String(url).includes('/api/dtus')) {
      return Promise.resolve({
        data: {
          ok: true,
          dtus: [
            { id: 'mine-art', title: 'Uploaded Harbor', domain: 'art', machine: { kind: 'artwork' } },
            { id: 'mine-music', title: 'Session Take', domain: 'music', machine: { kind: 'track' } },
          ],
        },
      });
    }
    return Promise.resolve({ data: { ok: false } });
  });
  lensRun.mockImplementation(async (_domain: string, name: string) => {
    if (name === 'artwork-list') return { data: { ok: true, result: { artworks: [] } } };
    if (name === 'artwork-create') return { data: { ok: true, result: { artwork: { id: 'canvas-1', title: 'Harbor Study' } } } };
    return { data: { ok: true, result: {} } };
  });
  apiDelete.mockResolvedValue({ data: { ok: true } });
});

describe('art studio sweep', () => {
  it('renders the studio under 30 buttons and hides the macro dump', async () => {
    const utils = wrap(<ArtLensPage />);
    await waitFor(() => expect(utils.getByText(/No artworks yet/i)).toBeInTheDocument());
    const buttons = utils.container.querySelectorAll('button');
    expect(buttons.length).toBeLessThan(30);
    expect(utils.container.textContent).not.toMatch(/More actions/);
    expect(utils.container.textContent).not.toMatch(/\bCOMPUTE\b/);
    expect(utils.container.textContent).not.toMatch(/Compute Macro0/);
    expect(utils.queryByText('{}')).toBeNull();
  });

  it('keeps Create disabled until a canvas has a name', async () => {
    const utils = wrap(<ArtLensPage />);
    await waitFor(() => expect(utils.getByRole('button', { name: /Create/i })).toBeDisabled());
    fireEvent.change(utils.getByLabelText('Canvas name'), { target: { value: 'Harbor Study' } });
    const create = utils.getByRole('button', { name: /Create/i });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'art',
      'artwork-create',
      expect.objectContaining({ title: 'Harbor Study' }),
    ));
  });
});

describe('Art DTUs', () => {
  it('drops non-art rows in the predicate', () => {
    const kept = filterArtDtus([
      { id: 'a', title: 'Oil Study', domain: 'art' },
      { id: 'm', title: 'Bass Loop', domain: 'music', machine: { kind: 'track' } },
      { id: 'k', title: 'Kind Only', machine: { kind: 'artwork' } },
    ]);
    expect(kept.map((d) => d.title)).toEqual(['Oil Study', 'Kind Only']);
  });

  it('shows art titles and hides music in the Art DTUs rail and My art', async () => {
    const utils = wrap(<ArtMarketDesk mode="my-art" />);
    await waitFor(() => expect(utils.getByText('Uploaded Harbor')).toBeInTheDocument());
    expect(utils.getByText('Oil Study')).toBeInTheDocument();
    expect(utils.queryByText('Bass Loop')).toBeNull();
    expect(utils.queryByText('Session Take')).toBeNull();
    expect(utils.getByTestId('my-art-piece').textContent).toMatch(/Uploaded Harbor/);
  });
});
