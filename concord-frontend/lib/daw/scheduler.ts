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
import { beatAfter, bpmAt, isConstantTempo, resolveTempo, secondsBetween, type TempoPoint } from './tempo-map';
import { auditionSpec, clipGaps, compPlaybackSpecs } from './takes';
import { audibleIds } from './routing';

export type EventKind = 'note' | 'audio' | 'click';

export interface NoteEvent {
  kind: 'note';
  trackId: string;
  clipId: string;
  beat: number;
  pitch: number;
  velocity: number;
  lengthBeats: number;
  /** Wall-clock length when the tempo map is not constant. */
  durationSec?: number;
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
  /**
   * Wall-clock length. Set when a tempo ramp is active so the file plays at
   * a constant rate (no warp) instead of tracking the ramp.
   */
  durationSec?: number;
  /** Seconds per beat used for fades: the tempo at the clip start, not the ramp. */
  rateSecPerBeat?: number;
  gainDb: number;
  /** Explicit fades in seconds. When set, they replace the clip's beat fades. */
  fadeInSec?: number;
  fadeOutSec?: number;
  fadeShape?: 'linear' | 'equalPower';
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
  /** Breakpoints. Omit for a constant `bpm`. */
  tempo?: TempoPoint[];
  metronome: boolean;
  /** 'arrange' plays the timeline; 'session' plays only launched clips. */
  mode: 'arrange' | 'session';
  launched?: Record<string, LaunchedClip | undefined>;
  /** Play this take on its track instead of the comp and arrangement clips. */
  audition?: { trackId: string; takeId: string } | null;
  /** Derived clip audio (Pitch Editor). The saved clip still points at the dry asset. */
  bufferOverrides?: Record<string, string>;
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
  const ids = audibleIds(tracks);
  return tracks.filter((t) => ids.has(t.id));
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
  tempo: TempoPoint[] | null,
  opts: CollectOptions,
  out: TimelineEvent[],
  bufferOverrides?: Record<string, string>,
): void {
  if (clipEnd <= from || clipStart >= to) return;
  const variable = !!tempo && !isConstantTempo(tempo);
  const secPerBeat = 60 / bpm;
  for (const base of clipIterations(clipStart, clipEnd, loopLen, from, to)) {
    const iterEnd = Math.min(base + loopLen, clipEnd);
    const bufferId = bufferOverrides?.[clip.id] || clip.audioBufferId;
    if (clip.type === 'audio' && bufferId) {
      const playStart = base;
      const rateBpm = variable && tempo ? bpmAt(tempo, base) : bpm;
      const fullSec = (iterEnd - base) * (60 / rateBpm);
      if (playStart >= from - EPS && playStart < to) {
        out.push({
          kind: 'audio', trackId: track.id, clipId: clip.id, beat: playStart, bufferId,
          offsetSec: Math.max(0, clip.offset || 0), lengthBeats: iterEnd - playStart,
          durationSec: variable ? fullSec : undefined,
          rateSecPerBeat: variable ? 60 / rateBpm : undefined,
          gainDb: clip.gain || 0,
          fadeShape: clip.fadeShape === 'equalPower' ? 'equalPower' : undefined,
        });
      } else if (opts.catchUp && playStart < from && iterEnd > from) {
        const elapsed = variable && tempo ? secondsBetween(tempo, base, from) : (from - playStart) * secPerBeat;
        if (variable && elapsed >= fullSec - 1e-4) continue;
        out.push({
          kind: 'audio', trackId: track.id, clipId: clip.id, beat: from, bufferId,
          offsetSec: Math.max(0, clip.offset || 0) + elapsed, lengthBeats: iterEnd - from,
          durationSec: variable ? Math.max(0, fullSec - elapsed) : undefined,
          rateSecPerBeat: variable ? 60 / rateBpm : undefined,
          gainDb: clip.gain || 0,
          fadeShape: clip.fadeShape === 'equalPower' ? 'equalPower' : undefined,
        });
      }
      continue;
    }
    for (const n of clip.midiNotes || []) {
      if (n.startBeat < 0 || n.startBeat >= loopLen - EPS) continue;
      const beat = base + n.startBeat;
      if (beat >= iterEnd - EPS) continue;
      if (beat < from - EPS || beat >= to) continue;
      const lengthBeats = Math.max(0.01, Math.min(n.lengthBeats, iterEnd - beat));
      out.push({
        kind: 'note', trackId: track.id, clipId: clip.id, beat, pitch: n.pitch,
        velocity: Math.max(1, Math.min(127, n.velocity || 100)),
        lengthBeats,
        durationSec: variable && tempo ? Math.max(0.01, secondsBetween(tempo, beat, beat + lengthBeats)) : undefined,
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
  const tempo = src.tempo && src.tempo.length && !isConstantTempo(src.tempo) ? src.tempo : null;
  if (to > f) {
    for (const track of audibleTracks(src.tracks)) {
      if (src.mode === 'session') {
        const l = src.launched?.[track.id];
        if (!l) continue;
        const clip = track.clips.find((c) => c.id === l.clipId);
        if (!clip) continue;
        collectClip(track, clip, l.launchBeat, Number.POSITIVE_INFINITY, Math.max(0.25, clip.lengthBeats), f, to, src.bpm, tempo, opts, out, src.bufferOverrides);
      } else if (src.audition && src.audition.trackId === track.id) {
        const take = (track.takes || []).find((tk) => tk.id === src.audition?.takeId);
        const points = tempo || [{ beat: 0, bpm: src.bpm, curve: 'step' as const }];
        if (take) {
          const spec = auditionSpec(take, f, to, points, !!opts.catchUp);
          if (spec) out.push({ kind: 'audio', trackId: track.id, ...spec });
        }
      } else {
        const comp = track.comp || [];
        const points = tempo || [{ beat: 0, bpm: src.bpm, curve: 'step' as const }];
        if (comp.length) {
          for (const spec of compPlaybackSpecs(track.takes || [], comp, f, to, points, !!opts.catchUp)) {
            out.push({ kind: 'audio', trackId: track.id, ...spec });
          }
        }
        for (const clip of track.clips) {
          if (clip.slot !== undefined && clip.slot !== null) continue; // Session-only clip
          if (comp.length && clip.type === 'audio') {
            if (clip.looped) continue;
            const rate = 60 / bpmAt(points, clip.startBeat);
            for (const gap of clipGaps(clip.startBeat, clip.startBeat + clip.lengthBeats, comp)) {
              const virtual: DAWClip = {
                ...clip,
                id: `${clip.id}@${gap.start.toFixed(4)}`,
                startBeat: gap.start,
                lengthBeats: gap.end - gap.start,
                offset: Math.max(0, (clip.offset || 0) + (gap.start - clip.startBeat) * rate),
                looped: false,
                audioBufferId: src.bufferOverrides?.[clip.id] || clip.audioBufferId,
              };
              collectClip(track, virtual, virtual.startBeat, virtual.startBeat + virtual.lengthBeats, virtual.lengthBeats, f, to, src.bpm, tempo, opts, out);
            }
            continue;
          }
          const loopLen = clip.looped && clip.loopLength > 0 ? clip.loopLength : clip.lengthBeats;
          collectClip(track, clip, clip.startBeat, clip.startBeat + clip.lengthBeats, loopLen, f, to, src.bpm, tempo, opts, out, src.bufferOverrides);
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
  onWindow?(fromBeat: number, toBeat: number, timeAt: (beat: number) => number): void;
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
    const map = resolveTempo(this.cfg.getSource());
    let seg = this.segments[0];
    if (!seg) return 0;
    for (const s of this.segments) {
      if (s.time <= t + EPS) seg = s;
      else break;
    }
    if (isConstantTempo(map)) return seg.beat + ((t - seg.time) * map[0].bpm) / 60;
    return beatAfter(map, seg.beat, t - seg.time);
  }

  /** Context time at which `beat` plays (valid inside the current segment). */
  timeAtBeat(beat: number): number {
    const map = resolveTempo(this.cfg.getSource());
    const seg = this.segments[this.segments.length - 1] ?? { time: this.cfg.clock.now(), beat: 0 };
    if (isConstantTempo(map)) return seg.time + ((beat - seg.beat) * 60) / map[0].bpm;
    return seg.time + secondsBetween(map, seg.beat, beat);
  }

  tick(): void {
    if (!this.running) return;
    const src = this.cfg.getSource();
    const map = resolveTempo(src);
    const constant = isConstantTempo(map);
    const spb = 60 / Math.max(1, map[0].bpm);
    const horizon = this.cfg.clock.now() + (this.cfg.lookaheadSec ?? 0.12);
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      const remain = horizon - this.nextTime;
      let windowEnd = constant ? this.nextBeat + remain / spb : beatAfter(map, this.nextBeat, remain);
      const loop = this.cfg.loop?.();
      const wraps = !!loop && loop.enabled && loop.end > loop.start && this.nextBeat >= 0 && this.nextBeat < loop.end && windowEnd >= loop.end - 1e-9;
      if (wraps && loop) windowEnd = loop.end;
      const segTime = this.nextTime;
      const segBeat = this.nextBeat;
      this.cfg.onWindow?.(segBeat, windowEnd, (beat) => segTime + (constant ? (beat - segBeat) * spb : secondsBetween(map, segBeat, beat)));
      for (const ev of collectEvents(segBeat, windowEnd, src, { catchUp: this.firstWindow })) {
        const dt = constant ? (ev.beat - segBeat) * spb : secondsBetween(map, segBeat, ev.beat);
        const evSpb = constant ? spb : 60 / bpmAt(map, ev.beat);
        this.cfg.onEvent(ev, segTime + dt, evSpb);
      }
      this.firstWindow = false;
      const advanced = constant ? (windowEnd - segBeat) * spb : secondsBetween(map, segBeat, windowEnd);
      this.nextTime = segTime + advanced;
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
