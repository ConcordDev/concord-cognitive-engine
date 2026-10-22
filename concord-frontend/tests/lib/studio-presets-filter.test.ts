import { describe, it, expect } from 'vitest';
import { dedupePresets, allSynthPresets, resolveTrackPreset, isDrumInstrument, instrumentOptions } from '@/lib/daw/presets';
import { DEFAULT_SYNTH_PRESETS } from '@/lib/daw/engine';
import { classifyMusicItem, isMusicItem } from '@/lib/daw/music-filter';

describe('preset dedupe (SynthPanel showed every factory preset twice)', () => {
  it('drops repeated ids, keeps first and order', () => {
    const out = dedupePresets([...DEFAULT_SYNTH_PRESETS, ...DEFAULT_SYNTH_PRESETS, null, undefined]);
    expect(out.map((p) => p.id)).toEqual(DEFAULT_SYNTH_PRESETS.map((p) => p.id));
  });
  it('project edits of a factory preset win over the factory copy', () => {
    const edited = { ...DEFAULT_SYNTH_PRESETS[0], name: 'My Sub' };
    const all = allSynthPresets({ [edited.id]: edited });
    expect(all.filter((p) => p.id === edited.id)).toHaveLength(1);
    expect(all.find((p) => p.id === edited.id)?.name).toBe('My Sub');
  });
  it('resolves per-track instruments, falling back safely', () => {
    expect(resolveTrackPreset('keys-ep').id).toBe('keys-ep');
    expect(resolveTrackPreset('nope').id).toBe(allSynthPresets(undefined)[0].id);
    expect(isDrumInstrument('drums:808')).toBe(true);
    expect(isDrumInstrument('sub-bass')).toBe(false);
    const ids = instrumentOptions().map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('music-only import filter', () => {
  it.each([
    [{ name: 'vocal take.wav' }, 'audio'],
    [{ name: 'drums_stem.flac' }, 'stem'],
    [{ name: 'Loop 90bpm.mp3', tags: ['loop'] }, 'loop'],
    [{ name: 'kick.aif', tags: ['sample'] }, 'sample'],
    [{ name: 'groove.mid' }, 'midi'],
    [{ name: 'x', mimeType: 'audio/x-midi' }, 'midi'],
    [{ name: 'Pad', kind: 'synth_preset' }, 'preset'],
    [{ title: 'Chord idea', kind: 'music_dtu' }, 'music-dtu'],
    [{ title: 'Beat sketch', domain: 'studio' }, 'music-dtu'],
  ])('accepts %o as %s', (c, kind) => {
    expect(classifyMusicItem(c)).toBe(kind);
  });
  it.each([
    [{ name: 'report.pdf' }],
    [{ name: 'photo.png', mimeType: 'image/png' }],
    [{ title: 'Quarterly plan', kind: 'document' }],
    [{ title: 'refactor notes', domain: 'code' }],
    [{ title: 'Meeting', domain: 'studio' }],
  ])('rejects %o', (c) => {
    expect(isMusicItem(c)).toBe(false);
  });
});
