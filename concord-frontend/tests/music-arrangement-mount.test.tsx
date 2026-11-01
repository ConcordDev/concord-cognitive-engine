import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// Music's own page is a large composition; stub its neighbours so the test proves one thing:
// the Arrangement Sketch (Section Marker, Audio Pin) is in the Music lens DOM on first load.
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
  useLensData: () => ({ items: [], isLoading: false, create: vi.fn(), remove: vi.fn(), update: vi.fn() }),
}));
vi.mock('@/lib/music/player', () => ({ getPlayer: () => ({ subscribe: () => () => {}, getState: () => ({}), setQueue: vi.fn() }) }));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(async (_d: string, action: string) => (
    action === 'project-list' ? { data: { ok: true, result: { projects: [{ id: 'p1', name: 'Demo' }] } } }
      : action === 'project-get' ? { data: { ok: true, result: { project: { id: 'p1', timeSignature: '4/4', bpm: 100, tracks: [{ id: 't1', name: 'Vox', kind: 'audio' }] } } } }
        : { data: { ok: true, result: { markers: [], clips: [] } } })),
}));
vi.mock('@/lib/daw/collab-log', () => ({ logStudioCollabEdit: vi.fn() }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('next/image', () => ({ default: nothing }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicWorkspace } from '@/components/music/MusicWorkspace';

afterEach(cleanup);

describe('Music lens mounts the Arrangement Sketch', () => {
  it('on first load (Home): Arrangement Sketch, Section Marker and Audio Pin are in the DOM, on a real studio project', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MusicWorkspace /></QueryClientProvider>);
    const sketch = await screen.findByTestId('arrangement-sketch');
    expect(sketch.getAttribute('data-lens-host')).toBe('music');
    expect(screen.getByText('Arrangement Sketch')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Section Marker')).toBeTruthy());
    expect(screen.getByText('Audio Pin')).toBeTruthy();
    expect(screen.getByTestId('arrangement-add-chorus')).toBeTruthy();
    expect(screen.getByTestId('arrangement-pin-audio')).toBeTruthy();
  });
});
