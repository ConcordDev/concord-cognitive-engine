/**
 * Live playback engine for Concord Studio.
 *
 * One AudioContext, one ProjectGraph, one LookaheadScheduler. React never
 * re-renders on the audio clock: the UI reads `getBeat()` from a
 * requestAnimationFrame loop (see components/studio/daw/Playhead).
 */

import type { DAWProject } from './types';
import { getAudioContext } from './engine';
import { ProjectGraph } from './graph';
import { LookaheadScheduler, nextBarBeat, type CollectSource, type LaunchedClip } from './scheduler';
import { beatsPerBar, projectTempoPoints, secondsBetween } from './tempo-map';
import { playSynthNote, playDrum } from './dsp/instruments';
import { isDrumInstrument, resolveTrackPreset } from './presets';
import type { PcmAudio } from './render';
import { bakePitchEdits } from './dsp/pitch/editor';
import { bakeClipPlayback } from './clip-edit';
import { correlation } from './dsp/live-loudness';

export type TransportState = 'stopped' | 'playing' | 'counting-in';
type Listener = () => void;

const PEAK_BUF = new Float32Array(1024);

function peakDb(an: AnalyserNode | null | undefined): number {
  if (!an) return -120;
  const buf = PEAK_BUF.length >= an.fftSize ? PEAK_BUF.subarray(0, an.fftSize) : new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let m = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
  return m > 1e-6 ? 20 * Math.log10(m) : -120;
}

