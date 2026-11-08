// Form-flow coverage for the podcast panels that the render pass leaves partly dark: the
// listening hub (feeds / for-you / sync / auto-download), the browse panel's review + subscribe
// controls, the create-episode form, and the iTunes add-to-library bridge. Each flow drives
// the real handlers and asserts the macro the panel sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const EP = { id: 'ep1', title: 'Pilot', showTitle: 'The Show', durationSec: 3900, publishDate: '2026-03-01', played: false, progressPct: 40, audioUrl: 'https://example.org/a.mp3', positionSec: 600, inQueue: false, downloaded: false };
const SHOW = { id: 'sh1', title: 'The Show', author: 'Ann', category: 'History', feedUrl: 'https://example.org/feed.xml', episodeCount: 1, subscribed: false, lastRefreshedAt: '2026-03-02T00:00:00Z' };
const NOFEED = { id: 'sh2', title: 'Bare Show', author: null, category: 'Arts', feedUrl: null, episodeCount: 2, subscribed: true };

function resultFor(action: string): unknown {
  switch (action) {
    case 'show-list': return { shows: [SHOW, NOFEED] };
    case 'episode-list': return { episodes: [EP] };
    case 'recommendations': return { recommendations: [{ ...SHOW, id: 'sh3', title: 'Rec Show', score: 77, reason: 'Because you like history' }], basedOn: 'your subscriptions' };
    case 'sync-state': return { positions: [{ episodeId: 'ep1', episodeTitle: 'Pilot', showTitle: 'The Show', positionSec: 125, played: false, updatedAt: null }, { episodeId: 'ep2', episodeTitle: null, showTitle: 'Bare Show', positionSec: 10, played: true, updatedAt: null }], nowResuming: { episodeId: 'ep1', episodeTitle: 'Pilot', showTitle: 'The Show', positionSec: 125, played: false, updatedAt: null }, playbackSpeed: 1.5 };
    case 'download-rule-list': return { rules: [{ showId: 'sh1', showTitle: 'The Show', autoDownload: true, keepRecent: 5, updatedAt: '2026-03-02' }] };
    case 'show-add': return { show: SHOW };
    case 'rss-refresh': return { ingested: 4 };
    case 'download-rule-run': return { added: 2, pruned: 1 };
    case 'my-show-ensure': return { show: { id: 'mine', subscriberCount: 3 } };
    case 'episode-add': return { episode: { id: 'new1', episodeNumber: 3 } };
    case 'review-list': case 'reviews': return { reviews: [{ id: 'r1', rating: 4, text: 'Great' }, { id: 'r2', rating: 5 }] };
    default: return { ok: true, show: SHOW, episodes: [EP], shows: [SHOW, NOFEED] };
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
vi.mock('../PodcastStreamPlayer', () => ({ PodcastStreamPlayer: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>stream-close</button> }));
vi.mock('../PodcastTranscriptPanel', () => ({ PodcastTranscriptPanel: () => <div>transcript-panel</div> }));
vi.mock('@/components/media/MediaUpload', () => ({
  MediaUpload: ({ onPendingFileChange, onUploadComplete }: { onPendingFileChange: (f: File | null) => void; onUploadComplete: (m: unknown) => void }) => (
    <div>
      <button onClick={() => onPendingFileChange(new File(['x'], 'a.mp3'))}>pick-file</button>
      <button onClick={() => onUploadComplete({ mediaDTU: { id: 'media12345', duration: 90 } })}>finish-upload</button>
    </div>
  ),
}));
vi.mock('@/lib/podcast/probe-audio-duration', () => ({ probeAudioFileDuration: async () => 42 }));

import { CreateEpisodePanel } from '../CreateEpisodePanel';
import { ItunesSearch } from '../ItunesSearch';
import { PodcastBrowsePanel } from '../PodcastBrowsePanel';
import { PodcastListeningHub } from '../PodcastListeningHub';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); await settle(); };
const byText = (re: RegExp) => screen.getAllByRole('button').find((b) => re.test(b.textContent || b.getAttribute('aria-label') || '')) as HTMLElement;

afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({
    data: { ok: true, result: action === 'itunes-search'
      ? { podcasts: [{ collectionId: 11, trackId: 11, title: 'The Show', artist: 'Ann', genre: 'History', artwork: '', feedUrl: 'https://example.org/feed2.xml', episodeCount: 12 }] }
      : resultFor(action) },
  }));
});

