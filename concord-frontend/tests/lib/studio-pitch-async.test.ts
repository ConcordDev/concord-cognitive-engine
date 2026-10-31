import { describe, it, expect } from 'vitest';
import { createAudioClip, createProject, createTrack, effect } from '@/lib/daw/project';
import {
  applyFormantShift,
  applyFormantShiftAsync,
  processPitchSignal,
  processPitchSignalAsync,
} from '@/lib/daw/dsp/pitch/core';
import { preparePitchExport, preparePitchExportAsync, settingsFromEffect } from '@/lib/daw/dsp/pitch/settings';

const SR = 48000;

function voiceish(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 880 * t);
  }
  return out;
}

describe('formant/pitch export runs cooperatively (no main-thread freeze)', () => {
  it('the async formant shift returns exactly the synchronous result', async () => {
    const x = voiceish(SR / 2);
    const sync = applyFormantShift(x, SR, 4);
    const async_ = await applyFormantShiftAsync(x, SR, 4, { budgetMs: 1 });
    expect(async_.length).toBe(sync.length);
    for (let i = 0; i < sync.length; i += 97) expect(async_[i]).toBe(sync[i]);
  });

  it('it hands the event loop back while working: a timer fires before the shift finishes', async () => {
    const x = voiceish(SR * 2);
    let timerRanBeforeDone = false;
    let done = false;
    const timer = new Promise<void>((resolve) => setTimeout(() => { timerRanBeforeDone = !done; resolve(); }, 0));
    const work = applyFormantShiftAsync(x, SR, 3, { budgetMs: 2 }).then((r) => { done = true; return r; });
    await timer;
    expect(timerRanBeforeDone).toBe(true);
    await work;
  });

  it('abort stops the work instead of finishing the whole buffer', async () => {
    const ctrl = new AbortController();
    const p = applyFormantShiftAsync(voiceish(SR * 2), SR, 3, { signal: ctrl.signal, budgetMs: 1 });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('processPitchSignalAsync matches processPitchSignal including the formant stage', async () => {
    const project = createProject('v', 120, 'C', 'major');
    const fx = effect('pitchCorrect', 'Pitch Correct', { retuneMs: 0, flexCents: 0, range: 1, useProject: 1, quality: 0, formant: 3 }, 1, 'pc');
    const settings = { ...settingsFromEffect(fx, project, SR), formantSemitones: 3 };
    const x = voiceish(SR / 4);
    const a = processPitchSignal(x, settings);
    const b = await processPitchSignalAsync(x, settings, { budgetMs: 1 });
    expect(b.latency).toBe(a.latency);
    expect(b.output.length).toBe(a.output.length);
    for (let i = 0; i < a.output.length; i += 53) expect(b.output[i]).toBe(a.output[i]);
  });

  it('preparePitchExportAsync produces the same project and buffers as the synchronous version', async () => {
    const project = createProject('v', 120, 'C', 'major');
    const track = createTrack('audio', 0);
    const clip = createAudioClip(track, 0, 1, 'take', 'vocal');
    const pc = effect('pitchCorrect', 'Pitch Correct', { retuneMs: 0, flexCents: 100, range: 1, useProject: 1, quality: 0 }, 1, 'pc1');
    track.clips = [clip];
    track.effectChain = [pc];
    project.tracks = [track];
    const audio = new Map([['take', { channels: [voiceish(SR / 4)], sampleRate: SR }]]);
    const a = preparePitchExport(project, audio);
    const b = await preparePitchExportAsync(project, audio, { budgetMs: 1 });
    const id = `take__pitch_${clip.id}`;
    expect(b.project.tracks[0].effectChain).toEqual(a.project.tracks[0].effectChain);
    expect(b.project.tracks[0].clips[0].audioBufferId).toBe(id);
    const ax = a.audio.get(id)!.channels[0];
    const bx = b.audio.get(id)!.channels[0];
    for (let i = 0; i < ax.length; i += 41) expect(bx[i]).toBe(ax[i]);
  });
});
