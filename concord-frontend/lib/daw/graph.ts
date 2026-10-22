/**
 * The project's audio graph, built identically for live playback
 * (AudioContext) and export (OfflineAudioContext):
 *
 *   instrument / audio clip → channel input → inserts → duck → fader → pan → mute ─┐
 *                                                                                  master inserts → mastering chain → master fader → out
 *
 * Every parameter is set from the project, never from wall-clock state, so the
 * offline render reproduces what the user heard (32-bit float end to end).
 */

import type { DAWProject, DAWTrack, EffectInstance } from './types';
import type { TimelineEvent } from './scheduler';
import { DeviceChain } from './dsp/devices';
import { playSynthNote, playDrum, playClick, type Voice } from './dsp/instruments';
import { isDrumInstrument, resolveTrackPreset } from './presets';
import { dbToGain } from './dsp/rng';
import { PITCH_RANGES, pitchLatencySec } from './dsp/pitch/core';
import { pitchNodeBound, pushPitchSettings } from './dsp/pitch/runtime';
import { settingsFromEffect } from './dsp/pitch/settings';
import { equalPowerGain } from './dsp/fades';

export interface ChannelNodes {
  input: GainNode;
  chain: DeviceChain;
  duck: GainNode;
  fader: GainNode;
  pan: StereoPannerNode;
  mute: GainNode;
  analyser?: AnalyserNode;
}

export interface GraphOptions {
  destination: AudioNode;
  /** Where metronome clicks go (live only; omit to drop clicks). */
  clickDestination?: AudioNode | null;
  /** Live meters. */
  analysers?: boolean;
  /** Ignore mastering chain (stems / "before" A/B). */
  bypassMastering?: boolean;
  /** Render only these tracks (stems). */
  onlyTrackIds?: string[] | null;
  /**
   * Live playback only. Start audio clips early by the Pitch Correct delay
   * when that worklet node is actually in the chain. Offline export bakes
   * the correction and must leave this off.
   */
  pitchCompensate?: boolean;
}

/**
 * Move a buffer start earlier by `leadSec` so a processor delay lands on
 * `time`. Time before `earliest` (context now, or 0) is cut from the buffer
 * instead of being scheduled in the past. Returns null when nothing remains.
 */
export function compensateProcessorDelay(
  time: number,
  offsetSec: number,
  durationSec: number,
  bufferDuration: number,
  leadSec: number,
  earliest: number,
): { when: number; offsetSec: number; durationSec: number } | null {
  let when = time - Math.max(0, leadSec);
  let offset = offsetSec;
  let dur = durationSec;
  const floor = Number.isFinite(earliest) ? Math.max(0, earliest) : 0;
  if (when < floor) {
    const cut = floor - when;
    offset += cut;
    dur -= cut;
    when = floor;
  }
  dur = Math.min(dur, Math.max(0, bufferDuration - offset));
  if (!(dur > 0) || !(offset < bufferDuration) || offset < 0) return null;
  return { when, offsetSec: offset, durationSec: dur };
}

export function masteringEffects(project: DAWProject): EffectInstance[] {
  const m = project.masteringChain;
  if (!m || !m.enabled) return [];
  return [m.eq, m.multibandCompressor, m.stereoWidener, m.limiter].filter((e): e is EffectInstance => !!e && e.enabled !== false);
}

function scheduleSpanGain(
  param: AudioParam,
  when: number,
  playDur: number,
  level: number,
  fadeIn: number,
  fadeOut: number,
  shape: 'linear' | 'equalPower',
): void {
  const ramp = (from: number, to: number, t0: number, t1: number, edge: 'in' | 'out') => {
    if (!(t1 > t0 + 1e-5)) {
      param.setValueAtTime(to, t0);
      return;
    }
    const steps = shape === 'equalPower' ? 8 : 1;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      let v: number;
      if (shape === 'equalPower' && edge === 'out') v = to + (from - to) * equalPowerGain('out', u);
      else if (shape === 'equalPower') v = from + (to - from) * equalPowerGain('in', u);
      else v = from + (to - from) * u;
      const t = t0 + (t1 - t0) * u;
      if (i === 0) param.setValueAtTime(v, t);
      else param.linearRampToValueAtTime(v, t);
    }
  };
  if (fadeIn <= 1e-4 && fadeOut <= 1e-4) {
    param.setValueAtTime(level, when);
    return;
  }
  ramp(0, level, when, when + Math.max(fadeIn, 1e-4), 'in');
  const hold = when + playDur - Math.max(fadeOut, 0);
  if (hold > when + fadeIn + 1e-4) param.setValueAtTime(level, hold);
  if (fadeOut > 1e-4) ramp(level, 0, when + playDur - fadeOut, when + playDur, 'out');
}

export function isTrackAudible(track: DAWTrack, tracks: DAWTrack[], only?: string[] | null): boolean {
  if (only && !only.includes(track.id)) return false;
  const anySolo = tracks.some((t) => t.solo);
  return !track.mute && (!anySolo || track.solo);
}