export class StudioEngine {
  readonly ctx: AudioContext;
  readonly graph: ProjectGraph;
  private scheduler: LookaheadScheduler;
  private project: DAWProject | null = null;
  private mode: 'arrange' | 'session' = 'arrange';
  private launched: Record<string, LaunchedClip | undefined> = {};
  private state: TransportState = 'stopped';
  private startBeat = 0;
  private countInBeats = 0;
  private metronome = false;
  private noLoop = false;
  private audition: { trackId: string; takeId: string } | null = null;
  private clipBuffers: Record<string, string> = {};
  private bakingPitch = false;
  private listeners = new Set<Listener>();
  private loaded = new Map<string, PcmAudio>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: AudioContext = getAudioContext()) {
    this.ctx = ctx;
    this.graph = new ProjectGraph(ctx, { destination: ctx.destination, clickDestination: ctx.destination, analysers: true, pitchCompensate: true });
    this.scheduler = new LookaheadScheduler({
      getSource: () => this.source(),
      onEvent: (ev, time, spb) => {
        if (ev.kind !== 'click' && ev.beat >= 0 && this.state === 'counting-in') { this.state = 'playing'; this.emit(); }
        this.graph.schedule(ev, time, spb);
      },
      onWindow: (from, to, timeAt) => this.graph.applyAutomation(this.project, from, to, timeAt),
      clock: {
        now: () => this.ctx.currentTime,
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
      },
      loop: () => {
        const t = this.project?.transport;
        return { enabled: this.mode === 'arrange' && !this.noLoop && !!t?.loopEnabled, start: t?.loopStart ?? 0, end: t?.loopEnd ?? 0 };
      },
    });
  }

  private source(): CollectSource {
    const p = this.project;
    return {
      tracks: p?.tracks || [],
      beatsPerBar: beatsPerBar(p?.timeSignature),
      bpm: p?.bpm || 120,
      tempo: p ? projectTempoPoints(p) : undefined,
      metronome: this.metronome,
      mode: this.mode,
      launched: this.launched,
      audition: this.audition,
      bufferOverrides: this.clipBuffers,
    };
  }

  getAudition(): { trackId: string; takeId: string } | null {
    return this.audition;
  }

  /** Audition one take. Pass null to hear the comp again. Restarts playback when running. */
  setAudition(next: { trackId: string; takeId: string } | null): void {
    this.audition = next;
    if (this.state !== 'stopped') this.seek(this.getBeat());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() { this.listeners.forEach((l) => l()); }

  get transportState(): TransportState { return this.state; }
  get isPlaying(): boolean { return this.state !== 'stopped'; }
  get launchedClips(): Readonly<Record<string, LaunchedClip | undefined>> { return this.launched; }

  setProject(p: DAWProject): void {
    this.project = p;
    this.graph.sync(p);
    this.refreshPitchEdits();
  }

  setMetronome(on: boolean): void { this.metronome = on; }

  setMode(mode: 'arrange' | 'session'): void {
    if (mode === this.mode) return;
    this.stop();
    this.mode = mode;
  }

  /** Make decoded audio available to the graph (recorded takes, imports, server files). */
  setAudio(id: string, a: PcmAudio): void {
    this.loaded.set(id, a);
    const buf = this.ctx.createBuffer(a.channels.length, a.channels[0].length, a.sampleRate);
    a.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    this.graph.setBuffer(id, buf);
    if (!this.bakingPitch) this.refreshPitchEdits();
  }

  /** Rebuild derived Pitch Editor buffers when edits or source audio change. */
  private refreshPitchEdits(): void {
    const project = this.project;
    if (!project || this.bakingPitch) return;
    const baked = bakePitchEdits(project, this.loaded);
    const withEdits = new Map(this.loaded);
    for (const [id, pcm] of baked.produced) withEdits.set(id, pcm);
    const played = bakeClipPlayback(project, withEdits, baked.overrides);
    const prev = JSON.stringify(this.clipBuffers);
    this.bakingPitch = true;
    try {
      for (const [id, pcm] of baked.produced) this.setAudio(id, pcm);
      for (const [id, pcm] of played.produced) this.setAudio(id, pcm);
    } finally {
      this.bakingPitch = false;
    }
    this.clipBuffers = played.overrides;
    if (JSON.stringify(this.clipBuffers) !== prev && this.state !== 'stopped') this.seek(this.getBeat());
  }
  hasAudio(id: string): boolean { return this.loaded.has(id); }
  audioMap(): Map<string, PcmAudio> { return this.loaded; }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* user gesture required */ }
    }
  }

  /** Start from `fromBeat`; `countInBars` > 0 plays clicks first (recording). */
  async play(fromBeat = 0, opts: { countInBars?: number; noLoop?: boolean } = {}): Promise<number> {
    await this.resume();
    this.noLoop = !!opts.noLoop;
    this.stopVoices();
    const bpb = beatsPerBar(this.project?.timeSignature);
    this.countInBeats = Math.max(0, Math.round((opts.countInBars || 0) * bpb));
    this.startBeat = fromBeat;
    this.state = this.countInBeats > 0 ? 'counting-in' : 'playing';
    const startTime = this.ctx.currentTime + 0.06;
    this.scheduler.start(fromBeat - this.countInBeats, startTime);
    if (!this.pruneTimer) this.pruneTimer = setInterval(() => this.graph.prune(this.ctx.currentTime), 2000);
    this.emit();
    // Context time at which `fromBeat` is heard (recording alignment).
    // Count-in uses the tempo at the downbeat, including a ramp that starts there.
    const map = projectTempoPoints(this.project || { bpm: 120 });
    return startTime + secondsBetween(map, fromBeat - this.countInBeats, fromBeat);
  }

  stop(): void {
    this.scheduler.stop();
    this.stopVoices();
    this.graph.loudness.reset();
    this.launched = {};
    this.state = 'stopped';
    if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
    this.emit();
  }

  private stopVoices() {
    this.graph.stopAll(this.ctx.currentTime);
  }

  /** Move the playhead; restarts playback from there when running. */
  seek(beat: number): void {
    const b = Math.max(0, beat);
    if (this.state === 'stopped') { this.startBeat = b; this.emit(); return; }
    void this.play(b);
  }

  /** Beat at the playhead (accounts for output latency so the line matches what you hear). */
  getBeat(): number {
    if (this.state === 'stopped') return this.startBeat;
    const lat = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0;
    return this.scheduler.beatAt(this.ctx.currentTime - lat);
  }

  /** Context time at which `beat` plays in the current pass. */
  timeAtBeat(beat: number): number { return this.scheduler.timeAtBeat(beat); }

  // ── Session ──
  async launchClip(trackId: string, clipId: string): Promise<void> {
    if (this.mode !== 'session') this.mode = 'session';
    const bpb = beatsPerBar(this.project?.timeSignature);
    if (this.state === 'stopped') {
      this.launched = { [trackId]: { clipId, launchBeat: 0 } };
      await this.play(0);
    } else {
      this.launched = { ...this.launched, [trackId]: { clipId, launchBeat: nextBarBeat(this.getBeat(), bpb) } };
    }
    this.emit();
  }

  async launchScene(clipsByTrack: Record<string, string>): Promise<void> {
    const bpb = beatsPerBar(this.project?.timeSignature);
    const at = this.state === 'stopped' ? 0 : nextBarBeat(this.getBeat(), bpb);
    const next: Record<string, LaunchedClip | undefined> = {};
    for (const [t, c] of Object.entries(clipsByTrack)) next[t] = { clipId: c, launchBeat: at };
    this.launched = next;
    this.mode = 'session';
    if (this.state === 'stopped') await this.play(0);
    this.emit();
  }

  stopTrackClip(trackId: string): void {
    const next = { ...this.launched };
    delete next[trackId];
    this.launched = next;
    this.emit();
  }

  // ── Audition (piano roll / pads / MIDI keyboard) ──
  previewNote(trackId: string, pitch: number, velocity = 100, durSec = 0.4): void {
    const p = this.project;
    const t = p?.tracks.find((x) => x.id === trackId);
    const ch = t ? this.graph.channels.get(t.id) : undefined;
    if (!p || !t || !ch) return;
    void this.resume();
    const now = this.ctx.currentTime + 0.005;
    if (isDrumInstrument(t.instrumentId)) playDrum(this.ctx, ch.input, t.instrumentId as string, pitch, velocity, now);
    else playSynthNote(this.ctx, ch.input, resolveTrackPreset(t.instrumentId, p.synthPresets), pitch, velocity, now, durSec);
  }

  // ── Meters ──
  trackPeakDb(trackId: string): number { return peakDb(this.graph.channels.get(trackId)?.analyser); }
  masterPeakDb(): number { return peakDb(this.graph.masterAnalyser); }

  /** Peak, RMS, and correlation from the stereo tap. Correlation is 0 until the tap exists. */
  trackMeter(trackId: string): { peak: number; rms: number; correlation: number } {
    const ch = this.graph.channels.get(trackId);
    const left = new Float32Array(1024);
    const right = new Float32Array(1024);
    if (ch?.analyserL && ch.analyserR) {
      ch.analyserL.getFloatTimeDomainData(left as Float32Array<ArrayBuffer>);
      ch.analyserR.getFloatTimeDomainData(right as Float32Array<ArrayBuffer>);
    }
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < left.length; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      sum += left[i] * left[i] + right[i] * right[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, left.length * 2));
    return {
      peak: peak > 1e-6 ? 20 * Math.log10(peak) : -120,
      rms: rms > 1e-8 ? 20 * Math.log10(rms) : -120,
      correlation: ch?.analyserL ? correlation(left, right) : 0,
    };
  }

  deviceReductionDb(trackId: string, effectId: string): number {
    return this.graph.channels.get(trackId)?.chain.reductionDb(effectId) ?? 0;
  }

  masterLoudness(): { integratedLufs: number; truePeakDbtp: number } {
    return { integratedLufs: this.graph.loudness.integratedLufs(), truePeakDbtp: this.graph.loudness.truePeakDbtp() };
  }

  dispose(): void {
    this.stop();
    this.graph.dispose();
  }
}

let singleton: StudioEngine | null = null;
export function getStudioEngine(): StudioEngine {
  if (!singleton) singleton = new StudioEngine();
  return singleton;
}
