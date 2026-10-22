/**
 * Sample-accurate event scheduling for Concord Studio.
 *
 * "A tale of two clocks" (web.dev/articles/audio-scheduling): a coarse JS
 * timer wakes every ~25 ms and queues every event whose start falls inside a
 * short look-ahead window, stamped in AudioContext time. Audio timing then
 * never depends on when the JS timer actually fired.
 *
 * `collectEvents` is the pure core (beats in, events out) shared by live
 * playback and the offline WAV renderer. `LookaheadScheduler` drives it in
 * real time, handles loop wrap and count-in, and maps context time back to
 * a beat position for the playhead.
 */

import type { DAWTrack, DAWClip } from './types';

export type EventKind = 'note' | 'audio' | 'click';

export interface NoteEvent {
  kind: 'note';
  trackId: string;
  clipId: string;
  beat: number;
  pitch: number;
  velocity: number;
  lengthBeats: number;
  /** Clip gain in dB (applied per voice). */
  gainDb?: number;
}

export interface AudioEvent {
  kind: 'audio';
  trackId: string;
  clipId: string;
  beat: number;
  bufferId: string;
  /** Seconds into the source buffer to start from. */
  offsetSec: number;
  /** How long to play, in beats (clip may be trimmed by the window start). */
  lengthBeats: number;
  gainDb: number;
}

export interface ClickEvent {
  kind: 'click';
  beat: number;
  accent: boolean;
}

export type TimelineEvent = NoteEvent | AudioEvent | ClickEvent;

/** A clip launched from the Session grid: loops from `launchBeat` until stopped. */
export interface LaunchedClip {
  clipId: string;
  launchBeat: number;
}

export interface CollectSource {
  tracks: DAWTrack[];
  beatsPerBar: number;
  bpm: number;
  metronome: boolean;
  /** 'arrange' plays the timeline; 'session' plays only launched clips. */
  mode: 'arrange' | 'session';
  launched?: Record<string, LaunchedClip | undefined>;
}

export interface CollectOptions {
  /**
   * True for the first window after play/seek: audio clips already running at
   * `from` start mid-way with an offset instead of being skipped.
   */
  catchUp?: boolean;
}

const EPS = 1e-9;

function audibleTracks(tracks: DAWTrack[]): DAWTrack[] {
  const anySolo = tracks.some((t) => t.solo);
  return tracks.filter((t) => !t.mute && (!anySolo || t.solo) && t.type !== 'master' && t.type !== 'bus');
}

/** Occurrences of a clip's content: one for plain clips, repeats for looped/session clips. */
function clipIterations(clipStart: number, clipEnd: number, loopLen: number, from: number, to: number): number[] {
  const starts: number[] = [];
  if (loopLen <= EPS) return starts;
  const firstK = Math.max(0, Math.floor((from - clipStart) / loopLen) - 1);
  for (let k = firstK; ; k++) {
    const base = clipStart + k * loopLen;
    if (base >= to || base >= clipEnd) break;
    if (base + loopLen > from) starts.push(base);
    if (k - firstK > 100000) break; // guard
  }
  return starts;
}

function collectClip(
  track: DAWTrack,
  clip: DAWClip,
  clipStart: number,
  clipEnd: number,
  loopLen: number,
  from: number,
  to: number,
  bpm: number,
  opts: CollectOptions,
  out: TimelineEvent[],
): void {
  if (clipEnd <= from || clipStart >= to) return;
  const secPerBeat = 60 / bpm;
  for (const base of clipIterations(clipStart, clipEnd, loopLen, from, to)) {
    const iterEnd = Math.min(base + loopLen, clipEnd);
    if (clip.type === 'audio' && clip.audioBufferId) {
      const playStart = base;
      if (playStart >= from - EPS && playStart < to) {
        out.push({
          kind: 'audio', trackId: track.id, clipId: clip.id, beat: playStart, bufferId: clip.audioBufferId,
          offsetSec: Math.max(0, clip.offset || 0), lengthBeats: iterEnd - playStart, gainDb: clip.gain || 0,
        });
      } else if (opts.catchUp && playStart < from && iterEnd > from) {
        out.push({
          kind: 'audio', trackId: track.id, clipId: clip.id, beat: from, bufferId: clip.audioBufferId,
          offsetSec: Math.max(0, clip.offset || 0) + (from - playStart) * secPerBeat, lengthBeats: iterEnd - from, gainDb: clip.gain || 0,
        });
      }
      continue;
    }
    for (const n of clip.midiNotes || []) {
      if (n.startBeat < 0 || n.startBeat >= loopLen - EPS) continue;
      const beat = base + n.startBeat;
      if (beat >= iterEnd - EPS) continue;
      if (beat < from - EPS || beat >= to) continue;
      out.push({
        kind: 'note', trackId: track.id, clipId: clip.id, beat, pitch: n.pitch,
        velocity: Math.max(1, Math.min(127, n.velocity || 100)),
        lengthBeats: Math.max(0.01, Math.min(n.lengthBeats, iterEnd - beat)),
        gainDb: clip.gain || 0,
      });
    }
  }
}

