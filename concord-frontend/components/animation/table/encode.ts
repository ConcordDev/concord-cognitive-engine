/**
 * Export, for real, in the browser.
 *
 *  - WebM (VP9/VP8 + Opus) and MP4 (H.264 + AAC, or Opus where AAC isn't
 *    available) are encoded frame by frame with WebCodecs — each film frame
 *    gets its exact timestamp, so a drawing held for 3 frames lasts exactly
 *    3/fps seconds regardless of how fast the machine renders. The
 *    soundtrack is mixed offline at each track's start time and encoded in.
 *  - GIF is a true animated GIF (gifenc): one image per drawing, its delay
 *    the drawing's exposure.
 *  - PNG is a ZIP of one PNG per film frame (frame_0001.png …).
 *
 * Anything a browser can't do is said plainly (e.g. no H.264 encoder), never
 * swapped for a different file with the wrong name.
 */

import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { zipSync } from 'fflate';
import { drawFrame, filmSequence, type Anim } from './draw';

export type ExportFormat = 'webm' | 'mp4' | 'gif' | 'png-zip';
export interface ExportResult { blob: Blob; ext: string; mime: string; filmFrames: number; drawings: number; durationSec: number; width: number; height: number; withSound: boolean; codec: string }
export interface Progress { stage: 'sound' | 'frames' | 'finishing'; done: number; total: number }

const SR = 48000;

function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function pickVideoCodec(format: 'webm' | 'mp4', width: number, height: number, fps: number): Promise<string | null> {
  if (!hasWebCodecs()) return null;
  const candidates = format === 'webm' ? ['vp09.00.10.08', 'vp8'] : ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 4_000_000, framerate: fps });
      if (r.supported) return codec;
    } catch { /* try the next */ }
  }
  return null;
}
async function pickAudioCodec(format: 'webm' | 'mp4'): Promise<string | null> {
  if (typeof window === 'undefined' || !('AudioEncoder' in window)) return null;
  const candidates = format === 'webm' ? ['opus'] : ['mp4a.40.2', 'opus'];
  for (const codec of candidates) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
      if (r.supported) return codec;
    } catch { /* next */ }
  }
  return null;
}

/** What this browser can export, checked against its real encoders. */
export async function exportCapabilities(width = 1280, height = 720, fps = 12) {
  const w = even(width); const h = even(height);
  const [webmV, mp4V, webmA, mp4A] = await Promise.all([pickVideoCodec('webm', w, h, fps), pickVideoCodec('mp4', w, h, fps), pickAudioCodec('webm'), pickAudioCodec('mp4')]);
  return { webm: { video: !!webmV, audio: !!webmA }, mp4: { video: !!mp4V, audio: !!mp4A }, gif: true, 'png-zip': true };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Mix the soundtrack offline: every track at its start time, cut to the animation's length. */
export async function mixSoundtrack(anim: Anim, durationSec: number): Promise<AudioBuffer | null> {
  const tracks = (anim.audio || []).filter((t) => t.src || t.url);
  if (!tracks.length || durationSec <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * SR), SR);
  for (const t of tracks) {
    const src = (t.src || t.url) as string;
    let buf: AudioBuffer;
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      buf = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      throw new Error(`The soundtrack “${t.name}” could not be loaded, so it can't be mixed in.`);
    }
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    if (t.startSec < durationSec) node.start(Math.max(0, t.startSec));
  }
  return ctx.startRendering();
}

/** One canvas per drawing, rendered once and reused for every frame it is held. */
function drawingCanvases(anim: Anim, width: number, height: number, scale: number): HTMLCanvasElement[] {
  return anim.frames.map((f) => {
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const c = cv.getContext('2d');
    if (c) drawFrame(c, f, anim.background, { scale });
    return cv;
  });
}

