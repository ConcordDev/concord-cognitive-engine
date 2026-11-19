// Liner Notes (the Music lens) against a mocked /api/lens/run: navigation in
// the URL, a release page that only says "Owned" when the server confirms a
// purchase, honest refusal text, the artist page's follow with rollback and
// safe links, the artist editor's publish checklist, and the player mapping.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let handler: (action: string, input: Record<string, unknown>) => { data: { ok: boolean; result: unknown; error: string | null } };
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_d: string, action: string, input: Record<string, unknown>) => { calls.push({ action, input }); return handler(action, input); }),
}));
const toasts: Array<[string, string]> = [];
vi.mock('@/components/common/Toasts', () => ({ showToast: (k: string, m: string) => toasts.push([k, m]) }));
const playAlbum = vi.fn();
vi.mock('@/lib/music/store', () => ({
  useMusicStore: Object.assign((sel: (s: unknown) => unknown) => sel({ nowPlaying: { track: null, playbackState: 'stopped' } }), { getState: () => ({ playAlbum }) }),
}));
const primeAndPlay = vi.fn(() => Promise.resolve());
vi.mock('@/lib/music/player', () => ({ getPlayer: () => ({ primeAndPlay, getPlaybackState: () => 'stopped', pause: vi.fn(), play: vi.fn(() => Promise.resolve()), applyAudioSettings: vi.fn(), setKaraoke: vi.fn() }) }));

import { navFromSearch, searchFromNav } from '@/components/music/liner/LinerNotesApp';
import { ReleasePage } from '@/components/music/liner/ReleasePage';
import { ArtistPage } from '@/components/music/liner/ArtistPage';
import { ForArtists } from '@/components/music/liner/ForArtists';
import { toPlayerTrack, fmtDuration, fmtTotal, releaseRefOf, type Release } from '@/components/music/liner/linerApi';

const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
const no = (error: string) => ({ data: { ok: false, result: null, error } });

function release(over: Partial<Release> = {}): Release {
  return {
    id: 'rel_paper', title: 'Paper Moons', type: 'ep', genre: 'indie', note: 'Thanks for listening.\nSecond line.',
    credits: [{ role: 'Producer', name: 'June' }], coverDtuId: null, coverUrl: null, priceCC: 10, streaming: 'preview', previewSec: 30,
    status: 'published', releaseDate: '2026-11-19', publishedAt: '2026-11-19T00:00:00Z', dtuId: 'dtu_rel', owned: false,
    remixOf: [], remixes: [{ id: 'rel_dusk', title: 'Paper Moons (Dusk Mix)', artist: { handle: 'remy', key: 'a_2', name: 'remy', isMe: false } }],
    artist: { handle: 'june', key: 'a_1', name: 'june', isMe: false },
    tracks: [
      { mediaId: 'm1', title: 'Side A', durationSec: 120, explicit: false, bpm: 92, key: 'A minor', lufs: -13.9, plays: 3, streamUrl: '/api/media/m1/stream', fullStream: false },
      { mediaId: 'm2', title: 'Side B', durationSec: 95, explicit: true, bpm: null, key: null, lufs: null, plays: 0, streamUrl: '/api/media/m2/stream', fullStream: false },
    ],
    durationSec: 215,
    ...over,
  };
}

beforeEach(() => { calls.length = 0; toasts.length = 0; playAlbum.mockClear(); primeAndPlay.mockClear(); });

describe('navigation lives in the URL', () => {
  it('round-trips views and drops bad values', () => {
    expect(navFromSearch('?v=release&id=rel_1')).toEqual({ v: 'release', id: 'rel_1' });
    expect(navFromSearch('?v=artist&h=june')).toEqual({ v: 'artist', h: 'june' });
    expect(navFromSearch('?v=release')).toEqual({ v: 'listen' });
    expect(navFromSearch('?v=<script>')).toEqual({ v: 'listen' });
    expect(searchFromNav({ v: 'library', t: 'songs' }, '?project=x&v=listen')).toBe('?project=x&v=library&t=songs');
    expect(searchFromNav({ v: 'listen' }, '?v=search&q=a')).toBe('');
  });
});

