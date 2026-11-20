// The Production Office rooms: the cut plays what the server says to play;
// footage uploads become footage; notes pin to the picture's real timecode;
// screenings join by code and only the host drives playback; releases send
// real prices and refuse bad ones locally; the cinema gates a priced film
// behind a real buy. The api client is mocked at the network boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock('@/components/film-studios/FsEditPanel', () => ({ FsEditPanel: () => <div data-testid="edit-panel" /> }));
vi.mock('@/components/film-studios/FsMediaPanel', () => ({ FsMediaPanel: () => <div data-testid="media-panel" /> }));
vi.mock('@/components/film-studios/FilmStackFeed', () => ({ FilmStackFeed: () => null }));
vi.mock('@/components/film-studios/FsDistributionPanel', () => ({ FsDistributionPanel: () => <div data-testid="festivals" /> }));

import { ProgramMonitor } from '@/components/film-studios/office/ProgramMonitor';
import { CuttingRoom } from '@/components/film-studios/office/CuttingRoom';
import { ScreeningRoom } from '@/components/film-studios/office/ScreeningRoom';
import { PartyRoom } from '@/components/film-studios/office/PartyRoom';
import { ReleaseDesk } from '@/components/film-studios/office/ReleaseDesk';
import { Cinema } from '@/components/film-studios/office/Cinema';
import { stripColour, tc } from '@/components/film-studios/office/fo';

type Handler = (action: string, input: Record<string, unknown>) => unknown;
const okR = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const errR = (error: string) => Promise.resolve({ data: { ok: false, error } });
function serve(h: Handler) {
  lensRun.mockImplementation((_d: string, action: string, input: Record<string, unknown>) => {
    const r = h(action, input || {});
    return r === undefined ? okR({}) : r;
  });
}
const calls = (action: string) => lensRun.mock.calls.filter((c) => c[1] === action).map((c) => c[2]);

const clip = (o: Record<string, unknown>) => ({ id: 'c', name: 'clip', transition: 'cut', durationFrames: 96, startTimecode: '00:00:00:00', endTimecode: '00:00:04:00', mediaId: 'm1', streamUrl: '/api/media/p1/stream', mediaKind: 'video', sourceInSec: 0, durationSec: 4, startSec: 0, ...o });

beforeEach(() => {
  lensRun.mockReset();
  // jsdom has no media playback
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});

describe('helpers', () => {
  it('colours strips by the stripboard convention and formats timecode', () => {
    expect(stripColour('INT', 'DAY')).toBe('var(--fo-strip-int-day)');
    expect(stripColour('EXT', 'DAY')).toBe('var(--fo-strip-ext-day)');
    expect(stripColour('INT', 'NIGHT')).toBe('var(--fo-strip-int-night)');
    expect(stripColour('EXT', 'NIGHT')).toBe('var(--fo-strip-ext-night)');
    expect(stripColour('INT/EXT', 'DUSK')).toBe('var(--fo-strip-dawn)');
    expect(tc(3725.5)).toBe('01:02:05:12');
  });
});

