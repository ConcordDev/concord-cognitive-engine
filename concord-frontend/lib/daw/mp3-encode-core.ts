/**
 * MP3 encode for Studio export.
 *
 * Encoder: @breezystack/lamejs 1.2.7 (LGPL-3.0), a JavaScript port of LAME.
 * Its public Mp3Encoder API is CBR only — there is no supported VBR/V0
 * switch — so export offers 128/192/256/320 kbps and does not pretend to
 * write a V0 file. 44.1 kHz and 48 kHz, stereo. ID3v2.3 tags are written
 * here (the encoder does not write them).
 *
 * This is the worker-safe core: it must never create the encode Worker.
 * mp3-encode.worker.ts imports this file; mp3-encode.ts creates the Worker
 * and re-exports this file. A worker that imports the module which spawns
 * that same worker is a self-referential worker graph, and Turbopack's
 * production build never finishes on it.
 */

export const MP3_BITRATES = [128, 192, 256, 320] as const;
export type Mp3Bitrate = (typeof MP3_BITRATES)[number];

/** Public lamejs API has no VBR control. Kept so the UI can ask one place. */
export const MP3_VBR_SUPPORTED = false;

export const MP3_SAMPLE_RATES = [44100, 48000] as const;

export interface Mp3Tags {
  title?: string;
  artist?: string;
  bpm?: number;
  key?: string;
}

export interface Mp3EncodeOptions {
  channels: Float32Array[];
  sampleRate: number;
  bitrate: Mp3Bitrate;
  tags?: Mp3Tags;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

const MPEG1_L3_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_SR = [44100, 48000, 32000];
const MPEG2_SR = [22050, 24000, 16000];

function abortIf(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error('MP3 encode cancelled');
    e.name = 'AbortError';
    throw e;
  }
}

function floatToI16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

function syncsafe(n: number): number[] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function textFrame(id: string, text: string): Uint8Array {
  const chars = new Uint8Array(2 + text.length * 2);
  chars[0] = 0xff;
  chars[1] = 0xfe; // UTF-16 BOM, little endian
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    chars[2 + i * 2] = c & 0xff;
    chars[3 + i * 2] = (c >> 8) & 0xff;
  }
  const body = new Uint8Array(1 + chars.length);
  body[0] = 1; // UTF-16
  body.set(chars, 1);
  const frame = new Uint8Array(10 + body.length);
  frame[0] = id.charCodeAt(0);
  frame[1] = id.charCodeAt(1);
  frame[2] = id.charCodeAt(2);
  frame[3] = id.charCodeAt(3);
  const size = body.length;
  frame[4] = (size >>> 24) & 0xff;
  frame[5] = (size >>> 16) & 0xff;
  frame[6] = (size >>> 8) & 0xff;
  frame[7] = size & 0xff;
  frame.set(body, 10);
  return frame;
}

/** ID3v2.3 tag. Empty fields are omitted. Returns empty when nothing is set. */
export function buildId3v23(tags: Mp3Tags | undefined): Uint8Array {
  const frames: Uint8Array[] = [];
  const title = tags?.title?.trim();
  const artist = tags?.artist?.trim();
  const key = tags?.key?.trim();
  if (title) frames.push(textFrame('TIT2', title));
  if (artist) frames.push(textFrame('TPE1', artist));
  if (tags?.bpm && Number.isFinite(tags.bpm)) frames.push(textFrame('TBPM', String(Math.round(tags.bpm))));
  if (key) frames.push(textFrame('TKEY', key));
  if (!frames.length) return new Uint8Array(0);
  let bodyLen = 0;
  for (const f of frames) bodyLen += f.length;
  const out = new Uint8Array(10 + bodyLen);
  out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; // ID3
  out[3] = 3; out[4] = 0; // v2.3.0
  const ss = syncsafe(bodyLen);
  out[6] = ss[0]; out[7] = ss[1]; out[8] = ss[2]; out[9] = ss[3];
  let o = 10;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function encodeMp3(opts: Mp3EncodeOptions): Promise<Uint8Array> {
  if (!MP3_BITRATES.includes(opts.bitrate)) throw new Error(`MP3 bitrate must be one of ${MP3_BITRATES.join(', ')}`);
  if (opts.sampleRate !== 44100 && opts.sampleRate !== 48000) {
    throw new Error('MP3 export supports 44.1 kHz and 48 kHz only');
  }
  const leftSrc = opts.channels[0];
  if (!leftSrc || !leftSrc.length) throw new Error('Nothing to encode');
  abortIf(opts.signal);
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const rightSrc = opts.channels[1] && opts.channels[1].length === leftSrc.length ? opts.channels[1] : leftSrc;
  const left = floatToI16(leftSrc);
  const right = floatToI16(rightSrc);
  const encoder = new Mp3Encoder(2, opts.sampleRate, opts.bitrate);
  const parts: Uint8Array[] = [];
  const id3 = buildId3v23(opts.tags);
  if (id3.length) parts.push(id3);
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    abortIf(opts.signal);
    const end = Math.min(left.length, i + block);
    const chunk = encoder.encodeBuffer(left.subarray(i, end), right.subarray(i, end));
    if (chunk && chunk.length) parts.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    opts.onProgress?.(Math.min(0.99, end / left.length));
    // Yield so a worker (or a main-thread fallback) can paint and observe cancel.
    await new Promise((r) => setTimeout(r, 0));
  }
  abortIf(opts.signal);
  const tail = encoder.flush();
  if (tail && tail.length) parts.push(tail instanceof Uint8Array ? tail : new Uint8Array(tail));
  opts.onProgress?.(1);
  return concat(parts);
}