/** Every event whose start beat is in [from, to), sorted by beat. Pure. */
export function collectEvents(from: number, to: number, src: CollectSource, opts: CollectOptions = {}): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  if (!(to > from)) return out;

  if (src.metronome || from < 0) {
    const bpb = Math.max(1, src.beatsPerBar);
    for (let b = Math.ceil(from - EPS); b < to; b++) {
      // Count-in (negative beats) always clicks; the timeline clicks only when the metronome is on.
      if (b < 0 || src.metronome) out.push({ kind: 'click', beat: b, accent: ((b % bpb) + bpb) % bpb === 0 });
    }
  }

  const f = Math.max(0, from);
  if (to > f) {
    for (const track of audibleTracks(src.tracks)) {
      if (src.mode === 'session') {
        const l = src.launched?.[track.id];
        if (!l) continue;
        const clip = track.clips.find((c) => c.id === l.clipId);
        if (!clip) continue;
        collectClip(track, clip, l.launchBeat, Number.POSITIVE_INFINITY, Math.max(0.25, clip.lengthBeats), f, to, src.bpm, opts, out);
      } else {
        for (const clip of track.clips) {
          if (clip.slot !== undefined && clip.slot !== null) continue; // Session-only clip
          const loopLen = clip.looped && clip.loopLength > 0 ? clip.loopLength : clip.lengthBeats;
          collectClip(track, clip, clip.startBeat, clip.startBeat + clip.lengthBeats, loopLen, f, to, src.bpm, opts, out);
        }
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** Next bar line at or after `beat` (Session launch quantization). */
export function nextBarBeat(beat: number, beatsPerBar: number): number {
  const bpb = Math.max(1, beatsPerBar);
  const b = Math.ceil(beat / bpb - EPS) * bpb;
  return (b < beat - EPS ? b + bpb : b) + 0; // +0 normalizes -0
}

// ---------------------------------------------------------------------------
// Real-time driver
// ---------------------------------------------------------------------------

export interface SchedulerClock {
  /** AudioContext.currentTime */
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface SchedulerConfig {
  getSource(): CollectSource;
  /** Called for each event with its absolute AudioContext start time. */
  onEvent(ev: TimelineEvent, time: number, secPerBeat: number): void;
  clock: SchedulerClock;
  lookaheadSec?: number;
  intervalMs?: number;
  loop?: () => { enabled: boolean; start: number; end: number };
}

interface Segment {
  time: number;
  beat: number;
}

export class LookaheadScheduler {
  private cfg: SchedulerConfig;
  private timer: unknown = null;
  private nextBeat = 0;
  private nextTime = 0;
  private segments: Segment[] = [];
  private firstWindow = true;
  private running = false;

  constructor(cfg: SchedulerConfig) {
    this.cfg = cfg;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start at `fromBeat` (negative = count-in). `startTime` defaults to now + 50 ms. */
  start(fromBeat: number, startTime?: number): void {
    this.stop();
    const t0 = startTime ?? this.cfg.clock.now() + 0.05;
    this.nextBeat = fromBeat;
    this.nextTime = t0;
    this.segments = [{ time: t0, beat: fromBeat }];
    this.firstWindow = true;
    this.running = true;
    this.tick();
    this.timer = this.cfg.clock.setInterval(() => this.tick(), this.cfg.intervalMs ?? 25);
  }

  stop(): void {
    if (this.timer !== null) this.cfg.clock.clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  /** Beat position heard at context time `t` (playhead). */
  beatAt(t: number = this.cfg.clock.now()): number {
    const bpm = this.cfg.getSource().bpm;
    let seg = this.segments[0];
    if (!seg) return 0;
    for (const s of this.segments) {
      if (s.time <= t + EPS) seg = s;
      else break;
    }
    return seg.beat + ((t - seg.time) * bpm) / 60;
  }

  /** Context time at which `beat` plays (valid inside the current segment). */
  timeAtBeat(beat: number): number {
    const bpm = this.cfg.getSource().bpm;
    const seg = this.segments[this.segments.length - 1] ?? { time: this.cfg.clock.now(), beat: 0 };
    return seg.time + ((beat - seg.beat) * 60) / bpm;
  }

  tick(): void {
    if (!this.running) return;
    const src = this.cfg.getSource();
    const spb = 60 / Math.max(1, src.bpm);
    const horizon = this.cfg.clock.now() + (this.cfg.lookaheadSec ?? 0.12);
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      let windowEnd = this.nextBeat + (horizon - this.nextTime) / spb;
      const loop = this.cfg.loop?.();
      const wraps = !!loop && loop.enabled && loop.end > loop.start && this.nextBeat >= 0 && this.nextBeat < loop.end && windowEnd >= loop.end;
      if (wraps && loop) windowEnd = loop.end;
      const segTime = this.nextTime;
      const segBeat = this.nextBeat;
      for (const ev of collectEvents(segBeat, windowEnd, src, { catchUp: this.firstWindow })) {
        this.cfg.onEvent(ev, segTime + (ev.beat - segBeat) * spb, spb);
      }
      this.firstWindow = false;
      this.nextTime = segTime + (windowEnd - segBeat) * spb;
      this.nextBeat = windowEnd;
      if (wraps && loop) {
        this.nextBeat = loop.start;
        this.segments.push({ time: this.nextTime, beat: loop.start });
        if (this.segments.length > 64) this.segments.splice(0, this.segments.length - 64);
        this.firstWindow = true; // clips already running at the loop start resume mid-way
      }
    }
  }
}
