/** Podcast full build (B3) — D1 ledger bridge, D5 edit, D6 delete
 * confirmation, D2 DTU panel scope, D3 count grammar, D4 iTunes
 * add-to-library settling. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

// ── Creator-desk hook (EpisodesPanel / AnalyticsPanel read it) ──
const removeEpisodeMock = vi.fn(async () => {});
const updateEpisodeMock = vi.fn(async () => ({}));
const EPISODE = {
  id: 'ep_1', showId: 'show_1', title: 'First Episode', description: 'Notes',
  episodeNumber: 1, seasonNumber: 1, coverArtUrl: null, mediaId: null,
  audioUrl: null, durationSec: 100, publishDate: '2026-05-10', status: 'draft',
  playCount: 0, tags: [] as string[],
};
vi.mock('@/components/podcast/useMyPodcastShow', () => ({
  useMyPodcastShow: () => ({
    myShowId: 'show_1', subscriberCount: 0, episodes: [EPISODE], isLoading: false,
    createEpisode: vi.fn(), updateEpisode: updateEpisodeMock,
    setEpisodeStatus: vi.fn(async () => {}), removeEpisode: removeEpisodeMock,
    refreshEpisodes: vi.fn(),
  }),
}));

// ── Analytics DTU source: domain DTUs are the account's; the context
// inventory (100 capped) must NOT be what the panel renders. ──
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    domainDTUs: [
      { id: 'd1', tier: 'regular' }, { id: 'd2', tier: 'regular' }, { id: 'd3', tier: 'mega' },
    ],
    contextDTUs: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, tier: 'regular' })),
    regularDTUs: [], hyperDTUs: [], megaDTUs: [],
    publishToMarketplace: vi.fn(), isLoading: false,
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ insights: [] }) }));

// ── Shared music player (EpisodesPanel bridge) ──
type Handler = (d?: Record<string, unknown>) => void;
const playerHandlers: Record<string, Handler> = {};
const playerStopMock = vi.fn();
vi.mock('@/lib/music/player', () => ({
  getPlayer: () => ({
    on: (ev: string, h: Handler) => { playerHandlers[ev] = h; return () => {}; },
    stop: playerStopMock,
    getCurrentTime: () => 42,
    getDuration: () => 100,
    pause: vi.fn(), play: vi.fn(async () => {}),
  }),
}));
const musicState = {
  nowPlaying: {
    track: null as null | { id: string; genre?: string },
    playbackState: 'stopped', currentTime: 0, duration: 0,
  },
};
vi.mock('@/lib/music/store', () => ({
  useMusicStore: Object.assign(
    () => ({ playTrack: vi.fn(), nowPlaying: musicState.nowPlaying }),
    { getState: () => musicState },
  ),
}));

import { EpisodesPanel } from '@/components/podcast/EpisodesPanel';
import { AnalyticsPanel } from '@/components/podcast/AnalyticsPanel';
import { PodcastBrowsePanel } from '@/components/podcast/PodcastBrowsePanel';
import { ItunesSearch } from '@/components/podcast/ItunesSearch';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({ data: { ok: true, result: {} } });
  runDomainMock.mockReset();
  removeEpisodeMock.mockClear();
  updateEpisodeMock.mockClear();
  playerStopMock.mockClear();
  musicState.nowPlaying.track = null;
  for (const k of Object.keys(playerHandlers)) delete playerHandlers[k];
});

describe('EpisodesPanel — D6 delete asks first', () => {
  it('one click arms the confirmation; only the confirm deletes', async () => {
    render(<EpisodesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this episode?')).toBeTruthy();
    expect(removeEpisodeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(removeEpisodeMock).toHaveBeenCalledWith('ep_1'));
  });

  it('deleting the loaded episode stops the shared player', async () => {
    musicState.nowPlaying.track = { id: 'ep_1', genre: 'podcast' };
    render(<EpisodesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(removeEpisodeMock).toHaveBeenCalled());
    expect(playerStopMock).toHaveBeenCalled();
  });
});

describe('EpisodesPanel — D5 edit surface', () => {
  it('saves corrected fields through episode-update', async () => {
    render(<EpisodesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit episode' }));
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'First Episode (fixed)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateEpisodeMock).toHaveBeenCalledWith(
      'ep_1', expect.objectContaining({ title: 'First Episode (fixed)' }),
    ));
  });
});

describe('EpisodesPanel — D1 playback ledger bridge', () => {
  it('reports real positions via sync-push only for podcast tracks, throttled, and flushes the full duration on end', async () => {
    musicState.nowPlaying.track = { id: 'ep_1', genre: 'music' };
    render(<EpisodesPanel />);
    await screen.findByText('First Episode');
    playerHandlers['timeupdate']({ currentTime: 25 });
    expect(lensRunMock).not.toHaveBeenCalledWith('podcast', 'sync-push', expect.anything());

    musicState.nowPlaying.track = { id: 'ep_1', genre: 'podcast' };
    playerHandlers['timeupdate']({ currentTime: 25 });
    expect(lensRunMock).toHaveBeenCalledWith('podcast', 'sync-push',
      expect.objectContaining({ episodeId: 'ep_1', positionSec: 25 }));
    lensRunMock.mockClear();
    playerHandlers['timeupdate']({ currentTime: 30 }); // +5s — under the 10s throttle
    expect(lensRunMock).not.toHaveBeenCalledWith('podcast', 'sync-push', expect.anything());
    playerHandlers['ended']();
    expect(lensRunMock).toHaveBeenCalledWith('podcast', 'sync-push',
      expect.objectContaining({ episodeId: 'ep_1', positionSec: 100 }));
  });
});

describe('AnalyticsPanel — D2 the DTU panel counts the account’s podcast DTUs, with its definition printed', () => {
  it('renders domain counts and the definition, never the capped context inventory', async () => {
    render(<AnalyticsPanel />);
    expect(await screen.findByText(/Your DTUs in the Podcast lens/)).toBeTruthy();
    expect(screen.getByText(/regular DTUs/i)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/mega DTUs/i)).toBeTruthy();
    expect(screen.queryByText('100')).toBeNull();
    expect(screen.queryByText(/context DTUs/i)).toBeNull();
  });
});

describe('PodcastBrowsePanel — D3 count grammar', () => {
  it('a one-episode show reads “1 episode”, not “1 episodes”', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      const show = {
        id: 's1', title: 'Solo Show', author: 'Ana', category: 'science', description: null,
        episodeCount: 1, subscribed: false, rating: 0, reviewCount: 0, addedBy: 'u2',
      };
      const r: Record<string, unknown> = {
        'show-list': { shows: [show] }, 'episode-list': { episodes: [] }, 'show-detail': { show, reviews: [] },
      };
      return Promise.resolve({ data: { ok: true, result: r[action] ?? {} } });
    });
    render(<PodcastBrowsePanel onChange={() => {}} />);
    await screen.findByText('Solo Show');
    expect(document.body.textContent).toContain('1 episode');
    expect(document.body.textContent).not.toContain('1 episodes');
  });
});

describe('ItunesSearch — D4 an add already in the library reads Added from the store', () => {
  it('derives Added from show-list, so it survives the round trip', async () => {
    runDomainMock.mockImplementation((_d: string, action: string) => {
      const r: Record<string, unknown> = {
        'show-list': { shows: [{ id: 's9', feedUrl: 'https://feeds.example.com/x.xml', subscribed: true }] },
        'itunes-search': {
          podcasts: [{
            collectionId: 42, title: 'Found Show', artist: 'Host', genre: 'Tech',
            feedUrl: 'https://feeds.example.com/x.xml', episodeCount: 12,
          }],
        },
      };
      return Promise.resolve({ data: { ok: true, result: r[action] ?? {} } });
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ItunesSearch />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Show name or topic/), { target: { value: 'Found' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    const btn = await screen.findByRole('button', { name: /Added/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
