/**
 * workbench-render — Q31 unit tests for the real in-browser mixdown of
 * server-side Studio projects. The renderer runs against an injected
 * fake OfflineAudioContext (no real audio device), and the accounting
 * contract is what's pinned: renderable material renders, unrenderable
 * clips are reported with reasons, and an empty project yields NO audio
 * (the caller must never fabricate a placeholder).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWorkbenchProject, type WorkbenchClip, type WorkbenchNote, type WorkbenchProject } from '@/lib/daw/workbench-render';

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });

function makeFakeCtx() {
  const started = { osc: 0, sources: 0 };
  const ctx = {
    destination: {},
    sampleRate: 48000,
    started,
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    createStereoPanner: () => ({ pan: param(), connect: vi.fn() }),
    createOscillator: () => ({ type: '', frequency: param(), connect: vi.fn(), start: vi.fn(() => { started.osc++; }), stop: vi.fn() }),
    createBufferSource: () => ({ buffer: null, loop: false, connect: vi.fn(), start: vi.fn(() => { started.sources++; }), stop: vi.fn() }),
    createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBiquadFilter: () => ({ type: '', frequency: param(), connect: vi.fn() }),
    decodeAudioData: vi.fn(async () => ({ duration: 1.5, numberOfChannels: 2, getChannelData: () => new Float32Array(72000) })),
    startRendering: vi.fn(async () => ({ numberOfChannels: 2, getChannelData: () => new Float32Array(108000) })),
  };
  return ctx;
}

const TRACK = { id: 't1', name: 'Melody', kind: 'midi', volume: 0.8, pan: 0, muted: false, solo: false };
const project = (tracks: object[]): WorkbenchProject => ({ bpm: 120, tracks: tracks as WorkbenchProject['tracks'] });
const midiClip = (over: Partial<WorkbenchClip> = {}): WorkbenchClip => ({ id: 'c1', trackId: 't1', name: 'Notes', kind: 'midi', startBeats: 0, lengthBeats: 4, audioUrl: null, muted: false, ...over });
const audioClip = (over: Partial<WorkbenchClip> = {}): WorkbenchClip => ({ id: 'c2', trackId: 't1', name: 'Vox', kind: 'audio', startBeats: 0, lengthBeats: 4, audioUrl: 'https://x/vox.wav', muted: false, ...over });
const notes = (list: Partial<WorkbenchNote>[]): Map<string, WorkbenchNote[]> =>
  new Map([['c1', list.map((n) => ({ clipId: 'c1', pitch: 69, velocity: 96, startBeats: 0, lengthBeats: 1, ...n }) as WorkbenchNote)]]);

describe('renderWorkbenchProject', () => {
  it('voices a MIDI clip from its actual notes', async () => {
    const ctx = makeFakeCtx();
    const r = await renderWorkbenchProject(project([TRACK]), [midiClip()], notes([{}, {}]), { createContext: () => ctx as never });
    expect(r.pcm).not.toBeNull();
    expect(r.renderedClips).toBe(1);
    expect(r.skipped).toEqual([]);
    expect(ctx.started.osc).toBe(2);
    expect(r.durationSec).toBeCloseTo(2.25); // 4 beats @120bpm + tail
  });

  it('decodes and places an audio clip from its audioUrl', async () => {
    const ctx = makeFakeCtx();
    const fetchAudio = vi.fn(async () => new ArrayBuffer(8));
    const r = await renderWorkbenchProject(project([TRACK]), [audioClip()], new Map(), { createContext: () => ctx as never, fetchAudio });
    expect(fetchAudio).toHaveBeenCalledWith('https://x/vox.wav');
    expect(r.renderedClips).toBe(1);
    expect(ctx.started.sources).toBe(1);
  });

  it('accounts an audio clip with no source as skipped — and renders nothing if it is the only clip', async () => {
    const ctx = makeFakeCtx();
    const r = await renderWorkbenchProject(project([TRACK]), [audioClip({ audioUrl: null })], new Map(), { createContext: () => ctx as never });
    expect(r.pcm).toBeNull();
    expect(r.skipped).toEqual([{ clipName: 'Vox', reason: 'audio clip has no audio source' }]);
  });

  it('accounts a MIDI clip with no notes as skipped', async () => {
    const ctx = makeFakeCtx();
    const r = await renderWorkbenchProject(project([TRACK]), [midiClip()], new Map(), { createContext: () => ctx as never });
    expect(r.pcm).toBeNull();
    expect(r.skipped[0].reason).toMatch(/no notes/i);
  });

  it('accounts a failed audio fetch as skipped while other clips still render', async () => {
    const ctx = makeFakeCtx();
    const fetchAudio = vi.fn(async () => { throw new Error('HTTP 404'); });
    const r = await renderWorkbenchProject(
      project([TRACK]),
      [audioClip(), midiClip()],
      notes([{}]),
      { createContext: () => ctx as never, fetchAudio },
    );
    expect(r.pcm).not.toBeNull();
    expect(r.renderedClips).toBe(1);
    expect(r.skipped).toEqual([{ clipName: 'Vox', reason: 'audio could not be loaded or decoded' }]);
  });

  it('honors mute and solo: a muted track renders nothing; a solo isolates its track', async () => {
    const ctx1 = makeFakeCtx();
    const muted = await renderWorkbenchProject(project([{ ...TRACK, muted: true }]), [midiClip()], notes([{}]), { createContext: () => ctx1 as never });
    expect(muted.pcm).toBeNull();

    const t2 = { ...TRACK, id: 't2', name: 'Other' };
    const ctx2 = makeFakeCtx();
    const solo = await renderWorkbenchProject(
      project([{ ...TRACK, solo: true }, t2]),
      [midiClip(), midiClip({ id: 'c9', trackId: 't2', name: 'OtherClip' })],
      new Map([['c1', notes([{}]).get('c1')!], ['c9', [{ clipId: 'c9', pitch: 60, velocity: 96, startBeats: 0, lengthBeats: 1 }]]]),
      { createContext: () => ctx2 as never },
    );
    expect(solo.renderedClips).toBe(1);
    expect(ctx2.started.osc).toBe(1); // only the solo track's note was voiced
  });

  it('an empty project renders nothing and skips nothing', async () => {
    const ctx = makeFakeCtx();
    const r = await renderWorkbenchProject(project([TRACK]), [], new Map(), { createContext: () => ctx as never });
    expect(r.pcm).toBeNull();
    expect(r.renderedClips).toBe(0);
    expect(r.skipped).toEqual([]);
  });
});
