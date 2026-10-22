/**
 * Offline render + export. Uses the same ProjectGraph and event collector as
 * live playback, so the bounce matches what you hear. Output is 32-bit float
 * until the final encode (WAV 16/24 PCM with TPDF dither, WAV 32-bit float,
 * or FLAC 16/24).
 */

import type { DAWProject } from './types';
import { ProjectGraph } from './graph';
import { collectEvents } from './scheduler';
import { projectEndBeat } from './project';
import { encodeWav } from './wav';
import { encodeFlac } from './flac';
import { measureLoudness, type LoudnessReport } from './dsp/loudness';
import { masterToTarget, preventClipping } from './dsp/limiter';
import { encodeMp3OffThread, mp3Blob, type Mp3Bitrate, type Mp3Tags } from './mp3-encode';
import { bpmAt, isConstantTempo, projectTempoPoints, renderClickTrack, secondsBetween } from './tempo-map';
import { preparePitchExport } from './dsp/pitch/settings';

export interface PcmAudio {
  channels: Float32Array[];
  sampleRate: number;
}

export interface RenderOptions {
  sampleRate?: number;
  startBeat?: number;
  endBeat?: number;
  tailSec?: number;
  onlyTrackIds?: string[] | null;
  bypassMastering?: boolean;
  /** Override for tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  /** Mix a click impulse at every beat (offline metronome / tests). */
  includeClicks?: boolean;
  signal?: AbortSignal;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function defaultContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const W = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const C = W.OfflineAudioContext || W.webkitOfflineAudioContext;
  if (!C) throw new Error('This browser cannot render audio offline.');
  return new C(channels, length, sampleRate);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error('Export cancelled');
    e.name = 'AbortError';
    throw e;
  }
}

export async function renderProject(project: DAWProject, audio: Map<string, PcmAudio>, opts: RenderOptions = {}): Promise<PcmAudio> {
  throwIfAborted(opts.signal);
  // Bake Pitch Correct into clip buffers and drop those devices. The offline
  // graph must not also host the worklet (pitchCompensate stays off).
  const prepared = preparePitchExport(project, audio);
  const song = prepared.project;
  const clips = prepared.audio;
  const sampleRate = opts.sampleRate || song.sampleRate || 48000;
  const start = Math.max(0, opts.startBeat ?? 0);
  const end = Math.max(start + 1, opts.endBeat ?? Math.max(4, projectEndBeat(song)));
  const map = projectTempoPoints(song);
  const constant = isConstantTempo(map);
  const spb = 60 / map[0].bpm;
  const tail = opts.tailSec ?? 2.5;
  const span = constant ? (end - start) * spb : secondsBetween(map, start, end);
  const frames = Math.ceil((span + tail) * sampleRate);
  const ctx = (opts.createContext || defaultContext)(2, frames, sampleRate);
  const graph = new ProjectGraph(ctx, { destination: ctx.destination, onlyTrackIds: opts.onlyTrackIds, bypassMastering: opts.bypassMastering });
  for (const [id, a] of clips) {
    const buf = ctx.createBuffer(a.channels.length, a.channels[0].length, a.sampleRate);
    a.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    graph.setBuffer(id, buf);
  }
  graph.sync(song);
  const bpb = song.timeSignature?.[0] || 4;
  const events = collectEvents(start, end, {
    tracks: song.tracks,
    beatsPerBar: bpb,
    bpm: map[0].bpm,
    tempo: map,
    metronome: false,
    mode: 'arrange',
  }, { catchUp: true });
  for (const ev of events) {
    if (ev.kind === 'click') continue;
    const t = constant ? (ev.beat - start) * spb : secondsBetween(map, start, ev.beat);
    const evSpb = constant ? spb : 60 / bpmAt(map, ev.beat);
    graph.schedule(ev, t, evSpb);
  }
  const rendered = await ctx.startRendering();
  let channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => new Float32Array(rendered.getChannelData(i)));
  if (opts.includeClicks) {
    const clicks = renderClickTrack(map, { fromBeat: start, toBeat: end, beatsPerBar: bpb, sampleRate });
    channels = channels.map((ch) => {
      const next = new Float32Array(ch);
      const n = Math.min(next.length, clicks.samples.length);
      for (let i = 0; i < n; i++) if (clicks.samples[i]) next[i] += clicks.samples[i];
      return next;
    });
  }
  return { channels: trimTail(channels), sampleRate };
}

/** Drop trailing digital silence (keeps reverb tails, removes the unused part of the tail window). */
function trimTail(channels: Float32Array[], threshold = 1e-5): Float32Array[] {
  let last = 0;
  for (const ch of channels) for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > threshold) { last = i; break; }
  const keep = Math.min(channels[0].length, last + 2048);
  return channels.map((c) => c.slice(0, keep));
}

