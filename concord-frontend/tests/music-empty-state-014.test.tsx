// FIX-014 — the Music lens graded "zero content entries (empty beyond
// reachability)": for a member with an empty library and an empty
// global-realm catalog, the Home view's New Releases / Most Played
// sections rendered as bare headings over void, with no empty state
// and no way forward. The ticket's expected names the cure: an empty
// state with a clear CTA. This pin mounts the real workspace with all
// data sources empty (the arrangement-mount test's scaffold) and
// asserts the empty state renders and its CTA reaches the upload flow.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { passthrough, nothing } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: React.ReactNode }) => children ?? null,
  nothing: () => null,
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: passthrough }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: nothing }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: nothing }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: nothing }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: nothing }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: nothing }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: nothing }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: nothing }));
vi.mock('@/components/lens/FeedBanner', () => ({ FeedBanner: nothing }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: nothing }));
vi.mock('@/components/music/MusicStreamingSection', () => ({ MusicStreamingSection: nothing }));
vi.mock('@/components/music/SessionClipPicker', () => ({ SessionClipPicker: nothing }));
vi.mock('@/components/music/SessionView', () => ({ SessionView: nothing }));
vi.mock('@/components/music/MusicArtistExplorer', () => ({ MusicArtistExplorer: nothing }));
vi.mock('@/components/music/MusicActionPanel', () => ({ MusicActionPanel: nothing }));
vi.mock('@/components/music/PlaylistView', () => ({ PlaylistView: nothing }));
vi.mock('@/components/music/ArtistProfile', () => ({ ArtistProfile: nothing }));
vi.mock('@/components/music/UploadFlow', () => ({ UploadFlow: () => <div>upload-flow-marker</div> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/hooks/useLensDTUs', () => ({ useLensDTUs: () => ({ dtus: [], megaDTUs: [], isLoading: false }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], isLoading: false, create: vi.fn(), remove: vi.fn(), update: vi.fn() }),
}));
vi.mock('@/lib/music/player', () => ({ getPlayer: () => ({ subscribe: () => () => {}, getState: () => ({}), setQueue: vi.fn() }) }));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: { dtus: [] } })), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { markers: [], clips: [] } } })),
}));
vi.mock('@/lib/daw/collab-log', () => ({ logStudioCollabEdit: vi.fn() }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('next/image', () => ({ default: nothing }));
// framer-motion's AnimatePresence never mounts its child subtree under
// jsdom in this harness; render motion primitives as plain elements so
// the view content under test actually mounts.
vi.mock('framer-motion', () => ({
  AnimatePresence: passthrough,
  motion: new Proxy({}, {
    get: () => ({ children, ...rest }: { children?: React.ReactNode }) => <div {...rest}>{children}</div>,
  }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicWorkspace } from '@/components/music/MusicWorkspace';

afterEach(cleanup);

describe('Music lens empty state (FIX-014)', () => {
  it('an empty library + empty catalog shows the empty state, and its CTA opens the upload flow', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MusicWorkspace /></QueryClientProvider>);
    expect(await screen.findByText('No music here yet')).toBeTruthy();
    const cta = screen.getByRole('button', { name: 'Upload a track' });
    fireEvent.click(cta);
    expect(await screen.findByText('upload-flow-marker')).toBeTruthy();
  });
});
