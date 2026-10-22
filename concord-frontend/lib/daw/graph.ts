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
}

export function masteringEffects(project: DAWProject): EffectInstance[] {
  const m = project.masteringChain;
  if (!m || !m.enabled) return [];
  return [m.eq, m.multibandCompressor, m.stereoWidener, m.limiter].filter((e): e is EffectInstance => !!e && e.enabled !== false);
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
      ch.fader.gain.value = Number.isFinite(t.volume) ? dbToGain(Math.min(12, t.volume)) : 0;
      ch.pan.pan.value = Math.max(-1, Math.min(1, t.pan || 0));
      ch.mute.gain.value = isTrackAudible(t, project.tracks, this.opts.onlyTrackIds) ? 1 : 0;
    }
    for (const [id, ch] of this.channels) {
      if (live.has(id)) continue;
      try { ch.mute.disconnect(); ch.input.disconnect(); } catch { /* noop */ }
      ch.chain.dispose();
      this.channels.delete(id);
    }
    this.masterChain.set(project.masterBus?.inserts);
    this.masteringChain.set(this.opts.bypassMastering ? [] : masteringEffects(project));
    const mv = project.masterBus?.volume;
    this.masterFader.gain.value = Number.isFinite(mv) ? dbToGain(Math.min(12, mv as number)) : 1;
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
      const fadeIn = Math.min(dur / 2, Math.max(0.002, ((clip?.fadeIn || 0) * spbFade)));
      const fadeOut = Math.min(dur / 2, Math.max(0.002, ((clip?.fadeOut || 0) * spbFade)));
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(level, time + fadeIn);
      g.gain.setValueAtTime(level, time + dur - fadeOut);
      g.gain.linearRampToValueAtTime(0, time + dur);
      src.connect(g).connect(ch.input);
      src.start(time, ev.offsetSec, dur);
      const v: Voice = { stop: (at?: number) => { try { src.stop(Math.max(at ?? 0, (this.ctx as AudioContext).currentTime || 0)); } catch { /* noop */ } } };
      this.voices.add({ v, end: time + dur + 0.1 });
    }
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