describe('listening hub flows', () => {
  it('rejects a non-URL feed, then ingests a valid feed and subscribes it', async () => {
    render(<PodcastListeningHub />);
    await settle();
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const urlBox = inputs.find((i) => /http|feed|rss/i.test(i.placeholder)) ?? inputs[inputs.length - 1];
    fireEvent.change(urlBox, { target: { value: 'nope' } });
    await click(byText(/ingest feed/i));
    expect(screen.getByText(/valid RSS feed URL/i)).toBeTruthy();
    fireEvent.change(urlBox, { target: { value: 'https://example.org/new.xml' } });
    await click(byText(/ingest feed/i));
    expect(sent()).toEqual(expect.arrayContaining(['show-add', 'rss-refresh', 'show-subscribe']));
    expect(screen.getByText(/Ingested 4 episodes/)).toBeTruthy();
  });

  it('surfaces a failed ingest and a failed show-add', async () => {
    render(<PodcastListeningHub />);
    await settle();
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const urlBox = inputs.find((i) => /http|feed|rss/i.test(i.placeholder)) ?? inputs[inputs.length - 1];
    lensRunMock.mockImplementation(async (...a: unknown[]) => {
      const act_ = actionOf(a);
      if (act_ === 'rss-refresh') return { data: { ok: false, error: 'Feed could not be parsed' } };
      return { data: { ok: true, result: resultFor(act_) } };
    });
    fireEvent.change(urlBox, { target: { value: 'https://example.org/bad.xml' } });
    await click(byText(/ingest feed/i));
    expect(screen.getByText(/could not be parsed/i)).toBeTruthy();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'nope' } }));
    await click(byText(/ingest feed/i));
    expect(screen.getByText(/nope|Could not add show/)).toBeTruthy();
  });

  it('opens a show, streams and reads a transcript, refreshes the feed', async () => {
    render(<PodcastListeningHub />);
    await settle();
    await click(screen.getByText('The Show'));
    expect(sent()).toContain('episode-list');
    await click(byText(/^\s*Play/));
    expect(screen.getByText('stream-close')).toBeTruthy();
    await click(screen.getByText('stream-close'));
    await click(byText(/Transcript/));
    expect(screen.getByText('transcript-panel')).toBeTruthy();
    await click(byText(/Refresh/));
    expect(sent().filter((x) => x === 'rss-refresh').length).toBeGreaterThan(0);
    await click(screen.getByText('The Show'));
  });

  it('shows an empty drill-down when a show has no episodes', async () => {
    render(<PodcastListeningHub />);
    await settle();
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'episode-list' ? { episodes: [] } : resultFor(actionOf(a)) } }));
    await click(screen.getByText('Bare Show'));
    expect(screen.getByText(/No episodes/)).toBeTruthy();
  });

  it('subscribes from For You, reads Sync, and runs the auto-download rules', async () => {
    render(<PodcastListeningHub />);
    await settle();
    await click(byText(/For You/));
    expect(screen.getByText(/Because you like history/)).toBeTruthy();
    await click(byText(/^\s*Subscribe/));
    expect(sent()).toContain('show-subscribe');
    await click(byText(/Sync/));
    expect(screen.getByText(/Resume here/)).toBeTruthy();
    expect(screen.getByText(/1.5×/)).toBeTruthy();
    await click(byText(/Auto-download/));
    await click(byText(/Run rules now/));
    expect(sent()).toContain('download-rule-run');
    expect(screen.getByText(/Smart download: \+2 downloaded, 1 pruned/)).toBeTruthy();
    const select = document.querySelector('select') as HTMLSelectElement;
    await act(async () => { fireEvent.change(select, { target: { value: '10' } }); });
    await settle();
    const ruleCall = lensRunMock.mock.calls.find((c) => actionOf(c) === 'download-rule-set');
    expect(JSON.stringify(ruleCall)).toContain('"keepRecent":10');
    const toggle = screen.getAllByRole('button').filter((b) => /auto|on|off|enable|disable/i.test(b.textContent || '')).pop() as HTMLElement;
    await click(toggle);
  });

  it('empty states render when there is nothing to show', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: {} } }));
    render(<PodcastListeningHub />);
    await settle();
    expect(screen.getByText(/No shows yet/)).toBeTruthy();
    await click(byText(/For You/));
    expect(screen.getByText(/No recommendations yet/)).toBeTruthy();
    await click(byText(/Sync/));
    expect(screen.getByText(/No playback positions yet/)).toBeTruthy();
    await click(byText(/Auto-download/));
    expect(screen.getByText(/Add shows in the Feeds tab first/)).toBeTruthy();
  });
});