export class ProjectGraph {
  readonly ctx: BaseAudioContext;
  readonly masterIn: GainNode;
  readonly masterChain: DeviceChain;
  readonly masteringChain: DeviceChain;
  readonly masterFader: GainNode;
  readonly masterAnalyser: AnalyserNode | null;
  readonly channels = new Map<string, ChannelNodes>();
  private opts: GraphOptions;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<{ v: Voice; end: number }>();
  private project: DAWProject | null = null;
  /** Live input, pre-insert. Not used by the offline render. */
  private monitor: { node: AudioNode; trackId: string } | null = null;

  constructor(ctx: BaseAudioContext, opts: GraphOptions) {
    this.ctx = ctx;
    this.opts = opts;
    this.masterIn = ctx.createGain();
    this.masterChain = new DeviceChain(ctx);
    this.masteringChain = new DeviceChain(ctx);
    this.masterFader = ctx.createGain();
    this.masterIn.connect(this.masterChain.input);
    this.masterChain.output.connect(this.masteringChain.input);
    this.masteringChain.output.connect(this.masterFader);
    if (opts.analysers) {
      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 2048;
      this.masterFader.connect(this.masterAnalyser);
    } else {
      this.masterAnalyser = null;
    }
    this.masterFader.connect(opts.destination);
  }

  setBuffer(id: string, buf: AudioBuffer): void {
    this.buffers.set(id, buf);
  }

  hasBuffer(id: string): boolean {
    return this.buffers.has(id);
  }

  /** Bring the graph in line with the project (cheap when nothing changed). */
  sync(project: DAWProject): void {
    this.project = project;
    const live = new Set<string>();
    for (const t of project.tracks) {
      if (t.type === 'master') continue;
      live.add(t.id);
      let ch = this.channels.get(t.id);
      if (!ch) {
        const input = this.ctx.createGain();
        const chain = new DeviceChain(this.ctx);
        const duck = this.ctx.createGain();
        const fader = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();
        const mute = this.ctx.createGain();
        input.connect(chain.input);
        chain.output.connect(duck).connect(fader).connect(pan).connect(mute).connect(this.masterIn);
        let analyser: AnalyserNode | undefined;
        if (this.opts.analysers) {
          analyser = this.ctx.createAnalyser();
          analyser.fftSize = 1024;
          pan.connect(analyser);
        }
        ch = { input, chain, duck, fader, pan, mute, analyser };
        this.channels.set(t.id, ch);
      }
      ch.input.gain.value = dbToGain(Math.max(-48, Math.min(36, t.trimDb || 0)));
      ch.chain.set(t.effectChain);
      for (const fx of t.effectChain || []) {
        if (fx.type !== 'pitchCorrect' || fx.enabled === false || !pitchNodeBound(fx.id)) continue;
        pushPitchSettings(fx.id, settingsFromEffect(fx, project, this.ctx.sampleRate));
      }
      ch.fader.gain.value = Number.isFinite(t.volume) ? dbToGain(Math.min(12, t.volume)) : 0;
      ch.pan.pan.value = Math.max(-1, Math.min(1, t.pan || 0));
      ch.mute.gain.value = isTrackAudible(t, project.tracks, this.opts.onlyTrackIds) ? 1 : 0;
    }
    for (const [id, ch] of this.channels) {
      if (live.has(id)) continue;
      if (this.monitor?.trackId === id) this.detachMonitor();
      try { ch.mute.disconnect(); ch.input.disconnect(); } catch { /* noop */ }
      ch.chain.dispose();
      this.channels.delete(id);
    }
    this.masterChain.set(project.masterBus?.inserts);
    this.masteringChain.set(this.opts.bypassMastering ? [] : masteringEffects(project));
    const mv = project.masterBus?.volume;
    this.masterFader.gain.value = Number.isFinite(mv) ? dbToGain(Math.min(12, mv as number)) : 1;
  }

  /**
   * Connect a live input to one channel, before inserts. Pass null to detach.
   * Returns false when that track has no channel. Does not change the dry
   * recording tap. Offline renders never call this.
   */
  setMonitorSource(node: AudioNode | null, trackId: string | null): boolean {
    this.detachMonitor();
    if (!node || !trackId) return false;
    const ch = this.channels.get(trackId);
    if (!ch) return false;
    try {
      node.connect(ch.input);
    } catch {
      return false;
    }
    this.monitor = { node, trackId };
    return true;
  }

  private detachMonitor(): void {
    if (!this.monitor) return;
    const ch = this.channels.get(this.monitor.trackId);
    try {
      if (ch) this.monitor.node.disconnect(ch.input);
      else this.monitor.node.disconnect();
    } catch { /* already disconnected */ }
    this.monitor = null;
  }