export type ExportFormat = 'wav' | 'flac' | 'mp3';

export interface ExportOptions {
  format: ExportFormat;
  bitDepth: 16 | 24 | 32;
  sampleRate: number;
  /** CBR bitrate. Ignored unless format is mp3. */
  bitrate?: Mp3Bitrate;
  /** ID3 tags. Written for MP3 only. */
  tags?: Mp3Tags;
  /** Loudness target; null = no loudness normalization (only clip protection). */
  target: { lufs: number; ceilingDb: number } | null;
  stems: boolean;
  signal?: AbortSignal;
  onProgress?: (label: string, fraction: number) => void;
}

export interface ExportFile {
  name: string;
  blob: Blob;
  report: LoudnessReport;
}

export interface ExportResult {
  mix: ExportFile;
  stems: ExportFile[];
  gainDb: number;
  limiterDb: number;
}

async function encode(audio: PcmAudio, o: ExportOptions): Promise<Blob> {
  throwIfAborted(o.signal);
  if (o.format === 'mp3') {
    const bytes = await encodeMp3OffThread({
      channels: audio.channels,
      sampleRate: audio.sampleRate,
      bitrate: o.bitrate || 320,
      tags: o.tags,
      signal: o.signal,
      onProgress: (f) => o.onProgress?.('Encoding MP3', f),
    });
    return mp3Blob(bytes);
  }
  if (o.format === 'flac') {
    const bd = o.bitDepth === 16 ? 16 : 24;
    return new Blob([encodeFlac(audio.channels, audio.sampleRate, { bitDepth: bd, dither: true }) as Uint8Array<ArrayBuffer>], { type: 'audio/flac' });
  }
  return new Blob([encodeWav(audio.channels, audio.sampleRate, { bitDepth: o.bitDepth, dither: o.bitDepth !== 32 })], { type: 'audio/wav' });
}

const safeName = (s: string) => (s || 'Untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Untitled';

export async function exportProject(project: DAWProject, audio: Map<string, PcmAudio>, o: ExportOptions): Promise<ExportResult> {
  const ext = o.format === 'flac' ? 'flac' : o.format === 'mp3' ? 'mp3' : 'wav';
  const base = safeName(project.title);
  o.onProgress?.('Rendering mix', 0.05);
  const raw = await renderProject(project, audio, { sampleRate: o.sampleRate, signal: o.signal });
  let gainDb = 0;
  let limiterDb = 0;
  let mixAudio: PcmAudio = raw;
  if (o.target) {
    o.onProgress?.('Mastering to target', 0.4);
    const m = masterToTarget(raw.channels, raw.sampleRate, o.target);
    mixAudio = { channels: m.channels, sampleRate: raw.sampleRate };
    gainDb = m.gainDb;
    limiterDb = m.maxReductionDb;
  } else if (o.format === 'mp3' || o.bitDepth !== 32) {
    const pc = preventClipping(raw.channels, raw.sampleRate, -0.1);
    mixAudio = { channels: pc.channels, sampleRate: raw.sampleRate };
    limiterDb = -pc.trimDb;
  }
  o.onProgress?.(o.format === 'mp3' ? 'Encoding MP3' : 'Encoding', 0.55);
  const mix: ExportFile = { name: `${base}.${ext}`, blob: await encode(mixAudio, o), report: measureLoudness(mixAudio.channels, mixAudio.sampleRate) };

  const stems: ExportFile[] = [];
  if (o.stems) {
    const tracks = project.tracks.filter((t) => t.type !== 'master' && t.clips.length);
    for (let i = 0; i < tracks.length; i++) {
      throwIfAborted(o.signal);
      const t = tracks[i];
      o.onProgress?.(`Stem: ${t.name}`, 0.6 + (0.35 * i) / tracks.length);
      const solo = { ...project, tracks: project.tracks.map((x) => ({ ...x, solo: false, mute: x.id === t.id ? false : x.mute })) };
      let s = await renderProject(solo, audio, { sampleRate: o.sampleRate, onlyTrackIds: [t.id], bypassMastering: true, signal: o.signal });
      if (o.format !== 'mp3' && o.bitDepth !== 32) s = { channels: preventClipping(s.channels, s.sampleRate, -0.1).channels, sampleRate: s.sampleRate };
      const stemTags = o.tags ? { ...o.tags, title: `${o.tags.title || base} — ${t.name}` } : undefined;
      stems.push({ name: `${base}_${String(i + 1).padStart(2, '0')}_${safeName(t.name)}.${ext}`, blob: await encode(s, { ...o, tags: stemTags }), report: measureLoudness(s.channels, s.sampleRate) });
    }
  }
  o.onProgress?.('Done', 1);
  return { mix, stems, gainDb, limiterDb };
}
