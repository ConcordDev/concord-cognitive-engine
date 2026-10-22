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
import { playSynthNote, playDrum, playClick, midiToHz, type Voice } from './dsp/instruments';
import { isDrumInstrument, resolveTrackPreset } from './presets';
import { dbToGain } from './dsp/rng';
import { PITCH_RANGES, pitchLatencySec } from './dsp/pitch/core';
import { pitchNodeBound, pushPitchSettings } from './dsp/pitch/runtime';
import { settingsFromEffect } from './dsp/pitch/settings';
import { equalPowerGain } from './dsp/fades';
import { audibleIds, buildRoutePlan, type RouteTrack } from './routing';
import { gainPoints, valueAtBeat, type AutoPoint } from './automation';
import { LiveLoudness } from './dsp/live-loudness';
import { playSlice, sliceForNote } from './sampler';
import { dispatchControl } from './beat-tools';

export interface ChannelNodes {
  input: GainNode;
  chain: DeviceChain;
  duck: GainNode;
  fader: GainNode;
  /** Present only while this track is a VCA member. Unity otherwise and unwired. */
  vca: GainNode;
  pan: StereoPannerNode;
  mute: GainNode;
  directDelay: DelayNode;
  keyDelay: DelayNode;
  keyTap: GainNode;
  analyser?: AnalyserNode;
  analyserL?: AnalyserNode;
  analyserR?: AnalyserNode;
  sends: Array<{ busId: string; pre: boolean; gain: GainNode; delay: DelayNode | null }>;
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
  return audibleIds(tracks).has(track.id);
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
  private voices = new Set<{ v: Voice; end: number; trackId?: string }>();
  private liveVoices = new Map<string, Set<Voice>>();
  /** Previous synth pitch, so glide can start from a note that is still sounding. */
  private heldNote = new Map<string, { hz: number; until: number }>();
  private project: DAWProject | null = null;
  private topology = '';
  readonly loudness = new LiveLoudness();
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
    const live = ctx as AudioContext;
    if (opts.analysers && typeof live.createScriptProcessor === 'function') {
      const proc = live.createScriptProcessor(2048, 2, 2);
      const silent = live.createGain();
      silent.gain.value = 0;
      this.masterFader.connect(proc);
      proc.connect(silent).connect(opts.destination);
      proc.onaudioprocess = (ev) => {
        this.loudness.push(ev.inputBuffer.getChannelData(0), ev.inputBuffer.getChannelData(1), live.sampleRate);
      };
    }
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
        chain.output.connect(duck).connect(fader).connect(pan).connect(mute);
        const vca = this.ctx.createGain();
        vca.gain.value = 1;
        const directDelay = this.ctx.createDelay(1);
        const keyDelay = this.ctx.createDelay(1);
        const keyTap = this.ctx.createGain();
        let analyser: AnalyserNode | undefined;
        let analyserL: AnalyserNode | undefined;
        let analyserR: AnalyserNode | undefined;
        if (this.opts.analysers) {
          analyser = this.ctx.createAnalyser();
          analyser.fftSize = 1024;
          pan.connect(analyser);
          const split = this.ctx.createChannelSplitter(2);
          analyserL = this.ctx.createAnalyser();
          analyserR = this.ctx.createAnalyser();
          analyserL.fftSize = 1024;
          analyserR.fftSize = 1024;
          pan.connect(split);
          split.connect(analyserL, 0);
          split.connect(analyserR, 1);
        }
        ch = { input, chain, duck, fader, vca, pan, mute, directDelay, keyDelay, keyTap, analyser, analyserL, analyserR, sends: [] };
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
      try { ch.mute.disconnect(); ch.input.disconnect(); ch.fader.disconnect(); } catch { /* noop */ }
      ch.sends.forEach((s) => { try { s.gain.disconnect(); } catch { /* noop */ } });
      ch.chain.dispose();
      this.channels.delete(id);
    }
    this.rewire(project);
    this.masterChain.set(project.masterBus?.inserts);
    this.masteringChain.set(this.opts.bypassMastering ? [] : masteringEffects(project));
    const mv = project.masterBus?.volume;
    this.masterFader.gain.value = Number.isFinite(mv) ? dbToGain(Math.min(12, mv as number)) : 1;
  }

  /** Connect outputs, sends, and sidechain keys. A zero delay is a direct wire. */
  private rewire(project: DAWProject): void {
    const sr = this.ctx.sampleRate || 48000;
    const rows: RouteTrack[] = project.tracks.map((t) => {
      const ch = this.channels.get(t.id);
      const advance = Math.round(this.pitchLeadSec(t) * sr);
      const net = Math.max(0, (ch?.chain.latencySamples() || 0) - advance);
      return {
        id: t.id, type: t.type, mute: t.mute, solo: t.solo, vca: t.vca, outputTarget: t.outputTarget,
        sendLevels: t.sendLevels, sendPre: t.sendPre, effectLatency: net,
      };
    });
    const plan = buildRoutePlan(rows);
    const links: Array<{ trackId: string; effectId: string; sourceId: string }> = [];
    for (const t of project.tracks) {
      for (const fx of t.effectChain || []) {
        const source = fx.params?.sidechain;
        if (typeof source === 'string' && source) links.push({ trackId: t.id, effectId: fx.id, sourceId: source });
      }
    }
    const vcaGain = new Map<string, number>();
    for (const t of project.tracks) {
      if (!t.vcaId) continue;
      const group = project.tracks.find((g) => g.id === t.vcaId && g.vca);
      let gain = 1;
      if (group) gain = Number.isFinite(group.volume) ? dbToGain(Math.min(12, group.volume)) : 0;
      vcaGain.set(t.id, gain);
    }
    const topo = JSON.stringify({ direct: plan.direct, sends: plan.sends, links, vca: [...vcaGain.keys()] });
    if (topo !== this.topology) {
      this.topology = topo;
      for (const [id, ch] of this.channels) {
        try { ch.mute.disconnect(); ch.fader.disconnect(); ch.keyTap.disconnect(); } catch { /* noop */ }
        ch.sends.forEach((s) => { try { s.gain.disconnect(); s.delay?.disconnect(); } catch { /* noop */ } });
        ch.sends = [];
        const direct = plan.direct[id];
        if (vcaGain.has(id)) {
          ch.vca.gain.value = vcaGain.get(id) || 1;
          ch.fader.connect(ch.vca).connect(ch.pan);
        } else {
          ch.fader.connect(ch.pan);
        }
        if (!direct || project.tracks.find((t) => t.id === id)?.vca) continue;
        const dest = direct.destId === 'master' ? this.masterIn : this.channels.get(direct.destId)?.input;
        if (!dest) continue;
        this.connectDelayed(ch.mute, dest, ch.directDelay, direct.delaySamples / sr);
        for (const send of plan.sends[id] || []) {
          const bus = this.channels.get(send.busId);
          if (!bus) continue;
          const gain = this.ctx.createGain();
          const delay = send.delaySamples > 0 ? this.ctx.createDelay(1) : null;
          const tap = send.pre ? ch.duck : ch.mute;
          if (delay) {
            delay.delayTime.value = Math.min(1, send.delaySamples / sr);
            tap.connect(gain).connect(delay).connect(bus.input);
          } else tap.connect(gain).connect(bus.input);
          ch.sends.push({ busId: send.busId, pre: send.pre, gain, delay });
        }
        if (links.some((l) => l.sourceId === id)) {
          this.connectDelayed(ch.mute, ch.keyTap, ch.keyDelay, (plan.keyDelay[id] || 0) / sr);
        }
      }
    }
    for (const ch of this.channels.values()) {
      try { ch.keyTap.disconnect(); } catch { /* no key listeners */ }
    }
    for (const link of links) {
      const src = this.channels.get(link.sourceId);
      const key = this.channels.get(link.trackId)?.chain.keyInput(link.effectId);
      if (src && key) try { src.keyTap.connect(key); } catch { /* node already torn down */ }
    }
    for (const [id, gain] of vcaGain) {
      const ch = this.channels.get(id);
      if (ch) ch.vca.gain.value = gain;
    }
    for (const [id, ch] of this.channels) {
      const track = project.tracks.find((t) => t.id === id);
      const open = track ? audibleIds(project.tracks).has(id) : true;
      for (const send of ch.sends) {
        const level = track?.sendLevels?.[send.busId];
        send.gain.gain.value = open && Number.isFinite(level) ? dbToGain(level as number) : 0;
      }
      const delaySec = (plan.direct[id]?.delaySamples || 0) / sr;
      if (ch.directDelay) ch.directDelay.delayTime.value = Math.min(1, delaySec);
    }
  }

  private connectDelayed(from: AudioNode, to: AudioNode, delay: DelayNode, seconds: number): void {
    if (seconds > 0.00005) {
      delay.delayTime.value = Math.min(1, seconds);
      from.connect(delay).connect(to);
    } else from.connect(to);
  }

  /**
   * Schedule volume (dB → linear gain), pan, and send levels for this window.
   * Off mode leaves the static fader alone. Touch, latch, and write are not
   * offered: only lanes that already exist are read.
   */
  applyAutomation(project: DAWProject | null, fromBeat: number, toBeat: number, timeAt: (beat: number) => number): void {
    if (!project || project.transport?.automation === 'off' || !(toBeat > fromBeat)) return;
    const now = (this.ctx as AudioContext).currentTime || 0;
    for (const t of project.tracks) {
      const ch = this.channels.get(t.id);
      if (!ch) continue;
      for (const lane of t.automationLanes || []) {
        if (!lane.points?.length) continue;
        const points = lane.points as AutoPoint[];
        if (lane.parameterPath === 'volume') {
          const samples = gainPoints(points, fromBeat, toBeat, dbToGain);
          this.rampParam(ch.fader.gain, samples, timeAt, now);
        } else if (lane.parameterPath === 'pan') {
          const samples = gainPoints(points, fromBeat, toBeat, (v) => Math.max(-1, Math.min(1, v)), 0.0625).map((s) => ({ beat: s.beat, gain: valueAtBeat(points, s.beat) }));
          this.rampParam(ch.pan.pan, samples, timeAt, now);
        } else if (lane.parameterPath.startsWith('send:')) {
          const busId = lane.parameterPath.slice(5);
          const send = ch.sends.find((s) => s.busId === busId);
          if (!send) continue;
          this.rampParam(send.gain.gain, gainPoints(points, fromBeat, toBeat, dbToGain), timeAt, now);
        }
      }
    }
  }

  private rampParam(param: AudioParam, samples: Array<{ beat: number; gain: number }>, timeAt: (beat: number) => number, now: number): void {
    if (!samples.length) return;
    const start = Math.max(now, timeAt(samples[0].beat));
    param.cancelScheduledValues(start);
    param.setValueAtTime(samples[0].gain, start);
    for (let i = 1; i < samples.length; i++) {
      const t = timeAt(samples[i].beat);
      if (t > start) param.linearRampToValueAtTime(samples[i].gain, t);
    }
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
    if (ev.kind === 'cc' || ev.kind === 'pitchBend') {
      const live = this.liveVoices.get(ev.trackId);
      if (live && live.size) dispatchControl([...live], ev, time);
      return;
    }
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
      const v = this.startNote(track, dest, ev.pitch, ev.velocity, time, dur, project);
      if (v) {
        this.voices.add({ v, end: time + dur + 3, trackId: track.id });
        let live = this.liveVoices.get(track.id);
        if (!live) {
          live = new Set();
          this.liveVoices.set(track.id, live);
        }
        live.add(v);
      }
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

  /** Sampler uses the first audio clip on the track. Kits and synths ignore it. */
  private sampleBuffer(track: DAWTrack): AudioBuffer | null {
    for (const clip of track.clips) {
      const buf = clip.audioBufferId ? this.buffers.get(clip.audioBufferId) : undefined;
      if (buf) return buf;
    }
    return null;
  }

  /**
   * Retriggered portamento: a new synth voice still runs its own envelope, and
   * bends from the previous pitch only while that note is still sounding.
   * The 808 kit's kick drop stays inside playDrum. Sampler slices do not glide.
   */
  private startNote(track: DAWTrack, dest: AudioNode, pitch: number, velocity: number, time: number, dur: number, project: DAWProject): Voice | null {
    if (track.instrumentId === 'drums:sampler') {
      const slice = sliceForNote(track.slices, pitch);
      const buf = this.sampleBuffer(track);
      return slice && buf ? playSlice(this.ctx, dest, buf, slice, velocity, time) : null;
    }
    if (isDrumInstrument(track.instrumentId)) return playDrum(this.ctx, dest, track.instrumentId as string, pitch, velocity, time);
    const prev = this.heldNote.get(track.id);
    const from = prev && time <= prev.until + 0.02 ? prev.hz : undefined;
    this.heldNote.set(track.id, { hz: midiToHz(pitch), until: time + dur });
    return playSynthNote(this.ctx, dest, resolveTrackPreset(track.instrumentId, project.synthPresets), pitch, velocity, time, dur, from);
  }

  /** Stop every scheduled voice (transport stop / seek). */
  stopAll(at?: number): void {
    for (const x of this.voices) x.v.stop(at);
    this.voices.clear();
    this.liveVoices.clear();
    this.heldNote.clear();
    for (const ch of this.channels.values()) {
      ch.duck.gain.cancelScheduledValues(0);
      ch.duck.gain.value = 1;
    }
  }

  /** Forget voices that have finished (keeps the set small during long sessions). */
  prune(now: number): void {
    for (const x of this.voices) if (x.end < now) {
      this.voices.delete(x);
      if (x.trackId) this.liveVoices.get(x.trackId)?.delete(x.v);
    }
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