  /** Queue one timeline event at context time `time`. */
  schedule(ev: TimelineEvent, time: number, secPerBeat: number): void {
    const project = this.project;
    if (!project) return;
    if (ev.kind === 'click') {
      if (this.opts.clickDestination) playClick(this.ctx, this.opts.clickDestination, time, ev.accent);
      return;
    }
    const track = project.tracks.find((t) => t.id === ev.trackId);
    const ch = track ? this.channels.get(track.id) : undefined;
    if (!track || !ch) return;
    if (ev.kind === 'note') {
      const dur = ev.durationSec ?? ev.lengthBeats * secPerBeat;
      // Clip gain: route the voice through its own gain stage.
      let dest: AudioNode = ch.input;
      if (ev.gainDb) {
        const g = this.ctx.createGain();
        g.gain.value = dbToGain(Math.max(-60, Math.min(24, ev.gainDb)));
        g.connect(ch.input);
        dest = g;
      }
      const v = isDrumInstrument(track.instrumentId)
        ? playDrum(this.ctx, dest, track.instrumentId as string, ev.pitch, ev.velocity, time)
        : playSynthNote(this.ctx, dest, resolveTrackPreset(track.instrumentId, project.synthPresets), ev.pitch, ev.velocity, time, dur);
      this.voices.add({ v, end: time + dur + 3 });
      this.applyDucking(track, ev.pitch, time);
      return;
    }
    if (ev.kind === 'audio') {
      const buf = this.buffers.get(ev.bufferId);
      if (!buf) return;
      const clip = track.clips.find((c) => c.id === ev.clipId);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      const level = dbToGain(ev.gainDb || 0);
      const spbFade = ev.rateSecPerBeat ?? secPerBeat;
      const rawDur = ev.durationSec ?? ev.lengthBeats * spbFade;
      const dur = Math.max(0, Math.min(rawDur, buf.duration - ev.offsetSec));
      if (dur <= 0) return;
      const placed = compensateProcessorDelay(time, ev.offsetSec, dur, buf.duration, this.pitchLeadSec(track), this.ctx.currentTime || 0);
      if (!placed) return;
      const when = placed.when;
      const playDur = placed.durationSec;
      const explicit = ev.fadeInSec != null || ev.fadeOutSec != null;
      const fadeIn = Math.min(playDur / 2, explicit ? Math.max(0, ev.fadeInSec || 0) : Math.max(0.002, (clip?.fadeIn || 0) * spbFade));
      const fadeOut = Math.min(playDur / 2, explicit ? Math.max(0, ev.fadeOutSec || 0) : Math.max(0.002, (clip?.fadeOut || 0) * spbFade));
      const shape = ev.fadeShape === 'equalPower' ? 'equalPower' : 'linear';
      scheduleSpanGain(g.gain, when, playDur, level, fadeIn, fadeOut, shape);
      src.connect(g).connect(ch.input);
      src.start(when, placed.offsetSec, playDur);
      const v: Voice = { stop: (at?: number) => { try { src.stop(Math.max(at ?? 0, (this.ctx as AudioContext).currentTime || 0)); } catch { /* noop */ } } };
      this.voices.add({ v, end: when + playDur + 0.1 });
    }
  }

  /** Sum of bound Pitch Correct delays on this track. Zero unless live compensation is on. */
  private pitchLeadSec(track: DAWTrack): number {
    if (!this.opts.pitchCompensate) return 0;
    let lead = 0;
    for (const fx of track.effectChain || []) {
      if (fx.type !== 'pitchCorrect' || fx.enabled === false || !pitchNodeBound(fx.id)) continue;
      const idx = Math.max(0, Math.min(PITCH_RANGES.length - 1, Math.round(Number(fx.params.range) || 1)));
      const mode = Number(fx.params.quality) ? 'quality' as const : 'low' as const;
      lead += pitchLatencySec(this.ctx.sampleRate || 48000, PITCH_RANGES[idx].minHz, mode);
    }
    return lead;
  }

  private applyDucking(source: DAWTrack, pitch: number, time: number): void {
    const project = this.project;
    if (!project) return;
    for (const t of project.tracks) {
      if (!t.duck || t.duck.sourceTrackId !== source.id) continue;
      if (t.duck.pitches && t.duck.pitches.length && !t.duck.pitches.includes(pitch)) continue;
      const ch = this.channels.get(t.id);
      if (!ch) continue;
      const depth = dbToGain(-Math.abs(t.duck.depthDb || 6));
      const rel = Math.max(0.02, (t.duck.releaseMs || 120) / 1000);
      const g = ch.duck.gain;
      g.setTargetAtTime(depth, time, 0.003);
      g.setTargetAtTime(1, time + 0.02, rel / 3);
    }
  }

  /** Stop every scheduled voice (transport stop / seek). */
  stopAll(at?: number): void {
    for (const x of this.voices) x.v.stop(at);
    this.voices.clear();
    for (const ch of this.channels.values()) {
      ch.duck.gain.cancelScheduledValues(0);
      ch.duck.gain.value = 1;
    }
  }

  /** Forget voices that have finished (keeps the set small during long sessions). */
  prune(now: number): void {
    for (const x of this.voices) if (x.end < now) this.voices.delete(x);
  }

  dispose(): void {
    this.detachMonitor();
    this.stopAll();
    for (const ch of this.channels.values()) {
      try { ch.mute.disconnect(); } catch { /* noop */ }
      ch.chain.dispose();
    }
    this.channels.clear();
    this.masterChain.dispose();
    this.masteringChain.dispose();
    try { this.masterFader.disconnect(); } catch { /* noop */ }
  }
}
