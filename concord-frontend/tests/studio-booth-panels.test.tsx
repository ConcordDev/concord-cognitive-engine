// The Booth's backend-wired panels against a mocked /api/lens/run: song
// sections (optimistic add, reconcile, rollback), saved chains (save the real
// chain, load with fresh ids), MIDI learn (learn a fader from a real CC
// message, then drive it), the room keys, and Tune vocal's honest refusals.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let handler: (action: string, input: Record<string, unknown>) => { data: { ok: boolean; result: unknown; error: string | null } };

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_d: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action, input });
    return handler(action, input);
  }),
}));
const toasts: Array<[string, string]> = [];
vi.mock('@/components/common/Toasts', () => ({ showToast: (kind: string, msg: string) => toasts.push([kind, msg]) }));
const seek = vi.fn();
vi.mock('@/lib/daw/playback-engine', () => ({ getStudioEngine: () => ({ getBeat: () => 17.5, seek }) }));
vi.mock('@/components/studio/daw/engine-hooks', () => ({ useBeatFrame: () => {} }));

import { SongSections } from '@/components/studio/booth/SongSections';
import { ChainShelf } from '@/components/studio/booth/ChainShelf';
import { MidiLearn } from '@/components/studio/booth/MidiLearn';
import { RoomSwitch } from '@/components/studio/booth/RoomSwitch';
import { TuneVocal } from '@/components/studio/booth/TuneVocal';
import { createProject, createTrack, effect } from '@/lib/daw/project';

const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
const no = (error: string) => ({ data: { ok: false, result: null, error } });

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  seek.mockClear();
});