describe('ReleasePage', () => {
  it('shows the sleeve: preview badges, BPM and key, liner note, credits and the family tree', async () => {
    handler = (a) => (a === 'release-get' ? ok({ release: release() }) : ok({ tracks: [] }));
    render(<ReleasePage id="rel_paper" onArtist={() => {}} onRelease={() => {}} />);
    expect((await screen.findByTestId('ln-release-title')).textContent).toBe('Paper Moons');
    expect(screen.getAllByText('Preview')).toHaveLength(2);
    expect(screen.getByText(/92 BPM · A minor · 3 plays/)).toBeTruthy();
    expect(screen.getByText('You hear 30-second previews until you buy.')).toBeTruthy();
    expect(screen.getByTestId('ln-note').textContent).toBe('Thanks for listening.\nSecond line.');
    expect(screen.getByText('June')).toBeTruthy();
    expect(screen.getByText('Paper Moons (Dusk Mix)')).toBeTruthy();
    expect(screen.getByText('E')).toBeTruthy();
  });

  it('buy asks to confirm, pays through release-buy, and only shows Owned when the server returns it', async () => {
    handler = (a) => {
      if (a === 'release-get') return ok({ release: release() });
      if (a === 'release-buy') return ok({ release: release({ owned: true, tracks: release().tracks.map((t) => ({ ...t, fullStream: true })) }), price: 10 });
      return ok({ tracks: [] });
    };
    render(<ReleasePage id="rel_paper" onArtist={() => {}} onRelease={() => {}} />);
    fireEvent.click(await screen.findByTestId('ln-buy'));
    expect(calls.some((c) => c.action === 'release-buy')).toBe(false);
    expect(screen.getByText(/95% to the artist's creator pool/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('ln-buy-confirm'));
    expect(await screen.findByTestId('ln-owned')).toBeTruthy();
    expect(calls.find((c) => c.action === 'release-buy')!.input).toEqual({ id: 'rel_paper' });
    expect(screen.queryAllByText('Preview')).toHaveLength(0);
    expect(toasts[0][1]).toMatch(/Paper Moons is yours\. 10 CC paid/);
  });

  it('a refused purchase shows the server reason and stays unowned', async () => {
    handler = (a) => (a === 'release-get' ? ok({ release: release() }) : a === 'release-buy' ? no('not enough Concord Coin: this costs 10 CC and you have 3 CC') : ok({ tracks: [] }));
    render(<ReleasePage id="rel_paper" onArtist={() => {}} onRelease={() => {}} />);
    fireEvent.click(await screen.findByTestId('ln-buy'));
    fireEvent.click(screen.getByTestId('ln-buy-confirm'));
    expect((await screen.findByTestId('ln-buy-error')).textContent).toBe('not enough Concord Coin: this costs 10 CC and you have 3 CC');
    expect(screen.queryByTestId('ln-owned')).toBeNull();
  });

  it('play queues the whole release through the platform player inside the click', async () => {
    handler = (a) => (a === 'release-get' ? ok({ release: release() }) : ok({ tracks: [] }));
    render(<ReleasePage id="rel_paper" onArtist={() => {}} onRelease={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play Side B' }));
    expect(playAlbum).toHaveBeenCalledTimes(1);
    const [queue, index] = playAlbum.mock.calls[0];
    expect(queue.map((t: { title: string }) => t.title)).toEqual(['Side A', 'Side B']);
    expect(index).toBe(1);
    expect(primeAndPlay).toHaveBeenCalledWith(queue[1]);
  });

  it('hearts start from the real library and saving calls library-add-release-track', async () => {
    handler = (a) => {
      if (a === 'release-get') return ok({ release: release() });
      if (a === 'liked-songs') return ok({ tracks: [{ releaseId: 'rel_paper', mediaId: 'm1' }] });
      return ok({ track: {}, added: true });
    };
    render(<ReleasePage id="rel_paper" onArtist={() => {}} onRelease={() => {}} />);
    await screen.findByTestId('ln-release-title');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Side A to your library' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Side B to your library' }));
    await waitFor(() => expect(calls.find((c) => c.action === 'library-add-release-track')?.input).toEqual({ id: 'rel_paper', mediaId: 'm2', like: true }));
  });
});

describe('ArtistPage', () => {
  const page = (over = {}) => ({
    artist: { handle: 'june', key: 'a_1', name: 'june', isMe: false }, bio: 'From the coast.',
    links: [{ label: 'Site', url: 'https://june.example' }, { label: 'Bad', url: 'javascript:alert(1)' }],
    followers: 4, following: false, releases: [release()], topTracks: [], totalPlays: 3, ...over,
  });

  it('follow is instant and rolls back when the server refuses', async () => {
    handler = (a) => (a === 'artist-page' ? ok(page()) : no('sign in to follow'));
    render(<ArtistPage artist={{ handle: 'june' }} onRelease={() => {}} onArtist={() => {}} />);
    const btn = await screen.findByTestId('ln-follow');
    fireEvent.click(btn);
    expect(btn.textContent).toMatch(/Following/);
    await waitFor(() => expect(screen.getByTestId('ln-follow').textContent).toMatch(/^\s*Follow$/));
    expect(toasts).toContainEqual(['error', 'sign in to follow']);
  });

  it('renders only http(s) links', async () => {
    handler = () => ok(page());
    render(<ArtistPage artist={{ handle: 'june' }} onRelease={() => {}} onArtist={() => {}} />);
    expect(await screen.findByRole('link', { name: 'Site' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull();
  });
});

describe('ForArtists', () => {
  it('a draft with no songs cannot be published, and the checklist says why', async () => {
    const draft = release({ id: 'rel_d', title: 'Draft', status: 'draft', tracks: [], artist: { handle: 'me', key: 'a_me', name: 'me', isMe: true }, owned: true, sales: 0 });
    handler = (a) => {
      if (a === 'release-list-mine') return ok({ releases: [draft], artist: draft.artist, salesGrossCC: 0, creatorPoolCC: 0 });
      if (a === 'artist-profile-get') return ok({ profile: { bio: '', links: [] } });
      return no('?');
    };
    render(<ForArtists onRelease={() => {}} onArtist={() => {}} focusId="rel_d" onFocus={() => {}} />);
    const publish = await screen.findByTestId('ln-publish');
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/○ At least one song/)).toBeTruthy();
  });

  it('shows the real money split for the price being typed', async () => {
    const draft = release({ id: 'rel_d', status: 'draft', artist: { handle: 'me', key: 'a_me', name: 'me', isMe: true }, owned: true, sales: 0 });
    handler = (a) => (a === 'release-list-mine' ? ok({ releases: [draft], artist: draft.artist, salesGrossCC: 0, creatorPoolCC: 0 }) : ok({ profile: { bio: '', links: [] } }));
    render(<ForArtists onRelease={() => {}} onArtist={() => {}} focusId="rel_d" onFocus={() => {}} />);
    fireEvent.change(await screen.findByTestId('ln-edit-price'), { target: { value: '7' } });
    expect(screen.getByText(/Each sale of 7 CC: 6\.65 CC to your creator pool .* 0\.35 CC platform/)).toBeTruthy();
  });
});

describe('player mapping and formatting', () => {
  it('maps a release track to the platform player shape without inventing data', () => {
    const t = toPlayerTrack(release(), release().tracks[0], 0);
    expect(t.id).toBe('rel_paper:m1');
    expect(releaseRefOf(t.id)).toEqual({ releaseId: 'rel_paper', mediaId: 'm1' });
    expect(t).toMatchObject({ title: 'Side A', artistName: 'june', albumTitle: 'Paper Moons', audioUrl: '/api/media/m1/stream', bpm: 92, key: 'A minor', loudnessLUFS: -13.9, trackNumber: 1, lyrics: null, spectralCentroid: null });
    expect(releaseRefOf('trk_123')).toBeNull();
  });
  it('formats durations', () => {
    expect([fmtDuration(95), fmtDuration(3725), fmtDuration(null), fmtTotal(215), fmtTotal(4500)]).toEqual(['1:35', '1:02:05', '—', '4 min', '1 hr 15 min']);
  });
});

describe('cover fallback', () => {
  it('a cover that fails to load becomes the tinted initial, not a broken image', async () => {
    const { Cover } = await import('@/components/music/liner/parts');
    render(<Cover url="/api/artifact/gone/stream" title="Paper Moons" />);
    const img = screen.getByAltText('Cover of Paper Moons');
    fireEvent.error(img);
    expect(screen.queryByAltText('Cover of Paper Moons')).toBeNull();
    expect(screen.getByText('P')).toBeTruthy();
  });
});

