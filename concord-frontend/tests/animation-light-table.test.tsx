// The Light Table's own pieces: the X-sheet lays drawings over film frames
// by exposure and writes timing back to the server; export only offers what
// this browser can really encode; publishing sends real prices with a
// preview shorter than the piece; the screening wall gates a priced
// animation behind a real buy. The api client is mocked at the network edge.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { XSheet } from '@/components/animation/table/XSheet';
import { ExportDesk } from '@/components/animation/table/ExportDesk';
import { PublishDesk } from '@/components/animation/table/PublishDesk';
import { Screening } from '@/components/animation/table/Screening';
import { filmSequence, visibleStrokes } from '@/components/animation/table/draw';

const okR = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const errR = (error: string) => Promise.resolve({ data: { ok: false, error } });
const calls = (a: string) => lensRun.mock.calls.filter((c) => c[1] === a).map((c) => c[2]);
function serve(h: (a: string, i: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation((_d: string, a: string, i: Record<string, unknown>) => { const r = h(a, i || {}); return r === undefined ? okR({}) : r; });
}
const ANIM = { id: 'anm_1', title: 'Bounce', width: 320, height: 180, fps: 12, background: '#ffffff', frames: [
  { id: 'f1', exposure: 2, layers: [{ id: 'l1', name: 'L1', visible: true, opacity: 1, strokes: [{ tool: 'ink', color: '#000', size: 3, opacity: 1, points: [[1, 1], [4, 4]] }] }, { id: 'r1', name: 'ref', visible: true, opacity: 0.5, type: 'reference' as const, strokes: [{ tool: 'ink', color: '#000', size: 3, opacity: 1, points: [[0, 0]] }] }] },
  { id: 'f2', exposure: 1, layers: [] },
], audio: [] };

beforeEach(() => { lensRun.mockReset(); });

describe('drawing helpers', () => {
  it('expands exposures into film frames and never treats a reference layer as drawing', () => {
    expect(filmSequence(ANIM.frames)).toEqual([0, 0, 1]);
    expect(visibleStrokes(ANIM.frames[0])).toHaveLength(1);
  });
});

describe('the X-sheet', () => {
  beforeEach(() => serve((a) => {
    if (a === 'xsheet-get') return okR({ fps: 12, totalFrames: 3, durationSec: 0.25, drawings: [
      { frameId: 'f1', drawing: 1, startFrame: 1, endFrame: 2, exposure: 2, startSec: 0, action: 'anticipation', dialogue: '', camera: '' },
      { frameId: 'f2', drawing: 2, startFrame: 3, endFrame: 3, exposure: 1, startSec: 0.167, action: '', dialogue: 'MM', camera: '' },
    ] });
    if (a === 'audio-sync-map') return okR({ tracks: [{ id: 't', name: 'boing', startFrame: 0, endFrame: 3, waveform: [0.1, 0.9, 0.4] }] });
    if (a === 'xsheet-set') return okR({ sheet: { action: 'squash' } });
  }));

  it('one row per film frame, the drawing on its first frame and a hold line after', async () => {
    const { container } = render(<XSheet animId="anm_1" rev={0} playhead={null} openDrawing={0} onOpenDrawing={() => {}} onChanged={() => {}} />);
    await screen.findByText('3 fr · 12 fps · 0.25 s');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open drawing 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open drawing 2' })).toBeTruthy();
    expect(rows[1].querySelector('.lt-hold')).not.toBeNull();
    expect((screen.getByTestId('xs-action-1') as HTMLInputElement).value).toBe('anticipation');
    expect((screen.getByTestId('xs-dialogue-2') as HTMLInputElement).value).toBe('MM');
    // the sound column is the real waveform, one bar per frame under the track
    expect(container.querySelectorAll('tbody td:nth-child(2) span')).toHaveLength(3);
  });

  it('writes a note on blur and a hold change through the server', async () => {
    const onChanged = vi.fn();
    render(<XSheet animId="anm_1" rev={0} playhead={null} openDrawing={0} onOpenDrawing={() => {}} onChanged={onChanged} />);
    const cell = await screen.findByTestId('xs-action-1');
    fireEvent.change(cell, { target: { value: 'squash' } });
    fireEvent.blur(cell);
    await waitFor(() => expect(calls('xsheet-set')).toHaveLength(1));
    expect(calls('xsheet-set')[0]).toEqual({ animId: 'anm_1', frameId: 'f1', action: 'squash' });
    fireEvent.click(screen.getByTestId('xs-hold-plus-1'));
    await waitFor(() => expect(calls('frame-set-exposure')).toHaveLength(1));
    expect(calls('frame-set-exposure')[0]).toEqual({ animId: 'anm_1', frameId: 'f1', exposure: 3 });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('an unchanged note is not sent', async () => {
    render(<XSheet animId="anm_1" rev={0} playhead={null} openDrawing={0} onOpenDrawing={() => {}} onChanged={() => {}} />);
    const cell = await screen.findByTestId('xs-action-1');
    fireEvent.change(cell, { target: { value: 'anticipation' } });
    fireEvent.blur(cell);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('xsheet-set')).toHaveLength(0);
  });
});

describe('export', () => {
  it('offers only what this browser can encode (no WebCodecs here: video is unavailable, GIF and PNG are not)', async () => {
    render(<ExportDesk anim={ANIM as never} />);
    await waitFor(() => expect(screen.getByTestId('lt-format-webm')).toBeDisabled());
    expect(screen.getByTestId('lt-format-mp4')).toBeDisabled();
    expect(screen.getByTestId('lt-format-gif')).not.toBeDisabled();
    expect(screen.getByTestId('lt-format-png-zip')).not.toBeDisabled();
  });
});

describe('publishing', () => {
  beforeEach(() => serve((a) => {
    if (a === 'anim-release-list') return okR({ releases: [] });
    if (a === 'anim-release-create') return okR({ release: { id: 'rel_1', title: 'Bounce' } });
  }));

  it('can’t publish before a render exists', async () => {
    render(<PublishDesk anim={ANIM as never} mediaId={null} runtimeSec={null} openDrawing={0} />);
    expect(await screen.findByText(/Render it first/)).toBeTruthy();
    expect(screen.getByTestId('lt-publish-go')).toBeDisabled();
  });

  it('sends a real price with a preview shorter than the piece', async () => {
    render(<PublishDesk anim={ANIM as never} mediaId="med_9" runtimeSec={6} openDrawing={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sell it' }));
    const opts = Array.from((screen.getByTestId('lt-publish-preview') as HTMLSelectElement).options).map((o) => Number(o.value));
    expect(opts).toEqual([3, 5, 0]); // shorter than the 6 s piece, or none
    fireEvent.change(screen.getByTestId('lt-publish-price'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('lt-publish-preview'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('lt-publish-go'));
    await waitFor(() => expect(calls('anim-release-create')).toHaveLength(1));
    expect(calls('anim-release-create')[0]).toEqual(expect.objectContaining({ animId: 'anm_1', platformMediaId: 'med_9', priceCC: 2, previewSec: 5 }));
    expect(await screen.findByText(/is out at 2 CC/)).toBeTruthy();
  });

  it('refuses a price under 0.5 CC locally', async () => {
    render(<PublishDesk anim={ANIM as never} mediaId="med_9" runtimeSec={6} openDrawing={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sell it' }));
    fireEvent.change(screen.getByTestId('lt-publish-price'), { target: { value: '0.1' } });
    fireEvent.click(screen.getByTestId('lt-publish-go'));
    expect(await screen.findByText('A price is from 0.5 to 1000 CC.')).toBeTruthy();
    expect(calls('anim-release-create')).toHaveLength(0);
  });
});

describe('screening', () => {
  const rel = (o: Record<string, unknown>) => ({ id: 'rel_1', title: 'Paper Boat', logline: '', runtimeSec: 24, priceCC: 2, previewSec: 5, poster: null, animator: { name: 'ana', isMe: false }, status: 'published', publishedAt: '', owned: false, canWatchFull: false, streamUrl: '/api/media/m/stream', buyers: null, fps: 12, width: 320, height: 180, ...o });
  it('plays the preview, buys for real, then plays it all', async () => {
    let owned = false;
    serve((a) => {
      if (a === 'anim-release-list') return okR({ releases: [rel({})] });
      if (a === 'anim-release-get') return okR({ release: rel(owned ? { owned: true, canWatchFull: true } : {}) });
      if (a === 'anim-release-buy') { owned = true; return okR({}); }
    });
    render(<Screening />);
    fireEvent.click(await screen.findByRole('button', { name: 'Paper Boat, 2 CC' }));
    expect(await screen.findByText('You’re seeing the first 5 seconds.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lt-showing-buy'));
    expect(await screen.findByText('Bought. It’s yours.')).toBeTruthy();
    expect(calls('anim-release-buy')[0]).toEqual({ id: 'rel_1' });
    expect(screen.queryByText('You’re seeing the first 5 seconds.')).toBeNull();
  });
  it('shows the real refusal when the wallet is short', async () => {
    serve((a) => {
      if (a === 'anim-release-list') return okR({ releases: [rel({})] });
      if (a === 'anim-release-get') return okR({ release: rel({}) });
      if (a === 'anim-release-buy') return errR('not enough Concord Coin: this animation is 2 CC and you have 1 CC');
    });
    render(<Screening />);
    fireEvent.click(await screen.findByRole('button', { name: 'Paper Boat, 2 CC' }));
    fireEvent.click(await screen.findByTestId('lt-showing-buy'));
    expect(await screen.findByText(/you have 1 CC/)).toBeTruthy();
  });
});