describe('SongSections', () => {
  it('lists the song’s sections, jumps on tap, and adds one at the playhead bar', async () => {
    let n = 0;
    handler = (action, input) => {
      if (action === 'markers-list') return ok({ markers: [{ id: 'm1', projectId: 'p1', name: 'Verse', timeBeats: 8, colour: '#6fd36a', kind: 'section' }] });
      if (action === 'markers-add') return ok({ marker: { id: `m${++n + 1}`, projectId: 'p1', name: input.name, timeBeats: input.timeBeats, colour: input.colour, kind: 'section' } });
      return no('unexpected');
    };
    render(<SongSections projectId="p1" beatsPerBar={4} onLoop={() => {}} />);
    const verse = await screen.findByRole('button', { name: 'Jump to Verse, bar 3' });
    fireEvent.click(verse);
    expect(seek).toHaveBeenCalledWith(8);
    fireEvent.click(screen.getByTestId('booth-add-section-chorus'));
    // Playhead at beat 17.5 in 4/4 → bar start 16 (bar 5).
    await screen.findByRole('button', { name: 'Jump to Chorus, bar 5' });
    const add = calls.find((c) => c.action === 'markers-add')!;
    expect(add.input).toMatchObject({ projectId: 'p1', name: 'Chorus', timeBeats: 16, colour: '#ff8a3d', kind: 'section' });
  });

  it('rolls an add back with the server’s reason when it is refused', async () => {
    handler = (action) => (action === 'markers-list' ? ok({ markers: [] }) : no('a project holds at most 256 markers'));
    render(<SongSections projectId="p1" beatsPerBar={4} onLoop={() => {}} />);
    await screen.findByText(/Mark where the verse and chorus start/);
    fireEvent.click(screen.getByTestId('booth-add-section-bridge'));
    await waitFor(() => expect(toasts).toContainEqual(['error', 'a project holds at most 256 markers']));
    expect(screen.queryByRole('button', { name: /Jump to Bridge/ })).toBeNull();
  });

  it('loops a section to the next one, and an unsaved song makes no calls', async () => {
    handler = () => ok({ markers: [
      { id: 'a', projectId: 'p1', name: 'Verse', timeBeats: 0, colour: '#6fd36a', kind: 'section' },
      { id: 'b', projectId: 'p1', name: 'Chorus', timeBeats: 32, colour: '#ff8a3d', kind: 'section' },
    ] });
    const onLoop = vi.fn();
    const { unmount } = render(<SongSections projectId="p1" beatsPerBar={4} onLoop={onLoop} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Loop Verse' }));
    expect(onLoop).toHaveBeenCalledWith(0, 32);
    unmount();
    calls.length = 0;
    render(<SongSections projectId="local_abc" beatsPerBar={4} onLoop={onLoop} />);
    expect(screen.getByText(/Sections save with the song/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('ChainShelf', () => {
  it('saves the track’s real chain and loads a saved one with fresh ids', async () => {
    handler = (action, input) => {
      if (action === 'fx-rack-list') return ok({ racks: [{ id: 'r1', name: 'Vocal', units: [{ id: 'u', type: 'deesser', bypassed: false, wet: 0.8, params: { frequency: 6500 } }], createdAt: '' }] });
      if (action === 'fx-rack-save') return ok({ rack: { id: 'r2', name: input.name, units: (input.units as unknown[]).map((u, i) => ({ ...(u as object), id: `x${i}` })), createdAt: '' } });
      return no('?');
    };
    const track = createTrack('audio', 0, { name: 'Lead' });
    track.effectChain = [effect('compressor', 'Compressor', { ratio: 3 }, 1, 'c1')];
    const onEffects = vi.fn();
    render(<ChainShelf track={track} onEffects={onEffects} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load chain Vocal' }));
    const loaded = onEffects.mock.calls[0][0];
    expect(loaded.map((f: { type: string }) => f.type)).toEqual(['compressor', 'deesser']);
    expect(loaded[1].id).not.toBe('u');
    expect(loaded[1].wet).toBe(0.8);
    fireEvent.click(screen.getByTestId('booth-chain-save'));
    await screen.findByRole('button', { name: 'Load chain Lead chain' });
    expect(calls.find((c) => c.action === 'fx-rack-save')!.input).toEqual({
      name: 'Lead chain',
      units: [{ type: 'compressor', name: 'Compressor', bypassed: false, wet: 1, params: { ratio: 3 } }],
    });
  });
});

describe('MidiLearn', () => {
  it('learns a fader from the next CC message, then moves it from the controller', async () => {
    const input: { name: string; onmidimessage: ((e: { data: Uint8Array }) => void) | null } = { name: 'nanoKONTROL2', onmidimessage: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve({ inputs: new Map([['in1', input]]), onstatechange: null }),
    });
    handler = (action, i) => {
      if (action === 'midi-map-list') return ok({ maps: [] });
      if (action === 'midi-map-add') return ok({ map: { id: 'mm1', projectId: i.projectId, target: i.target, msgType: 'cc', controller: i.controller, channel: i.channel, rangeMin: i.rangeMin, rangeMax: i.rangeMax, deviceName: i.deviceName }, replaced: 0 });
      return no('?');
    };
    const p = createProject();
    p.id = 'p1';
    const vox = createTrack('audio', 0, { name: 'Vox' });
    p.tracks = [vox];
    const onTrack = vi.fn();
    render(<MidiLearn project={p} selectedTrackId={vox.id} onTrack={onTrack} onMasterVolume={() => {}} />);
    fireEvent.click(screen.getByTestId('booth-midi-enable'));
    await screen.findByText('nanoKONTROL2');
    fireEvent.click(screen.getByRole('button', { name: 'Learn Vox fader' }));
    await act(async () => { input.onmidimessage!({ data: new Uint8Array([0xb1, 7, 90]) }); });
    await screen.findByText('CC 7 · ch 2');
    expect(calls.find((c) => c.action === 'midi-map-add')!.input).toMatchObject({ projectId: 'p1', target: `track:${vox.id}:volume`, controller: 7, channel: 1, rangeMin: -60, rangeMax: 6, deviceName: 'nanoKONTROL2' });
    // Learning did not move the fader; the next message on that control does.
    expect(onTrack).not.toHaveBeenCalled();
    await act(async () => { input.onmidimessage!({ data: new Uint8Array([0xb1, 7, 127]) }); });
    expect(onTrack).toHaveBeenCalledWith(vox.id, { volume: 6 }, `midi-volume-${vox.id}`);
    // A different controller or channel moves nothing.
    onTrack.mockClear();
    await act(async () => { input.onmidimessage!({ data: new Uint8Array([0xb0, 7, 127]) }); });
    expect(onTrack).not.toHaveBeenCalled();
  });

  it('says so when the browser has no Web MIDI', async () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    handler = () => ok({ maps: [] });
    const p = createProject();
    p.id = 'p1';
    render(<MidiLearn project={p} selectedTrackId={null} onTrack={() => {}} onMasterVolume={() => {}} />);
    fireEvent.click(screen.getByTestId('booth-midi-enable'));
    expect(await screen.findByText(/This browser has no Web MIDI/)).toBeTruthy();
  });
});

describe('RoomSwitch', () => {
  it('shows three room keys with the selected one pressed', () => {
    const onRoom = vi.fn();
    render(<RoomSwitch room="produce" onRoom={onRoom} />);
    expect(screen.getByRole('tab', { name: /Produce/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Mix/ }));
    expect(onRoom).toHaveBeenCalledWith('mix');
  });
});

describe('TuneVocal', () => {
  it('refuses on an instrument track and on a vocal with nothing recorded, with a reason', () => {
    const p = createProject();
    const keys = createTrack('instrument', 0, { name: 'Keys' });
    const vox = createTrack('audio', 1, { name: 'Vox' });
    p.tracks = [keys, vox];
    const onProject = vi.fn();
    const { rerender } = render(<TuneVocal project={p} track={keys} getAudio={() => new Map()} onProject={onProject} />);
    expect(screen.getByText(/Tuning works on audio, not instruments/)).toBeTruthy();
    rerender(<TuneVocal project={p} track={vox} getAudio={() => new Map()} onProject={onProject} />);
    fireEvent.click(screen.getByTestId('booth-tune-natural'));
    expect(onProject).not.toHaveBeenCalled();
    expect(toasts).toContainEqual(['warning', 'Record or drop a vocal on this track first. There is nothing to tune yet.']);
  });
});
