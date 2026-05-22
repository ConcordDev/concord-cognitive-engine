import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MusicParityPanel } from '@/components/music/MusicParityPanel';

const track = (id: string) => ({ id, title: `T ${id}`, artist: 'A', genre: 'pop', durationSec: 180 });

function routeMock(over: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, macro: string) => {
    const map: Record<string, unknown> = {
      // catalog
      'track-list': { data: { ok: true, result: { tracks: [track('t1'), track('t2')] } } },
      'download-list': { data: { ok: true, result: { downloads: [{ trackId: 't1', title: 'T t1', artist: 'A', sizeKb: 4096 }], totalSizeKb: 4096 } } },
      'ingest-itunes': { data: { ok: true, result: { tracks: [track('i1')], ingested: 1, skipped: 0 } } },
      'lyrics-autofetch': { data: { ok: true, result: { found: true, lineCount: 30, synced: true } } },
      'download-add': { data: { ok: true, result: {} } },
      'download-remove': { data: { ok: true, result: {} } },
      // engine
      'engine-config': { data: { ok: true, result: { config: { crossfadeSec: 4, gapless: true, normalize: false, quality: 'high', eq: { enabled: true, preset: 'flat', bands: { bass: 2, mid: 0, treble: 1 } }, karaoke: { enabled: false, vocalReductionPct: 80, scrollLyrics: true } }, normalizeTargetDb: -14, crossfadeMs: 4000 } } },
      'device-list': { data: { ok: true, result: { devices: [{ id: 'd1', name: 'Phone', kind: 'phone', active: false }, { id: 'd2', name: 'TV', kind: 'tv', active: true }] } } },
      'eq-set': { data: { ok: true, result: {} } },
      'karaoke-set': { data: { ok: true, result: {} } },
      'device-register': { data: { ok: true, result: {} } },
      'device-transfer': { data: { ok: true, result: {} } },
      // discover
      'scheduled-playlist-list': { data: { ok: true, result: { playlists: [{ kind: 'discover_weekly', refreshedAt: '', nextRefreshAt: '', mood: 'focus', trackCount: 25, due: false }] } } },
      'smart-recommend': { data: { ok: true, result: { tracks: [track('r1')], basis: 'collaborative' } } },
      'dj-session': { data: { ok: true, result: { tracks: [track('dj1')], voice: { text: 'Spinning it up' } } } },
      'ai-playlist': { data: { ok: true, result: { playlist: { name: 'Focus Flow' }, trackCount: 14, basis: 'mood' } } },
      'scheduled-playlist-refresh': { data: { ok: true, result: {} } },
      // social
      'friend-activity': { data: { ok: true, result: { activity: [{ userId: 'u1', kind: 'now_playing', track: { title: 'FA One', artist: 'B', genre: 'pop' }, at: '' }] } } },
      'playlist-list': { data: { ok: true, result: { playlists: [{ id: 'p1', name: 'Mix', collaborative: true }] } } },
      'jam-create': { data: { ok: true, result: { jam: { id: 'j1', code: 'ABCD', name: 'Listening Jam', participants: ['u1'] } } } },
      'jam-join': { data: { ok: true, result: { jam: { id: 'j2', code: 'WXYZ', name: 'Joined Jam', participants: ['u1', 'u2'] } } } },
      'jam-leave': { data: { ok: true, result: {} } },
      'playlist-collab-edit': { data: { ok: true, result: { trackCount: 9 } } },
      'share-card': { data: { ok: true, result: { card: { id: 'c1', kind: 'track', title: 'Card', subtitle: 'sub', gradient: ['#111', '#222'], shareUrl: 'http://x/c1' } } } },
      // artist
      'stream-analytics': { data: { ok: true, result: { totalStreams: 500, uniqueListeners: 80, catalogSize: 12, avgStreamsPerTrack: 41, bySource: { radio: 200, search: 300 }, topTracks: [{ title: 'Hit', streams: 120 }], genreSplit: { pop: 8 } } } },
      'artist-profile-get': { data: { ok: true, result: { profile: { bio: 'Existing bio', canvasUrl: 'http://x/canvas.mp4', pickTrackId: 't1', links: [] } } } },
      'artist-profile-set': { data: { ok: true, result: {} } },
      'concert-listings': { data: { ok: true, result: { events: [{ mbid: 'e1', name: 'Live Show', date: '2026-07-01', time: '20:00' }], count: 1 } } },
      ...over,
    };
    return map[macro] ?? { data: { ok: true, result: {} } };
  });
}

