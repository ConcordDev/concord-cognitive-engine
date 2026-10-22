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
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function defaultContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const W = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const C = W.OfflineAudioContext || W.webkitOfflineAudioContext;
  if (!C) throw new Error('This browser cannot render audio offline.');
  return new C(channels, length, sampleRate);
}

export async function renderProject(project: DAWProject, audio: Map<string, PcmAudio>, opts: RenderOptions = {}): Promise<PcmAudio> {
  const sampleRate = opts.sampleRate || project.sampleRate || 48000;
  const start = Math.max(0, opts.startBeat ?? 0);
  const end = Math.max(start + 1, opts.endBeat ?? Math.max(4, projectEndBeat(project)));
  const spb = 60 / project.bpm;
  const tail = opts.tailSec ?? 2.5;
  const frames = Math.ceil(((end - start) * spb + tail) * sampleRate);
  const ctx = (opts.createContext || defaultContext)(2, frames, sampleRate);
  const graph = new ProjectGraph(ctx, { destination: ctx.destination, onlyTrackIds: opts.onlyTrackIds, bypassMastering: opts.bypassMastering });
  for (const [id, a] of audio) {
    const buf = ctx.createBuffer(a.channels.length, a.channels[0].length, a.sampleRate);
    a.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    graph.setBuffer(id, buf);
  }
  graph.sync(project);
  const events = collectEvents(start, end, {
    tracks: project.tracks,
    beatsPerBar: project.timeSignature?.[0] || 4,
    bpm: project.bpm,
    metronome: false,
    mode: 'arrange',
  }, { catchUp: true });
  for (const ev of events) {
    if (ev.kind === 'click') continue;
    graph.schedule(ev, (ev.beat - start) * spb, spb);
  }
  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => new Float32Array(rendered.getChannelData(i)));
  return { channels: trimTail(channels), sampleRate };
}

/** Drop trailing digital silence (keeps reverb tails, removes the unused part of the tail window). */
function trimTail(channels: Float32Array[], threshold = 1e-5): Float32Array[] {
  let last = 0;
  for (const ch of channels) for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > threshold) { last = i; break; }
  const keep = Math.min(channels[0].length, last + 2048);
  return channels.map((c) => c.slice(0, keep));
}

export type ExportFormat = 'wav' | 'flac';

export interface ExportOptions {
  format: ExportFormat;
  bitDepth: 16 | 24 | 32;
  sampleRate: number;
  /** Loudness target; null = no loudness normalization (only clip protection). */
  target: { lufs: number; ceilingDb: number } | null;
  stems: boolean;
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

function encode(audio: PcmAudio, o: ExportOptions): Blob {
  if (o.format === 'flac') {
    const bd = o.bitDepth === 16 ? 16 : 24;
    return new Blob([encodeFlac(audio.channels, audio.sampleRate, { bitDepth: bd, dither: true }) as Uint8Array<ArrayBuffer>], { type: 'audio/flac' });
  }
  return new Blob([encodeWav(audio.channels, audio.sampleRate, { bitDepth: o.bitDepth, dither: o.bitDepth !== 32 })], { type: 'audio/wav' });
}

const safeName = (s: string) => (s || 'Untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Untitled';

export async function exportProject(project: DAWProject, audio: Map<string, PcmAudio>, o: ExportOptions): Promise<ExportResult> {
  const ext = o.format === 'flac' ? 'flac' : 'wav';
  const base = safeName(project.title);
  o.onProgress?.('Rendering mix', 0.05);
  const raw = await renderProject(project, audio, { sampleRate: o.sampleRate });
  let gainDb = 0;
  let limiterDb = 0;
  let mixAudio: PcmAudio = raw;
  if (o.target) {
    o.onProgress?.('Mastering to target', 0.4);
    const m = masterToTarget(raw.channels, raw.sampleRate, o.target);
    mixAudio = { channels: m.channels, sampleRate: raw.sampleRate };
    gainDb = m.gainDb;
    limiterDb = m.maxReductionDb;
  } else if (o.bitDepth !== 32) {
    const pc = preventClipping(raw.channels, raw.sampleRate, -0.1);
    mixAudio = { channels: pc.channels, sampleRate: raw.sampleRate };
    limiterDb = -pc.trimDb;
  }
  const mix: ExportFile = { name: `${base}.${ext}`, blob: encode(mixAudio, o), report: measureLoudness(mixAudio.channels, mixAudio.sampleRate) };

  const stems: ExportFile[] = [];
  if (o.stems) {
    const tracks = project.tracks.filter((t) => t.type !== 'master' && t.clips.length);
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      o.onProgress?.(`Stem: ${t.name}`, 0.5 + (0.5 * i) / tracks.length);
      const solo = { ...project, tracks: project.tracks.map((x) => ({ ...x, solo: false, mute: x.id === t.id ? false : x.mute })) };
      let s = await renderProject(solo, audio, { sampleRate: o.sampleRate, onlyTrackIds: [t.id], bypassMastering: true });
      if (o.bitDepth !== 32) s = { channels: preventClipping(s.channels, s.sampleRate, -0.1).channels, sampleRate: s.sampleRate };
      stems.push({ name: `${base}_${String(i + 1).padStart(2, '0')}_${safeName(t.name)}.${ext}`, blob: encode(s, o), report: measureLoudness(s.channels, s.sampleRate) });
    }
  }
  o.onProgress?.('Done', 1);
  return { mix, stems, gainDb, limiterDb };
}
