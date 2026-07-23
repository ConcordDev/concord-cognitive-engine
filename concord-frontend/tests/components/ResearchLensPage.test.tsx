/**
 * Research lens page — ManifestActionBar removal + Workbench keyboard
 * shortcut.
 *
 * Real defect fixed this pass: the page rendered <ManifestActionBar/> with
 * manifest.actions ['analyze','generate','validate','export','summarize'].
 * Four of those five matched no registered "research" macro at all; the
 * fifth ('generate') IS real but requires a `hypothesis` param the bar can
 * only ever call with `{}`, so it always failed too — 0 of 5 buttons were
 * ever usable (see lib/lenses/manifest.ts for the full audit). It's been
 * removed. Separately, opening the Research Workbench (Obsidian-shape
 * notes) was mouse-only (a floating action button); this test proves the
 * new 'n' keyboard shortcut registered via useLensCommand really opens it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/research/ResearchLibrarySection', () => ({ ResearchLibrarySection: () => null }));
vi.mock('@/components/research/ResearchArxiv', () => ({ ResearchArxiv: () => null }));
vi.mock('@/components/research/CrossRefPanel', () => ({ CrossRefPanel: () => null }));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => React.createElement('div', { 'data-testid': 'lens-feature-panel' }, 'features') }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null, adaptToLiveFeedArticles: () => [] }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
vi.mock('@/components/research/ResearchWorkbench', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? React.createElement('div', { 'data-testid': 'research-workbench' }, 'Workbench open') : null,
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    hyperDTUs: [], megaDTUs: [], regularDTUs: [], tierDistribution: {},
    publishToMarketplace: vi.fn(), isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })), isPending: false }),
}));

import ResearchLensPage from '@/app/lenses/research/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <ResearchLensPage />
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

describe('research lens page — ManifestActionBar removed + Workbench shortcut', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/dtus')) return { data: { dtus: [] } };
      return { data: {} };
    });
  });

  it('renders no dead ManifestActionBar quick-trigger row', async () => {
    renderPage();
    await screen.findByText('Research');
    expect(screen.queryByTitle(/quick trigger, runs with no parameters/i)).not.toBeInTheDocument();
  });

  it('the Lens Features panel is collapsed by default (removed generic noise ahead of the real workbench)', async () => {
    renderPage();
    await screen.findByText('Research');
    expect(screen.queryByTestId('lens-feature-panel')).not.toBeInTheDocument();
  });

  it('pressing "n" opens the real Research Workbench (a genuine keyboard-driven state change)', async () => {
    renderPage();
    await screen.findByText('Research');
    expect(screen.queryByTestId('research-workbench')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN' });
    expect(await screen.findByTestId('research-workbench')).toBeInTheDocument();
  });
});
