import { describe, it, expect } from 'vitest';
import { createAudioClip, createProject, createTrack, effect } from '@/lib/daw/project';
import { compensateProcessorDelay } from '@/lib/daw/graph';
import { yinDetect } from '@/lib/daw/dsp/pitch/core';
import { preparePitchExport, settingsFromEffect } from '@/lib/daw/dsp/pitch/settings';

const SR = 48000;

function sine(hz: number, n: number): Float32Array {
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(phase);
    phase += (2 * Math.PI * hz) / SR;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;
  }
  return out;
}

describe('processor delay compensation', () => {
  it('starts the clip early and cuts what would fall before zero', () => {
    const early = compensateProcessorDelay(2, 0.1, 1, 4, 0.03, 0);
    expect(early).toEqual({ when: 1.97, offsetSec: 0.1, durationSec: 1 });
    const cut = compensateProcessorDelay(0.01, 0, 1, 4, 0.05, 0);
    expect(cut?.when).toBe(0);
    expect(cut?.offsetSec).toBeCloseTo(0.04);
    expect(cut?.durationSec).toBeCloseTo(0.96);
    expect(compensateProcessorDelay(0, 3.9, 0.2, 4, 0.5, 0)).toBeNull();
  });
});

describe('preparePitchExport', () => {
  it('writes a derived clip, leaves the source buffer, and strips every enabled Pitch Correct', () => {
    const project = createProject('v', 120, 'C', 'major');
    const track = createTrack('audio', 0);
    const clip = createAudioClip(track, 0, 4, 'take-a', 'vocal');
    const first = effect('pitchCorrect', 'Pitch Correct', { retuneMs: 0, flexCents: 200, range: 1, useProject: 1, quality: 0 }, 1, 'pc1');
    const second = effect('pitchCorrect', 'Pitch Correct', { retuneMs: 0, flexCents: 0, range: 1, useProject: 1, quality: 0 }, 1, 'pc2');
    const eq = effect('eq3', 'EQ', { lowGain: 0 }, 1, 'eq');
    track.clips = [clip];
    track.effectChain = [first, eq, second];
    project.tracks = [track];
    const src = sine(445, SR);
    const audio = new Map([['take-a', { channels: [src], sampleRate: SR }]]);
    const out = preparePitchExport(project, audio);
    expect(audio.get('take-a')?.channels[0]).toBe(src);
    expect(out.project.tracks[0].effectChain.map((e) => e.id)).toEqual(['eq']);
    const derived = out.audio.get(`take-a__pitch_${clip.id}`);
    expect(derived?.channels[0].length).toBe(src.length);
    expect(out.project.tracks[0].clips[0].audioBufferId).toBe(`take-a__pitch_${clip.id}`);
    const found = yinDetect(derived!.channels[0].subarray(SR / 2, SR / 2 + 8192), SR, 60, 1400);
    expect(Math.abs(1200 * Math.log2(found.hz / 440))).toBeLessThan(8);
  });

  it('returns the same objects when the song has no Pitch Correct', () => {
    const project = createProject();
    const audio = new Map<string, { channels: Float32Array[]; sampleRate: number }>();
    const out = preparePitchExport(project, audio);
    expect(out.project).toBe(project);
    expect(out.audio).toBe(audio);
  });

  it('uses the device key when the song key is off', () => {
    const fx = effect('pitchCorrect', 'Pitch Correct', { useProject: 0, keyName: 'A', scaleName: 'minor', range: 1 }, 1, 'pc');
    const s = settingsFromEffect(fx, { key: 'C', scale: 'major' }, SR);
    expect(s.scaleMask).toBe(settingsFromEffect(
      effect('pitchCorrect', 'x', { useProject: 1, range: 1 }, 1, 'q'),
      { key: 'A', scale: 'minor' },
      SR,
    ).scaleMask);
    expect(s.scaleMask).not.toBe(0xfff);
  });
});
