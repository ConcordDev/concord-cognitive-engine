// Render + behaviour coverage for the podcast lens panels (browse/subscribe, listen queue,
// listening hub, create episode, iTunes search, player section) and the change-event bus.
// Panels mount against stubbed show/episode records, must render real content, survive a full
// exercise pass, send the right macro for the primary actions, and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise, fakeEntity } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const EP = { id: 'ep1', showId: 'sh1', title: 'Pilot', durationSec: 1800, positionSec: 600, played: false, downloaded: false, publishedAt: '2026-03-01', description: 'First episode', audioUrl: 'https://example.org/a.mp3', showTitle: 'The Show' };
const SHOW = { id: 'sh1', title: 'The Show', author: 'Ann', feedUrl: 'https://example.org/feed.xml', artwork: '', subscribed: true, episodes: [EP], autoDownload: false, keepRecent: 5, description: 'A show' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'podcast-dashboard': return { subscriptions: 4, inProgress: 2, queueLength: 3, downloads: 1, playlists: 2, listenedHours: 12.5 };
    case 'show-list': case 'shows': return { shows: [SHOW] };
    case 'episode-list': return { episodes: [EP] };
    case 'continue-listening': return { episodes: [EP] };
    case 'new-episodes': return { episodes: [EP] };
    case 'queue-list': return { queue: [EP] };
    default: return { ok: true, show: SHOW, episode: EP, shows: [SHOW], episodes: [EP], queue: [EP], items: [fakeEntity('p1')] };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CreateEpisodePanel } from '../CreateEpisodePanel';
import { ItunesSearch } from '../ItunesSearch';
import { PodcastBrowsePanel } from '../PodcastBrowsePanel';
import { PodcastListenPanel } from '../PodcastListenPanel';
import { PodcastListeningHub } from '../PodcastListeningHub';
import { PodcastPlayerSection } from '../PodcastPlayerSection';
import { PODCAST_CHANGED_EVENT, notifyPodcastChanged, onPodcastChanged } from '../podcast-events';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({
    data: { ok: true, result: action === 'itunes-search'
      ? { podcasts: [{ collectionId: 11, trackId: 11, title: 'The Show', artist: 'Ann', genre: 'History', artwork: '', feedUrl: 'https://example.org/feed.xml', episodeCount: 12 }] }
      : resultFor(action) },
  }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['CreateEpisodePanel', () => <CreateEpisodePanel onCreated={vi.fn()} />],
  ['ItunesSearch', () => <ItunesSearch />],
  ['PodcastBrowsePanel', () => <PodcastBrowsePanel onChange={vi.fn()} />],
  ['PodcastListenPanel', () => <PodcastListenPanel onChange={vi.fn()} />],
  ['PodcastListeningHub', () => <PodcastListeningHub />],
  ['PodcastPlayerSection', () => <PodcastPlayerSection />],
];

describe('podcast panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(5);
    expect(screen.getAllByRole('button').length + view.container.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0);
    await exercise({ passes: 3 });
    await settle();
    await exercise({ passes: 1, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('podcast flows', () => {
  it('the browse panel loads shows and episodes through the podcast macros', async () => {
    render(<PodcastBrowsePanel onChange={vi.fn()} />);
    await settle();
    await exercise({ passes: 3 });
    await settle();
    const a = sent();
    expect(a.some((x) => /show|episode/.test(x))).toBe(true);
  });

  it('the listen panel asks for continue-listening and new episodes', async () => {
    render(<PodcastListenPanel onChange={vi.fn()} />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['continue-listening', 'new-episodes']));
  });

  it('the player section loads its dashboard', async () => {
    render(<PodcastPlayerSection />);
    await settle();
    expect(sent()).toContain('podcast-dashboard');
  });

  it('the change-event bus notifies and unsubscribes', () => {
    const handler = vi.fn();
    const off = onPodcastChanged(handler);
    notifyPodcastChanged();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    notifyPodcastChanged();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(PODCAST_CHANGED_EVENT).toBe('podcast:changed');
    const viaWindow = vi.fn();
    window.addEventListener(PODCAST_CHANGED_EVENT, viaWindow);
    notifyPodcastChanged();
    expect(viaWindow).toHaveBeenCalled();
    window.removeEventListener(PODCAST_CHANGED_EVENT, viaWindow);
  });

  it('typing in iTunes search sends a podcast search request', async () => {
    render(<ItunesSearch />);
    await settle();
    const box = screen.getAllByRole('textbox')[0] ?? document.querySelector('input');
    fireEvent.change(box as HTMLInputElement, { target: { value: 'history' } });
    fireEvent.keyDown(box as HTMLInputElement, { key: 'Enter' });
    const btn = screen.queryAllByRole('button').find((b) => /search/i.test(b.textContent || b.getAttribute('aria-label') || ''));
    if (btn) await act(async () => { fireEvent.click(btn); });
    await settle();
    expect(runDomain.mock.calls.length).toBeGreaterThan(0);
  });
});