export function mp3Blob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' });
}

export interface Mp3Inspection {
  hasId3: boolean;
  sampleRate: number;
  channels: number;
  bitrateKbps: number;
  cbr: boolean;
  frameCount: number;
  samples: number;
  durationSec: number;
  tags: { title?: string; artist?: string; bpm?: string; key?: string };
}

function readSyncsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function decodeText(data: Uint8Array): string {
  if (!data.length) return '';
  const enc = data[0];
  const body = data.subarray(1);
  if (enc === 0) return new TextDecoder('latin1').decode(body).replace(/\0+$/, '');
  if (enc === 3) return new TextDecoder('utf-8').decode(body).replace(/\0+$/, '');
  // UTF-16 with BOM
  let u = body;
  if (u.length >= 2 && u[0] === 0xff && u[1] === 0xfe) u = u.subarray(2);
  if (u.length >= 2 && u[0] === 0xfe && u[1] === 0xff) {
    const swapped = new Uint8Array(u.length - 2);
    for (let i = 2; i + 1 < u.length; i += 2) { swapped[i - 2] = u[i + 1]; swapped[i - 1] = u[i]; }
    u = swapped;
  }
  return new TextDecoder('utf-16le').decode(u).replace(/\0+$/, '');
}

/** Parse an ID3v2 tag plus MPEG frames. Throws if no frame header is found. */
export function inspectMp3(bytes: Uint8Array): Mp3Inspection {
  let o = 0;
  const tags: Mp3Inspection['tags'] = {};
  let hasId3 = false;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    hasId3 = true;
    const size = readSyncsafe(bytes, 6);
    const end = Math.min(bytes.length, 10 + size);
    let p = 10;
    while (p + 10 <= end) {
      const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      if (id === '\0\0\0\0') break;
      const sz = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7];
      if (sz <= 0 || p + 10 + sz > end) break;
      const text = decodeText(bytes.subarray(p + 10, p + 10 + sz));
      if (id === 'TIT2') tags.title = text;
      else if (id === 'TPE1') tags.artist = text;
      else if (id === 'TBPM') tags.bpm = text;
      else if (id === 'TKEY') tags.key = text;
      p += 10 + sz;
    }
    o = end;
  }
  let sampleRate = 0;
  let channels = 0;
  let bitrateKbps = 0;
  let cbr = true;
  let frameCount = 0;
  let samples = 0;
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff || (bytes[o + 1] & 0xe0) !== 0xe0) { o++; continue; }
    const ver = (bytes[o + 1] >> 3) & 3;
    const layer = (bytes[o + 1] >> 1) & 3;
    const brIndex = (bytes[o + 2] >> 4) & 0xf;
    const srIndex = (bytes[o + 2] >> 2) & 3;
    const padding = (bytes[o + 2] >> 1) & 1;
    const mode = (bytes[o + 3] >> 6) & 3;
    if (layer !== 1 || srIndex === 3 || brIndex === 0 || brIndex === 15) { o++; continue; }
    const mpeg1 = ver === 3;
    const mpeg2 = ver === 2 || ver === 0;
    if (!mpeg1 && !mpeg2) { o++; continue; }
    const br = (mpeg1 ? MPEG1_L3_BITRATE : MPEG2_L3_BITRATE)[brIndex];
    const sr = (mpeg1 ? MPEG1_SR : MPEG2_SR)[srIndex];
    if (!br || !sr) { o++; continue; }
    const frameLen = Math.floor((mpeg1 ? 144 : 72) * br * 1000 / sr) + padding;
    if (frameLen < 4 || o + frameLen > bytes.length + 4) break;
    if (!frameCount) { sampleRate = sr; channels = mode === 3 ? 1 : 2; bitrateKbps = br; }
    else if (br !== bitrateKbps) cbr = false;
    samples += mpeg1 ? 1152 : 576;
    frameCount++;
    o += frameLen;
  }
  if (!frameCount || !sampleRate) throw new Error('No MP3 frame header found');
  return { hasId3, sampleRate, channels, bitrateKbps, cbr, frameCount, samples, durationSec: samples / sampleRate, tags };
}
