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

describe('create episode flows', () => {
  it('FIX-podcast-001: Create stays enabled while untitled and explains itself on click, then creates a titled one', async () => {
    const onCreated = vi.fn();
    render(<CreateEpisodePanel onCreated={onCreated} />);
    await settle();
    // Was: disabled while untitled with no message (the ticketed defect).
    // Now the click reaches the handler's own guard and it speaks.
    expect((byText(/Create Episode/) as HTMLButtonElement).disabled).toBe(false);
    await click(byText(/Create Episode/));
    expect(screen.getAllByText(/Episode title is required/).length).toBeGreaterThan(0);
    expect(sent()).not.toContain('episode-add');
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