export async function exportAnimation(
  anim: Anim, format: ExportFormat,
  opts: { scale?: number; withSound?: boolean; onProgress?: (p: Progress) => void } = {},
): Promise<ExportResult> {
  const scale = Math.min(2, Math.max(0.1, opts.scale ?? 1));
  const fps = Math.max(1, Math.round(anim.fps || 12));
  const seq = filmSequence(anim.frames);
  if (!seq.length) throw new Error('There are no frames to export yet.');
  const durationSec = seq.length / fps;
  const report = opts.onProgress || (() => {});
  const isVideo = format === 'webm' || format === 'mp4';
  const width = isVideo ? even(anim.width * scale) : Math.max(1, Math.round(anim.width * scale));
  const height = isVideo ? even(anim.height * scale) : Math.max(1, Math.round(anim.height * scale));
  const drawings = drawingCanvases(anim, width, height, scale);
  const base = { filmFrames: seq.length, drawings: anim.frames.length, durationSec, width, height };

  if (format === 'gif') {
    const gif = GIFEncoder();
    const c = drawings[0].getContext('2d');
    if (!c) throw new Error('Canvas unavailable.');
    for (let i = 0; i < anim.frames.length; i++) {
      report({ stage: 'frames', done: i, total: anim.frames.length });
      const data = drawings[i].getContext('2d')!.getImageData(0, 0, width, height).data;
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, width, height, { palette, delay: Math.round((1000 / fps) * Math.max(1, anim.frames[i].exposure || 1)) });
      await tick();
    }
    gif.finish();
    report({ stage: 'finishing', done: 1, total: 1 });
    const bytes = gif.bytes();
    return { ...base, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), ext: 'gif', mime: 'image/gif', withSound: false, codec: 'gif' };
  }

  if (format === 'png-zip') {
    const files: Record<string, Uint8Array> = {};
    const pngs: Uint8Array[] = [];
    for (let i = 0; i < drawings.length; i++) {
      report({ stage: 'frames', done: i, total: drawings.length });
      pngs.push(new Uint8Array(await (await canvasBlob(drawings[i], 'image/png')).arrayBuffer()));
    }
    seq.forEach((d, i) => { files[`frame_${String(i + 1).padStart(4, '0')}.png`] = pngs[d]; });
    report({ stage: 'finishing', done: 1, total: 1 });
    const zipped = zipSync(files, { level: 0 });
    return { ...base, blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), ext: 'zip', mime: 'application/zip', withSound: false, codec: 'png' };
  }

  // ── video ──
  const vCodec = await pickVideoCodec(format, width, height, fps);
  if (!vCodec) {
    throw new Error(format === 'mp4'
      ? 'MP4 needs an H.264 encoder, and this browser doesn’t have one. Export WebM instead (it plays everywhere except older Safari).'
      : 'This browser can’t encode video (no WebCodecs). Export a GIF or the PNG frames instead.');
  }
  let mix: AudioBuffer | null = null;
  if (opts.withSound !== false && (anim.audio || []).length) {
    report({ stage: 'sound', done: 0, total: 1 });
    mix = await mixSoundtrack(anim, durationSec);
  }
  const aCodec = mix ? await pickAudioCodec(format) : null;
  if (mix && !aCodec) throw new Error('This browser can’t encode audio for this format. Export without sound or choose WebM.');

  let muxer: WebmMuxer<WebmTarget> | Mp4Muxer<Mp4Target>;
  if (format === 'webm') {
    muxer = new WebmMuxer({
      target: new WebmTarget(),
      video: { codec: vCodec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width, height, frameRate: fps },
      ...(mix ? { audio: { codec: 'A_OPUS', sampleRate: SR, numberOfChannels: 2 } } : {}),
      firstTimestampBehavior: 'offset',
    });
  } else {
    muxer = new Mp4Muxer({
      target: new Mp4Target(),
      video: { codec: 'avc', width, height, frameRate: fps },
      ...(mix ? { audio: { codec: aCodec === 'opus' ? 'opus' : 'aac', sampleRate: SR, numberOfChannels: 2 } } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
  }

  let failure: Error | null = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => (muxer as WebmMuxer<WebmTarget>).addVideoChunk(chunk, meta),
    error: (e) => { failure = e as Error; },
  });
  venc.configure({ codec: vCodec, width, height, bitrate: Math.min(8_000_000, width * height * fps * 0.12), framerate: fps, ...(format === 'mp4' ? { avc: { format: 'avc' } } : {}) });
  const frameUs = 1e6 / fps;
  for (let i = 0; i < seq.length; i++) {
    if (failure) throw failure;
    report({ stage: 'frames', done: i, total: seq.length });
    const vf = new VideoFrame(drawings[seq[i]], { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    if (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
  }
  await venc.flush();
  venc.close();

  if (mix && aCodec) {
    const aenc = new AudioEncoder({
      output: (chunk, meta) => (muxer as WebmMuxer<WebmTarget>).addAudioChunk(chunk, meta),
      error: (e) => { failure = e as Error; },
    });
    aenc.configure({ codec: aCodec, sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
    const L = mix.getChannelData(0); const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
    const block = 4800; // 100 ms
    for (let off = 0; off < mix.length; off += block) {
      const n = Math.min(block, mix.length - off);
      const planar = new Float32Array(n * 2);
      planar.set(L.subarray(off, off + n), 0);
      planar.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data: planar });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }
  if (failure) throw failure;
  report({ stage: 'finishing', done: 1, total: 1 });
  muxer.finalize();
  const buffer = (muxer.target as WebmTarget).buffer;
  const mime = format === 'webm' ? 'video/webm' : 'video/mp4';
  return { ...base, blob: new Blob([buffer], { type: mime }), ext: format, mime, withSound: !!mix, codec: aCodec ? `${vCodec} + ${aCodec}` : vCodec };
}

function canvasBlob(cv: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a frame.'))), type));
}
const tick = () => new Promise((r) => setTimeout(r, 0));
