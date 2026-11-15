// FIX-studio-002 investigation pin: an imported clip's waveform peaks must
// survive the exact save -> load transform chain the editor uses
// (assetMeta at import -> snapshotForSave/toServerDaw at save -> JSON wire
// -> normalizeProject/fromServerRecord at load), and the clip's asset
// lookup (project.audioAssets[clip.audioBufferId], as ArrangeView does for
// WaveThumb) must resolve to an asset that still carries its peaks.
import { describe, it, expect } from 'vitest';
import { createProject, createTrack, assetMeta, computePeaks, normalizeProject, snapshotForSave } from '@/lib/daw/project';
import { toServerDaw } from '@/lib/daw/persistence';
import type { DAWClip } from '@/lib/daw/types';

describe('studio waveform peaks — save/load round-trip (FIX-studio-002)', () => {
  it('peaks computed at import survive snapshotForSave -> wire -> normalizeProject', () => {
    const channels = [new Float32Array([0, 0.5, -1, 0.25, 0, 0.75, -0.5, 0.1])];
    const meta = assetMeta('aud_1', 'tone.wav', channels, 48000);
    expect(meta.waveformPeaks.length).toBeGreaterThan(0);
    expect(computePeaks(channels).length).toBe(meta.waveformPeaks.length);

    const track = createTrack('audio', 0, { name: 'Tone' });
    const clip = {
      id: 'clip_1', trackId: track.id, type: 'audio', name: 'tone.wav',
      startBeat: 0, lengthBeats: 4, loopLength: 4, audioBufferId: 'aud_1',
      midiNotes: [], gain: 1,
    } as unknown as DAWClip;
    const project = {
      ...createProject('Peaks'),
      tracks: [{ ...track, clips: [clip] }],
      audioAssets: { aud_1: meta },
    };

    const wire = JSON.parse(JSON.stringify(toServerDaw(project)));
    const loaded = normalizeProject(wire, 'Peaks');

    const loadedClip = loaded.tracks[0].clips[0];
    const asset = loaded.audioAssets?.[loadedClip.audioBufferId || ''];
    expect(asset).toBeTruthy();
    expect(asset!.waveformPeaks).toEqual(meta.waveformPeaks);
    expect(loadedClip.audioBufferId).toBe('aud_1');
    // snapshotForSave alone (the journal path) keeps them too.
    expect(snapshotForSave(project).audioAssets?.aud_1.waveformPeaks).toEqual(meta.waveformPeaks);
  });
});
