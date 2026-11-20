/**
 * The Transcript Page (Podcast lens): the passage being said is the one the
 * player is in, from real timings only; tapping a passage plays from there;
 * an untimed transcript says it can't follow along; a supporters-only episode
 * shows its preview and the pass; tips say what the creator gets; a transcript
 * file is sent in the format its extension names.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/podcast/PodcastActionPanel', () => ({ PodcastActionPanel: () => null }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a), api: { post: vi.fn() } }));

import { PlayerContext, type Player } from '@/components/podcast/press/pc';
import { Reader } from '@/components/podcast/press/Reader';
import { SupportBox } from '@/components/podcast/press/SupportBox';
import { StudioRoom } from '@/components/podcast/press/Studio';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
const env = (result: unknown) => ({ data: { ok: true, result } });
const fail = (error: string) => ({ data: { ok: false, error } });
function route(map: Record<string, (i: Record<string, unknown>) => unknown>) {
  lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown>) => {
    if (!(action in map)) return env({});
    const out = map[action](input);
    return out && typeof out === 'object' && 'data' in (out as object) ? out : env(out);
  });
}
const EP = {
  id: 'ep_1', showId: 'show_1', showTitle: 'Night Shift', title: 'Bridges', description: 'How spans stand.', durationSec: 600,
  publishDate: '2026-03-01', episodeNumber: 3, seasonNumber: null, mediaId: 'm1', audioUrl: '/api/media/m1/stream',
  positionSec: 0, played: false, progressPct: 0, inQueue: false, downloaded: false, playCount: 0,
  access: 'everyone', locked: false, previewSec: null, hasTranscript: true, feedTranscript: false, canEdit: false,
  chapters: [{ startSec: 10, title: 'The arch' }],
};
const SHOW = { id: 'show_1', title: 'Night Shift', author: 'Ada', isCreatorShow: true, addedBy: 'ada', coverUrl: null, category: 'science', description: null, feedUrl: null, episodeCount: 1, subscribed: false, subscriberCount: 0, reviewCount: 0, rating: 0 };
const TIMED = { episodeId: 'ep_1', hasTranscript: true, timing: 'timed', segments: [
  { startSec: 0, endSec: 10, text: 'Welcome back.' },
  { startSec: 10, endSec: 20, text: 'An arch pushes outward.' },
  { startSec: 20, endSec: 30, text: 'So the ends must hold.' },
] };
function player(over: Partial<Player> = {}): Player {
  return { episodeId: 'ep_1', position: 0, duration: 600, playing: true, load: vi.fn(), seek: vi.fn(), toggle: vi.fn(), ...over };
}
const mount = (p: Player, ui: React.ReactElement) => render(<PlayerContext.Provider value={p}>{ui}</PlayerContext.Provider>);

beforeEach(() => { lensRun.mockReset(); });
afterEach(cleanup);

describe('the page follows the audio', () => {
  it('underlines the passage the player is in, with the chapter as a section head', async () => {
    route({ 'episode-detail': () => ({ episode: EP }), 'show-detail': () => ({ show: SHOW }), 'transcript-get': () => TIMED, 'supporter-status': () => ({ hasPass: false, tipFeeRate: 0.0146 }) });
    const view = mount(player({ position: 14 }), <Reader episodeId="ep_1" />);
    await screen.findByTestId('tp-transcript');
    const now = view.container.querySelector('[data-now="true"]');
    expect(now?.textContent).toContain('An arch pushes outward.');
    expect(view.container.querySelectorAll('[data-past="true"]')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'The arch' })).toBeTruthy();
    view.rerender(<PlayerContext.Provider value={player({ position: 25 })}><Reader episodeId="ep_1" /></PlayerContext.Provider>);
    expect(view.container.querySelector('[data-now="true"]')?.textContent).toContain('So the ends must hold.');
  });

  it('nothing is underlined for a different episode in the player', async () => {
    route({ 'episode-detail': () => ({ episode: EP }), 'show-detail': () => ({ show: SHOW }), 'transcript-get': () => TIMED });
    const view = mount(player({ episodeId: 'ep_other', position: 14 }), <Reader episodeId="ep_1" />);
    await screen.findByTestId('tp-transcript');
    expect(view.container.querySelector('[data-now="true"]')).toBeNull();
  });

  it('tapping a passage plays from its time', async () => {
    route({ 'episode-detail': () => ({ episode: EP }), 'show-detail': () => ({ show: SHOW }), 'transcript-get': () => TIMED });
    const p = player({ episodeId: null, playing: false });
    mount(p, <Reader episodeId="ep_1" />);
    fireEvent.click(await screen.findByText('So the ends must hold.'));
    expect(p.load).toHaveBeenCalledWith('ep_1', { at: 20, autoplay: true });
  });

  it('an untimed transcript reads as text and says it cannot follow along', async () => {
    route({ 'episode-detail': () => ({ episode: EP }), 'show-detail': () => ({ show: SHOW }), 'transcript-get': () => ({ ...TIMED, timing: 'none', segments: [{ startSec: null, endSec: null, text: 'Plain words.' }] }) });
    const view = mount(player({ position: 14 }), <Reader episodeId="ep_1" />);
    expect(await screen.findByText(/no timings, so it can’t follow along/)).toBeTruthy();
    expect(screen.getByText('Plain words.')).toBeTruthy();
    expect(view.container.querySelector('[data-now]')).toBeNull();
  });

  it('a supporters-only episode shows its preview and the way in', async () => {
    route({
      'episode-detail': () => ({ episode: { ...EP, access: 'supporters', locked: true, previewSec: 90 } }),
      'show-detail': () => ({ show: SHOW }),
      'transcript-get': () => ({ ...TIMED, locked: true, totalSegments: 9 }),
      'supporter-status': () => ({ hasPass: true, priceCC: 4, perks: 'Bonus episodes', supporter: false, isCreator: false, supportersOnlyEpisodes: 2, tipFeeRate: 0.0146 }),
    });
    mount(player({ episodeId: null }), <Reader episodeId="ep_1" />);
    expect((await screen.findByTestId('tp-locked')).textContent).toMatch(/6 more passages/);
    expect(screen.getByTestId('tp-listen').textContent).toMatch(/1.5-minute preview/);
    expect((await screen.findByTestId('tp-buy-pass')).textContent).toMatch(/Become a supporter · 4 CC/);
  });

  it('a missing episode says so plainly', async () => {
    route({ 'episode-detail': () => fail('episode not found') });
    mount(player(), <Reader episodeId="ep_x" />);
    expect((await screen.findByRole('alert')).textContent).toBe('episode not found');
  });
});

describe('paying a creator', () => {
  it('a tip names what the creator gets after the transfer fee, then confirms from the server', async () => {
    route({
      'supporter-status': () => ({ hasPass: false, isCreator: false, tipFeeRate: 0.0146 }),
      'show-tip': () => ({ amount: 5, creatorGets: 4.93, balance: 15 }),
    });
    render(<SupportBox show={SHOW as never} episodeId="ep_1" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('podcast', 'supporter-status', { showId: 'show_1' }));
    fireEvent.click(screen.getByRole('button', { name: '5 CC' }));
    expect(screen.getByText(/They get 4.93 CC after the 1.46% transfer fee/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('tp-tip')); });
    expect(lensRun).toHaveBeenCalledWith('podcast', 'show-tip', { showId: 'show_1', episodeId: 'ep_1', amount: 5 });
    expect((await screen.findByRole('status')).textContent).toMatch(/Ada gets 4.93 CC; your balance is 15 CC/);
  });

  it('a refused tip shows the server’s reason', async () => {
    route({ 'supporter-status': () => ({ hasPass: false, tipFeeRate: 0.0146 }), 'show-tip': () => fail('not enough Concord Coin: this tip is 3 CC and you have 1 CC') });
    render(<SupportBox show={SHOW as never} />);
    await act(async () => { fireEvent.click(screen.getByTestId('tp-tip')); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/you have 1 CC/);
  });

  it('a show from an outside feed and your own show have no support box', async () => {
    route({ 'supporter-status': () => ({ hasPass: true, isCreator: true, tipFeeRate: 0.0146 }) });
    const a = render(<SupportBox show={{ ...SHOW, isCreatorShow: false } as never} />);
    expect(a.container.textContent).toBe('');
    cleanup();
    const b = render(<SupportBox show={SHOW as never} />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    await waitFor(() => expect(b.container.querySelector('[data-testid="tp-support"]')).toBeNull());
  });
});

describe('your show', () => {
  it('sends a transcript file in the format its extension names, and refuses others', async () => {
    const mine = { ...EP, canEdit: true, status: 'draft', hasTranscript: false };
    route({
      'my-show-ensure': () => ({ show: SHOW }),
      'show-detail': () => ({ show: SHOW }),
      'episode-list': () => ({ episodes: [mine] }),
      'show-feed-info': () => ({ feedPath: '/api/podcast/shows/show_1/feed.xml', readiness: [{ id: 'cover', ok: false, label: 'Cover art' }], ready: false, episodesInFeed: 0, categories: ['Science'] }),
      'transcript-set': () => ({ segmentCount: 2, timing: 'timed' }),
      'supporter-status': () => ({ hasPass: false, tipFeeRate: 0.0146 }),
      'show-earnings': () => ({ tips: { count: 0, total: 0, recent: [] }, supporters: 0, passPriceCC: null, note: '' }),
    });
    const view = render(<QueryClientProvider client={new QueryClient()}><PlayerContext.Provider value={player()}><StudioRoom /></PlayerContext.Provider></QueryClientProvider>);
    expect((await screen.findByTestId('tp-feed-url')).textContent).toMatch(/\/api\/podcast\/shows\/show_1\/feed\.xml$/);
    const input = view.container.querySelector('input[type="file"][accept^=".vtt"]') as HTMLInputElement;
    const vtt = new File(['WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.'], 'ep.vtt', { type: 'text/vtt' });
    await act(async () => { fireEvent.change(input, { target: { files: [vtt] } }); });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('podcast', 'transcript-set', { episodeId: 'ep_1', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.' }));
    expect((await screen.findByText(/timed, so it follows along/))).toBeTruthy();
    lensRun.mockClear();
    await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'ep.docx')] } }); });
    expect(await screen.findByText(/Use a \.vtt, \.srt, \.json or \.txt file/)).toBeTruthy();
    expect(lensRun).not.toHaveBeenCalledWith('podcast', 'transcript-set', expect.anything());
  });
});