describe('program monitor', () => {
  it('lays the cut out from cut-list and marks clips without footage', async () => {
    serve((a) => (a === 'cut-list' ? okR({ tracks: { V1: [clip({ id: 'a', name: 'Dock wide' }), clip({ id: 'b', name: 'Insert', streamUrl: null, mediaKind: null, startSec: 4, durationSec: 2 })] } }) : undefined));
    render(<ProgramMonitor sequenceId="seq_1" />);
    expect((await screen.findAllByText('Dock wide')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 clip without footage (skipped)')).toBeTruthy();
    expect(screen.getByText(/00:00:00:00 \/ 00:00:06:00/)).toBeTruthy();
    expect(calls('cut-list')[0]).toEqual({ sequenceId: 'seq_1' });
    expect(screen.getByTestId('fo-monitor-play')).not.toBeDisabled();
  });
  it('cannot play a cut that has no footage at all', async () => {
    serve((a) => (a === 'cut-list' ? okR({ tracks: { V1: [clip({ streamUrl: null, mediaKind: null })] } }) : undefined));
    render(<ProgramMonitor sequenceId="seq_1" />);
    await screen.findByText('1 clip without footage (skipped)');
    expect(screen.getByTestId('fo-monitor-play')).toBeDisabled();
  });
});

describe('cutting room', () => {
  it('uploads a file as the request body and registers it as footage', async () => {
    serve((a) => {
      if (a === 'media-list') return okR({ media: [] });
      if (a === 'sequence-list') return okR({ sequences: [] });
      if (a === 'media-register') return okR({ media: { id: 'fm_1' } });
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ mediaDTU: { id: 'med_9' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<CuttingRoom projectId="p1" />);
    const file = new File([new Uint8Array(32)], 'A001_C003.png', { type: 'image/png' });
    fireEvent.change(await screen.findByTestId('fo-footage-input'), { target: { files: [file] } });
    await waitFor(() => expect(calls('media-register')).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^\/api\/media\/upload-raw\?/);
    expect(String(url)).toContain('mediaType=image');
    expect(init.body).toBe(file);
    expect(calls('media-register')[0]).toEqual({ projectId: 'p1', platformMediaId: 'med_9', name: 'A001_C003' });
    expect(await screen.findByText('1 file in the bin.')).toBeTruthy();
    vi.unstubAllGlobals();
  });
  it('refuses a file that is not footage before sending it', async () => {
    serve((a) => (a === 'media-list' ? okR({ media: [] }) : a === 'sequence-list' ? okR({ sequences: [] }) : undefined));
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<CuttingRoom projectId="p1" />);
    fireEvent.change(await screen.findByTestId('fo-footage-input'), { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText(/must be a video, audio or image file/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls('media-register')).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe('screening room', () => {
  const version = { id: 'ver_1', label: 'Rough cut 2', stage: 'rough_cut', mediaId: 'fm_1', sequenceId: null, streamUrl: '/api/media/p1/stream', noteCount: 0, openNotes: 0, createdAt: '2026-01-01' };
  beforeEach(() => {
    serve((a, i) => {
      if (a === 'version-list') return okR({ versions: [version] });
      if (a === 'media-list') return okR({ media: [{ id: 'fm_1', name: 'Export', kind: 'video', streamUrl: '/api/media/p1/stream' }] });
      if (a === 'sequence-list') return okR({ sequences: [] });
      if (a === 'party-list') return okR({ parties: [] });
      if (a === 'note-list') return okR({ notes: [] });
      if (a === 'note-add') return okR({ note: { id: 'n1' } });
      if (a === 'version-create') return okR({ version: { ...version, id: 'ver_2' } });
      if (a === 'party-join') return i.code === 'FILM-ABCD1234' ? okR({ party: { id: 'pty_1' } }) : errR('no party with that code');
      if (a === 'party-state') return okR({ party: { id: 'pty_1', title: 'Cast screening', code: 'FILM-ABCD1234', playing: false, positionSec: 0, participantCount: 2, isHost: false, streamUrl: '/api/media/p1/stream', releaseId: null } });
      if (a === 'party-chat-list') return okR({ messages: [] });
    });
  });
  it('makes a version from an uploaded export', async () => {
    render(<ScreeningRoom projectId="p1" />);
    await screen.findByText('Rough cut 2');
    fireEvent.click(screen.getByTestId('fo-version-create'));
    expect(await screen.findByText(/Name the version/)).toBeTruthy();
    expect(calls('version-create')).toHaveLength(0);
    fireEvent.change(screen.getByTestId('fo-version-label'), { target: { value: 'Fine cut' } });
    fireEvent.change(screen.getByTestId('fo-version-source'), { target: { value: 'm:fm_1' } });
    fireEvent.click(screen.getByTestId('fo-version-create'));
    await waitFor(() => expect(calls('version-create')).toHaveLength(1));
    expect(calls('version-create')[0]).toEqual({ projectId: 'p1', label: 'Fine cut', stage: 'rough_cut', mediaId: 'fm_1' });
  });
  it('pins a note at the frame the video is on', async () => {
    render(<ScreeningRoom projectId="p1" />);
    fireEvent.click(await screen.findByText('Rough cut 2'));
    const video = (await screen.findByTestId('fo-version-video')) as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 12.4, writable: true });
    fireEvent.change(screen.getByTestId('fo-note-body'), { target: { value: 'Trim the pause' } });
    fireEvent.click(screen.getByTestId('fo-note-add'));
    await waitFor(() => expect(calls('note-add')).toHaveLength(1));
    expect(calls('note-add')[0]).toEqual({ versionId: 'ver_1', body: 'Trim the pause', timecodeSec: 12.4 });
  });
  it('joins a screening by code and shows the refusal for a bad one', async () => {
    render(<ScreeningRoom projectId="p1" />);
    fireEvent.change(await screen.findByTestId('fo-join-code'), { target: { value: 'FILM-NOPE0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('no party with that code')).toBeTruthy();
    fireEvent.change(screen.getByTestId('fo-join-code'), { target: { value: 'FILM-ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByTestId('fo-party-room')).toBeTruthy();
  });
});

describe('party room', () => {
  const state = (o: Record<string, unknown>) => okR({ party: { id: 'pty_1', title: 'Screening', code: 'FILM-ABCD1234', playing: false, positionSec: 0, participantCount: 2, isHost: true, streamUrl: '/api/media/p1/stream', releaseId: null, ...o } });
  it('the host has controls and play is sent to the server', async () => {
    serve((a) => (a === 'party-state' ? state({}) : a === 'party-chat-list' ? okR({ messages: [] }) : undefined));
    render(<PartyRoom partyId="pty_1" onLeave={() => {}} />);
    const video = (await screen.findByTestId('fo-party-video')) as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(screen.getByTestId('fo-party-code').textContent).toContain('FILM-ABCD1234');
    fireEvent.play(video);
    await waitFor(() => expect(calls('party-sync')).toHaveLength(1));
    expect(calls('party-sync')[0]).toEqual(expect.objectContaining({ id: 'pty_1', playing: true }));
  });
  it('a guest has no controls, sends nothing, and follows the host', async () => {
    serve((a) => (a === 'party-state' ? state({ isHost: false, playing: true, positionSec: 30 }) : a === 'party-chat-list' ? okR({ messages: [{ id: 'm', author: 'ada', text: 'hi', atSec: 3 }] }) : undefined));
    render(<PartyRoom partyId="pty_1" onLeave={() => {}} />);
    const video = (await screen.findByTestId('fo-party-video')) as HTMLVideoElement;
    expect(video.controls).toBe(false);
    expect(screen.queryByTestId('fo-party-code')).toBeNull();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(await screen.findByText('ada')).toBeTruthy();
    fireEvent.pause(video);
    expect(calls('party-sync')).toHaveLength(0);
  });
});

describe('release desk', () => {
  beforeEach(() => {
    serve((a) => {
      if (a === 'film-release-list') return okR({ releases: [] });
      if (a === 'media-list') return okR({ media: [{ id: 'fm_1', name: 'Low Tide final', kind: 'video', platformMediaId: 'med_1', durationSec: 612, streamUrl: '/x' }] });
      if (a === 'film-release-create') return okR({ release: { id: 'rel_1', title: 'Low Tide' } });
    });
  });
  it('sends a real CC price and preview length', async () => {
    render(<ReleaseDesk projectId="p1" />);
    fireEvent.change(await screen.findByTestId('fo-release-media'), { target: { value: 'fm_1' } });
    fireEvent.change(screen.getByTestId('fo-release-title'), { target: { value: 'Low Tide' } });
    fireEvent.change(screen.getByTestId('fo-release-price'), { target: { value: '4.5' } });
    expect(screen.getByText(/about 4\.28 CC to you/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('fo-release-create'));
    await waitFor(() => expect(calls('film-release-create')).toHaveLength(1));
    expect(calls('film-release-create')[0]).toEqual(expect.objectContaining({ projectId: 'p1', mediaId: 'fm_1', title: 'Low Tide', priceCC: 4.5, previewSec: 90 }));
    expect(await screen.findByText(/is out at 4\.50 CC/)).toBeTruthy();
  });
  it('refuses a price under 0.5 CC without sending it, and free sends 0 with no preview', async () => {
    render(<ReleaseDesk projectId="p1" />);
    fireEvent.change(await screen.findByTestId('fo-release-media'), { target: { value: 'fm_1' } });
    fireEvent.change(screen.getByTestId('fo-release-price'), { target: { value: '0.2' } });
    fireEvent.click(screen.getByTestId('fo-release-create'));
    expect(await screen.findByText('A price is from 0.5 to 1000 CC.')).toBeTruthy();
    expect(calls('film-release-create')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    fireEvent.click(screen.getByTestId('fo-release-create'));
    await waitFor(() => expect(calls('film-release-create')).toHaveLength(1));
    const sent = calls('film-release-create')[0] as Record<string, unknown>;
    expect(sent.priceCC).toBe(0);
    expect(sent.previewSec).toBeUndefined();
  });
});

describe('cinema', () => {
  const film = (o: Record<string, unknown>) => ({ id: 'rel_1', title: 'Low Tide', logline: 'Two sisters and a boat.', runtimeSec: 612, priceCC: 3, previewSec: 60, poster: null, filmmaker: { name: 'maker', isMe: false }, status: 'published', publishedAt: '', owned: false, canWatchFull: false, streamUrl: '/api/media/med_1/stream', buyers: null, credits: { cast: [{ name: 'Ida Brook', role: 'Mara' }], crew: [] }, ...o });
  it('plays the preview, buys for real, then unlocks the full film', async () => {
    let owned = false;
    serve((a) => {
      if (a === 'film-release-list') return okR({ releases: [film({})] });
      if (a === 'film-release-get') return okR({ release: film(owned ? { owned: true, canWatchFull: true } : {}) });
      if (a === 'film-release-buy') { owned = true; return okR({}); }
    });
    render(<Cinema />);
    fireEvent.click(await screen.findByRole('button', { name: 'Low Tide, 3 CC' }));
    expect(await screen.findByText('Preview · first 60 s')).toBeTruthy();
    expect(screen.getByText('Ida Brook')).toBeTruthy();
    expect(screen.queryByTestId('fo-film-screen')).toBeNull();
    fireEvent.click(screen.getByTestId('fo-film-buy'));
    expect(await screen.findByText('Bought. It’s yours.')).toBeTruthy();
    expect(calls('film-release-buy')[0]).toEqual({ id: 'rel_1' });
    expect(screen.queryByText('Preview · first 60 s')).toBeNull();
    expect(screen.getByTestId('fo-film-screen')).toBeTruthy();
  });
  it('shows the real refusal when the wallet is short', async () => {
    serve((a) => {
      if (a === 'film-release-list') return okR({ releases: [film({})] });
      if (a === 'film-release-get') return okR({ release: film({}) });
      if (a === 'film-release-buy') return errR('not enough Concord Coin: this film is 3 CC and you have 2 CC');
    });
    render(<Cinema />);
    fireEvent.click(await screen.findByRole('button', { name: 'Low Tide, 3 CC' }));
    fireEvent.click(await screen.findByTestId('fo-film-buy'));
    expect(await screen.findByText(/you have 2 CC/)).toBeTruthy();
    expect(screen.getByText('Preview · first 60 s')).toBeTruthy();
  });
});