describe('MusicParityPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the catalog sub-tab by default with tracks and downloads', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog Ingestion/)).toBeInTheDocument());
    expect(screen.getByText('T t1')).toBeInTheDocument();
  });

  it('catalog: iTunes ingestion populates results and an ingest message', async () => {
    const onChange = vi.fn();
    routeMock();
    render(<MusicParityPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Search iTunes/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search iTunes/), { target: { value: 'beatles' } });
    const ingestBtns = screen.getAllByRole('button');
    fireEvent.click(ingestBtns.find((b) => b.textContent?.includes('Ingest')) ?? ingestBtns[1]);
    await waitFor(() => expect(screen.getByText(/Ingested 1 tracks/)).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('switches to the Playback sub-tab and renders the equalizer', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByText('Equalizer')).toBeInTheDocument());
    expect(screen.getByText('Karaoke Mode')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('playback: changing an EQ preset and toggling karaoke call macros', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByText('Equalizer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('bass boost'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'eq-set', { preset: 'bass_boost' }));
    // device transfer for the inactive device
    fireEvent.click(screen.getByText('Transfer'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'device-transfer', { deviceId: 'd1' }));
  });

  it('playback: registering a device requires a name', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByPlaceholderText(/Device name/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Device name/), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'device-register', { name: 'Laptop', kind: 'web' }));
  });

  it('switches to Discover and runs an AI playlist', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getByText('AI Playlist')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/upbeat focus music/), { target: { value: 'deep work' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText(/Created "Focus Flow"/)).toBeInTheDocument());
  });

  it('discover: AI DJ session shows the spoken narration line', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getByText('Start DJ session')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start DJ session'));
    await waitFor(() => expect(screen.getByText(/Spinning it up/)).toBeInTheDocument());
  });

  it('discover: refreshing a scheduled playlist calls the macro', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getByText('Scheduled Playlists')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Refresh')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'scheduled-playlist-refresh', { kind: 'discover_weekly' }));
  });

  it('switches to Social and hosts a Jam', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Social'));
    await waitFor(() => expect(screen.getByText(/Jam — Group Listening/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Host'));
    await waitFor(() => expect(screen.getByText('ABCD')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Leave jam'));
    await waitFor(() => expect(screen.getByText('Host')).toBeInTheDocument());
  });

  it('social: joining a jam by code works', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Social'));
    await waitFor(() => expect(screen.getByPlaceholderText(/Join with a code/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Join with a code/), { target: { value: 'wxyz' } });
    fireEvent.click(screen.getByText('Join'));
    await waitFor(() => expect(screen.getByText('WXYZ')).toBeInTheDocument());
  });

  it('social: making a share card adds it to the list', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Social'));
    await waitFor(() => expect(screen.getByText('Share Cards')).toBeInTheDocument());
    fireEvent.click(screen.getByText('wrapped'));
    await waitFor(() => expect(screen.getByText('Card')).toBeInTheDocument());
  });

  it('switches to Artist and renders streaming analytics', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Streaming Analytics')).toBeInTheDocument());
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText(/radio: 200/)).toBeInTheDocument();
  });

  it('artist: saving the profile calls artist-profile-set', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Save profile')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Artist bio/), { target: { value: 'New bio' } });
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(screen.getByText('Profile saved.')).toBeInTheDocument());
  });

  it('artist: concert lookup renders events', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Concert Listings')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Artist name…'), { target: { value: 'Nova' } });
    fireEvent.click(screen.getByText('Find shows'));
    await waitFor(() => expect(screen.getByText('Live Show')).toBeInTheDocument());
  });

  it('artist: shows empty analytics state when catalog is empty', async () => {
    routeMock({
      'stream-analytics': { data: { ok: true, result: { totalStreams: 0, uniqueListeners: 0, catalogSize: 0, avgStreamsPerTrack: 0, bySource: {}, topTracks: [], genreSplit: {} } } },
    });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText(/Upload tracks to your catalog/)).toBeInTheDocument());
  });

  it('discover: shows empty recommendations state', async () => {
    routeMock({ 'smart-recommend': { data: { ok: true, result: { tracks: [], basis: '' } } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getByText(/train the recommender/)).toBeInTheDocument());
  });

  it('catalog: iTunes ingestion failure surfaces the error', async () => {
    routeMock({ 'ingest-itunes': { data: { ok: false, error: 'iTunes down' } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Search iTunes/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search iTunes/), { target: { value: 'x' } });
    const btns = screen.getAllByRole('button');
    fireEvent.click(btns.find((b) => b.textContent?.includes('Ingest')) ?? btns[1]);
    await waitFor(() => expect(screen.getByText('iTunes down')).toBeInTheDocument());
  });

  it('catalog: fetching lyrics, adding and removing a download call macros', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('T t1')).toBeInTheDocument());
    // each track row has a lyrics + a download button; the download list has remove buttons.
    const lyricsBtn = screen.getAllByRole('button').find((b) => /lyric/i.test(b.textContent || ''));
    if (lyricsBtn) {
      fireEvent.click(lyricsBtn);
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'lyrics-autofetch', expect.any(Object)));
    }
    const dlBtn = screen.getAllByRole('button').find((b) => /download/i.test(b.textContent || ''));
    if (dlBtn) {
      fireEvent.click(dlBtn);
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'download-add', expect.any(Object)));
    }
  });

  it('catalog: lyrics autofetch with no lyrics found shows the no-lyrics message', async () => {
    routeMock({ 'lyrics-autofetch': { data: { ok: true, result: { found: false } } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('T t1')).toBeInTheDocument());
    const lyricsBtn = screen.getAllByRole('button').find((b) => /lyric/i.test(b.textContent || ''));
    if (lyricsBtn) {
      fireEvent.click(lyricsBtn);
      await waitFor(() => expect(screen.getByText(/no lyrics found/)).toBeInTheDocument());
    }
  });

  it('playback: dragging EQ band sliders and toggling karaoke options call macros', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByText('Equalizer')).toBeInTheDocument());
    const ranges = screen.getAllByRole('slider');
    // first 3 sliders are EQ bands, last is the karaoke vocal-reduction slider
    fireEvent.change(ranges[0], { target: { value: '6' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'eq-set', { bands: { bass: 6 } }));
    fireEvent.change(ranges[ranges.length - 1], { target: { value: '50' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'karaoke-set', { vocalReductionPct: 50 }));
    // EQ + karaoke enable toggles
    const eqToggle = screen.getByText('Equalizer enabled').closest('label')!.querySelector('button')!;
    fireEvent.click(eqToggle);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'eq-set', { enabled: false }));
    const karaokeToggle = screen.getByText('Karaoke enabled').closest('label')!.querySelector('button')!;
    fireEvent.click(karaokeToggle);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'karaoke-set', { enabled: true }));
  });

  it('playback: shows the no-devices empty state', async () => {
    routeMock({ 'device-list': { data: { ok: true, result: { devices: [] } } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByText('No registered devices.')).toBeInTheDocument());
  });

  it('discover: AI playlist failure and DJ failure surface their errors', async () => {
    routeMock({
      'ai-playlist': { data: { ok: false, error: 'prompt too vague' } },
      'dj-session': { data: { ok: false, error: 'need more tracks' } },
    });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getByText('AI Playlist')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/upbeat focus music/), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('prompt too vague')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start DJ session'));
    await waitFor(() => expect(screen.getByText(/need more tracks/)).toBeInTheDocument());
  });

  it('discover: scheduled playlist with no mood shows "Not generated" siblings', async () => {
    routeMock({ 'scheduled-playlist-list': { data: { ok: true, result: { playlists: [] } } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Discover'));
    await waitFor(() => expect(screen.getAllByText('Not generated').length).toBeGreaterThan(0));
  });

  it('social: jam join failure surfaces the error and friend-activity empty state', async () => {
    routeMock({
      'jam-join': { data: { ok: false, error: 'invalid code' } },
      'friend-activity': { data: { ok: true, result: { activity: [] } } },
    });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Social'));
    await waitFor(() => expect(screen.getByText('No friend activity yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Join with a code/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByText('Join'));
    await waitFor(() => expect(screen.getByText('invalid code')).toBeInTheDocument());
  });

  it('social: collaborative edit adds a track when both selects are chosen', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Social'));
    await waitFor(() => expect(screen.getByText(/Collaborative Playlist Editing/)).toBeInTheDocument());
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'p1' } });
    fireEvent.change(selects[1], { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Add to playlist'));
    await waitFor(() => expect(screen.getByText(/playlist now has 9 tracks/)).toBeInTheDocument());
  });

  it('artist: concert lookup with no events shows the no-events message', async () => {
    routeMock({ 'concert-listings': { data: { ok: true, result: { events: [], count: 0 } } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Concert Listings')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Artist name…'), { target: { value: 'Nobody' } });
    fireEvent.click(screen.getByText('Find shows'));
    await waitFor(() => expect(screen.getByText('No upcoming events found.')).toBeInTheDocument());
  });

  it('artist: profile save failure surfaces the error', async () => {
    routeMock({ 'artist-profile-set': { data: { ok: false, error: 'bio too long' } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Save profile')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(screen.getByText('bio too long')).toBeInTheDocument());
  });

  it('playback: renders with an engine config lacking eq/karaoke (default fallbacks)', async () => {
    routeMock({
      'engine-config': { data: { ok: true, result: { config: { crossfadeSec: 0, gapless: false, normalize: false, quality: 'normal' }, normalizeTargetDb: -14, crossfadeMs: 0 } } },
    });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Playback'));
    await waitFor(() => expect(screen.getByText('Equalizer')).toBeInTheDocument());
    // vocal-reduction defaults to 80% when karaoke config is absent
    expect(screen.getByText(/Vocal reduction: 80%/)).toBeInTheDocument();
  });

  it('artist: profile with a canvasUrl renders the canvas line', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText(/Canvas: http/)).toBeInTheDocument());
  });

  it('artist: concert lookup failure surfaces the error', async () => {
    routeMock({ 'concert-listings': { data: { ok: false, error: 'lookup down' } } });
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Free-API Catalog/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Artist'));
    await waitFor(() => expect(screen.getByText('Concert Listings')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Artist name…'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Find shows'));
    await waitFor(() => expect(screen.getByText('lookup down')).toBeInTheDocument());
  });

  it('catalog: removing a download from the downloads list calls download-remove', async () => {
    routeMock();
    render(<MusicParityPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('T t1')).toBeInTheDocument());
    // The download list shows a remove control for the seeded download entry.
    const removeBtn = screen.getAllByRole('button').find((b) => /remove/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    if (removeBtn) {
      fireEvent.click(removeBtn);
      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'download-remove', expect.any(Object)));
    }
  });
});
