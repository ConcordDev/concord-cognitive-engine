// CB-0500 — counts that lie, cluster D pin (FIX-music-008).
//
// Music Home's stat cards counted the generic per-lens artifact store
// (useLensData 'track'/'playlist' rows) while the Listen view renders
// the music domain's track-list / playlist-list payloads — two
// different stores, so Home read 0 tracks / 0 playlists for a user
// whose library lives in the domain store. Pin: with the artifact
// store EMPTY and the domain library holding 4 tracks / 37 playlists,
// the Home cards show the library's numbers (and Total Plays sums the
// library tracks' play counts). Mock scaffolding follows the shipped
// music-arrangement-mount suite.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
vi.mock('@/components/music/UploadFlow', () => ({ UploadFlow: nothing }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/hooks/useLensDTUs', () => ({ useLensDTUs: () => ({ dtus: [], megaDTUs: [], isLoading: false }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  // The artifact store is EMPTY — the audit's state.
  useLensData: () => ({ items: [], isLoading: false, create: vi.fn(), remove: vi.fn(), update: vi.fn() }),
}));
vi.mock('@/lib/music/player', () => ({ getPlayer: () => ({ subscribe: () => () => {}, getState: () => ({}), setQueue: vi.fn() }) }));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(async (_d: string, action: string) => {
    if (action === 'track-list') {
      return { data: { ok: true, result: { tracks: [1, 2, 3, 4].map((i) => ({ id: `t-${i}`, playCount: i })), count: 4 } } };
    }
    if (action === 'playlist-list') {
      return { data: { ok: true, result: { playlists: Array.from({ length: 37 }, (_, i) => ({ id: `pl-${i}` })), count: 37 } } };
    }
    if (action === 'project-list') return { data: { ok: true, result: { projects: [{ id: 'p1', name: 'Demo' }] } } };
    if (action === 'project-get') return { data: { ok: true, result: { project: { id: 'p1', timeSignature: '4/4', bpm: 100, tracks: [{ id: 't1', name: 'Vox', kind: 'audio' }] } } } };
    return { data: { ok: true, result: { markers: [], clips: [] } } };
  }),
}));
vi.mock('@/lib/daw/collab-log', () => ({ logStudioCollabEdit: vi.fn() }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('next/image', () => ({ default: nothing }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicWorkspace } from '@/components/music/MusicWorkspace';

afterEach(cleanup);

describe('music-008 — Home cards count the Listen library', () => {
  // Card root and its inner wrapper share the same textContent
  // (value+label), so match on "at least one element carries it".
  const card = async (text: string) =>
    (await screen.findAllByText((_, el) => el?.textContent === text)).length > 0;

  it('shows 4 tracks / 37 playlists / summed plays from track-list + playlist-list, not the empty artifact store', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MusicWorkspace /></QueryClientProvider>);
    expect(await card('4Tracks')).toBe(true);
    expect(await card('37Playlists')).toBe(true);
    // playCounts 1+2+3+4 = 10 across the library tracks.
    expect(await card('10Total Plays')).toBe(true);
  });
});