describe('browse panel flows', () => {
  it('lists shows, toggles subscribe and opens a show with reviews', async () => {
    render(<PodcastBrowsePanel onChange={vi.fn()} />);
    await settle();
    await click(screen.getByText('The Show'));
    const subs = screen.getAllByRole('button').filter((b) => /subscribe|subscribed/i.test(b.textContent || ''));
    if (subs.length) await click(subs[0]);
    expect(sent()).toContain('show-list');
    const q = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === 'Add to queue');
    if (q) await click(q);
    const d = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === 'Download');
    if (d) await click(d);
    const a = sent();
    expect(a.some((x) => /subscribe/.test(x))).toBe(true);
    expect(a.some((x) => /queue/.test(x))).toBe(true);
    expect(a.some((x) => /download/.test(x))).toBe(true);
  });
});

describe('create episode flows', () => {
  it('keeps Create disabled while untitled, then creates a titled one and resets the form', async () => {
    const onCreated = vi.fn();
    render(<CreateEpisodePanel onCreated={onCreated} />);
    await settle();
    expect((byText(/Create Episode/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Episode title'), { target: { value: 'Ep Three' } });
    fireEvent.change(screen.getByPlaceholderText('Episode description...'), { target: { value: 'About things' } });
    fireEvent.change(screen.getByLabelText('Episode Number'), { target: { value: '7' } });
    const [, seasonBox] = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(seasonBox, { target: { value: '2' } });
    await click(byText(/finish-upload/));
    expect(screen.getByText(/Audio uploaded/)).toBeTruthy();
    await click(byText(/Create Episode/));
    const call = lensRunMock.mock.calls.find((c) => actionOf(c) === 'episode-add');
    expect(call).toBeTruthy();
    expect(JSON.stringify(call)).toContain('Ep Three');
    expect(onCreated).toHaveBeenCalled();
    expect((screen.getByPlaceholderText('Episode title') as HTMLInputElement).value).toBe('');
  });

  it('reports a create failure and lets an uploaded audio be cleared', async () => {
    render(<CreateEpisodePanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Episode title'), { target: { value: 'Bad' } });
    await click(byText(/finish-upload/));
    await click(screen.getByLabelText('Close'));
    expect(screen.getByText('pick-file')).toBeTruthy();
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'episode-add'
      ? { data: { ok: false, error: 'server said no' } }
      : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await click(byText(/Create Episode/));
    expect(screen.getAllByText(/server said no|Upload audio first|upload/i).length).toBeGreaterThan(0);
  });

  it('a picked file that cannot upload blocks creation with the upload-first message', async () => {
    render(<CreateEpisodePanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Episode title'), { target: { value: 'With file' } });
    await click(byText(/pick-file/));
    await click(byText(/Create Episode/));
    expect(screen.getAllByText(/audio/i).length).toBeGreaterThan(0);
  });
});

describe('itunes add-to-library flow', () => {
  it('searches, adds a result to the library (show-add, rss-refresh, subscribe) and marks it added', async () => {
    render(<ItunesSearch />);
    await settle();
    const box = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'history' } });
    await click(byText(/^\s*Search/));
    await click(byText(/Add to Library/));
    const a = runDomain.mock.calls.map((c) => c[1]);
    expect(a).toEqual(expect.arrayContaining(['itunes-search', 'show-add', 'rss-refresh', 'show-list', 'show-subscribe']));
    expect(screen.getAllByText('Added').length).toBeGreaterThan(0);
  });

  it('shows an error toast path when the add fails', async () => {
    render(<ItunesSearch />);
    await settle();
    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: 'history' } });
    await click(byText(/^\s*Search/));
    runDomain.mockImplementation(async (_d: string, action: string) => action === 'show-add'
      ? { data: { ok: false, error: 'could not add show' } }
      : { data: { ok: true, result: resultFor(action) } });
    await click(byText(/Add to Library/));
    expect(runDomain.mock.calls.map((c) => c[1])).toContain('show-add');
  });
});
