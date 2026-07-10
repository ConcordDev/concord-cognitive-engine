/**
 * /lenses/artistry — UX-state + tab-wiring contract for the rebuilt
 * Artistry lens (Frontend Rebuild Program, Wave 2).
 *
 * Rewritten alongside the Wave-2 rebuild: the page no longer drives its
 * primary surface off `apiHelpers.artistry.assets/marketplace/studio` (a
 * real backend, but a misfiled DAW/music-distribution/marketplace system
 * shared with the `art`/`marketplace`/`collab`/`feed` lenses — presenting
 * it a second time under `artistry` mislabeled a cross-lens system as this
 * lens's own visual-art asset system; see the capability map). The real
 * page now (a) drives its header KPI strip off the real `artistry.profileGet`
 * macro via `useMacroDispatchFeedback`, honestly showing loading/error/
 * populated for THAT channel, and (b) mounts one real macro-backed panel
 * per tab (CommunityNetwork / ProjectStudio / PortfolioProfile / ... /
 * CreativeTools).
 *
 * Load-bearing wiring assertion: tab selection must mount the matching real
 * panel component — a regression that always rendered CommunityNetwork
 * regardless of the selected tab would silently strand the other real
 * backend surfaces behind dead navigation.
 *
 * No fabricated data — every state is driven by a mocked
 * `useMacroDispatchFeedback` standing in for the real backend in the exact
 * shape the hook returns. The error path's Retry is asserted to re-dispatch
 * (the mocked `dispatch` fires again), so a swallowed-fetch → silent-empty
 * regression cannot pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── header KPI channel: useMacroDispatchFeedback (artistry.profileGet) ─────
type Status = 'idle' | 'dispatched' | 'running' | 'done' | 'error';
const statsState: { status: Status; result: Record<string, unknown> | null; error: string | null } = {
  status: 'idle', result: null, error: null,
};
const dispatchSpy = vi.fn(() => Promise.resolve(null));

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => ({
    status: statsState.status,
    runId: null,
    domain: 'artistry',
    action: 'profileGet',
    result: statsState.result,
    error: statsState.error,
    ms: null,
    stage: null,
    dispatch: dispatchSpy,
    reset: vi.fn(),
  }),
}));

// ── headless chrome + real macro-backed panels: render-only / inert stubs ──
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/artistry/WikimediaArt', () => ({ WikimediaArt: () => null }));
vi.mock('@/components/artistry/ProjectStudio', () => ({ ProjectStudio: () => React.createElement('div', { 'data-testid': 'panel-projects' }) }));
vi.mock('@/components/artistry/PortfolioProfile', () => ({ PortfolioProfile: () => React.createElement('div', { 'data-testid': 'panel-profile' }) }));
vi.mock('@/components/artistry/CommunityNetwork', () => ({ CommunityNetwork: () => React.createElement('div', { 'data-testid': 'panel-feed' }) }));
vi.mock('@/components/artistry/Collections', () => ({ Collections: () => React.createElement('div', { 'data-testid': 'panel-collections' }) }));
vi.mock('@/components/artistry/DisciplineSearch', () => ({ DisciplineSearch: () => React.createElement('div', { 'data-testid': 'panel-discover' }) }));
vi.mock('@/components/artistry/JobBoard', () => ({ JobBoard: () => React.createElement('div', { 'data-testid': 'panel-jobs' }) }));
vi.mock('@/components/artistry/CuratedGalleries', () => ({ CuratedGalleries: () => React.createElement('div', { 'data-testid': 'panel-galleries' }) }));
vi.mock('@/components/artistry/CreativeTools', () => ({ CreativeTools: () => React.createElement('div', { 'data-testid': 'panel-tools' }) }));

import ArtistryLens from '@/app/lenses/artistry/page';

beforeEach(() => {
  statsState.status = 'idle';
  statsState.result = null;
  statsState.error = null;
  dispatchSpy.mockClear();
});

describe('artistry lens — tab wiring', () => {
  it('mounts the real Feed (CommunityNetwork) panel by default', () => {
    render(<ArtistryLens />);
    expect(screen.getByTestId('panel-feed')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-projects')).not.toBeInTheDocument();
  });

  it('switching to each tab mounts its own real macro-backed panel', () => {
    render(<ArtistryLens />);
    const cases: Array<[RegExp, string]> = [
      [/Projects/, 'panel-projects'],
      [/Profile/, 'panel-profile'],
      [/Collections/, 'panel-collections'],
      [/Discover/, 'panel-discover'],
      [/Jobs/, 'panel-jobs'],
      [/Galleries/, 'panel-galleries'],
      [/Creative Tools/, 'panel-tools'],
    ];
    for (const [label, testId] of cases) {
      fireEvent.click(screen.getByText(label));
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('renders the honest Sketchpad disclosure — no fabricated "saved" claim', () => {
    render(<ArtistryLens />);
    fireEvent.click(screen.getByText(/Sketchpad/));
    expect(screen.getByText(/nothing here is saved automatically/i)).toBeInTheDocument();
  });

  it('dispatches the real profileGet macro on mount (not a fabricated stat)', () => {
    render(<ArtistryLens />);
    expect(dispatchSpy).toHaveBeenCalledWith('artistry', 'profileGet', {});
  });
});

describe('artistry lens — header KPI states', () => {
  it('LOADING: shows skeleton placeholders while profileGet is in flight', () => {
    statsState.status = 'dispatched';
    const { container } = render(<ArtistryLens />);
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
  });

  it('ERROR: shows the real error message + a working Retry that re-dispatches', async () => {
    statsState.status = 'error';
    statsState.error = 'artistry backend offline';
    render(<ArtistryLens />);
    expect(screen.getByText(/artistry backend offline/i)).toBeInTheDocument();

    dispatchSpy.mockClear();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('artistry', 'profileGet', {}));
  });

  it('POPULATED: renders real profileGet stats, scoped to the KPI list', () => {
    statsState.status = 'done';
    statsState.result = {
      profile: { displayName: 'nova_paints' },
      stats: { projectCount: 6, totalViews: 340, totalAppreciations: 52, followerCount: 12, followingCount: 4 },
    };
    render(<ArtistryLens />);
    expect(screen.getByText(/nova_paints/)).toBeInTheDocument();
    const kpis = within(screen.getByRole('list'));
    expect(kpis.getByText('6')).toBeInTheDocument(); // Projects
    expect(kpis.getByText('12')).toBeInTheDocument(); // Followers
  });
});
