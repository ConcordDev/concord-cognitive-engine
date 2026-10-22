/**
 * Main-thread assembly for the input capture tap.
 *
 * The worklet (or the ScriptProcessor fallback) only copies blocks. This
 * module decides which blocks belong to the current take and concatenates
 * them. No audio clock, no browser APIs.
 */

export const CAPTURE_WORKLET_NAME = 'concord-capture-tap';
export const CAPTURE_WORKLET_URL = '/worklets/capture-tap.js';
/** ScriptProcessorNode buffer. The worklet does not use this size. */
export const SCRIPT_TAP_FRAMES = 4096;

export interface CaptureAccumulator {
  chunks: Float32Array[][];
  firstTime: number | null;
  gen: number;
  /** True only while a take is open. Late blocks from an older gen are dropped. */
  open: boolean;
}

export function createCaptureAccumulator(): CaptureAccumulator {
  return { chunks: [], firstTime: null, gen: 0, open: false };
}

/** Start a take. Returns the generation the tap must stamp on each block. */
export function armCapture(acc: CaptureAccumulator): number {
  acc.chunks = [];
  acc.firstTime = null;
  acc.gen += 1;
  acc.open = true;
  return acc.gen;
}

export function disarmCapture(acc: CaptureAccumulator): void {
  acc.open = false;
}

export interface CaptureBlockMessage {
  gen: number;
  time: number;
  channels: Float32Array[];
}

/** Keep a block only when it belongs to the open generation. */
export function pushCaptureBlock(acc: CaptureAccumulator, msg: CaptureBlockMessage): boolean {
  if (!acc.open || msg.gen !== acc.gen || !msg.channels?.length || !msg.channels[0]?.length) return false;
  if (acc.firstTime === null && Number.isFinite(msg.time)) acc.firstTime = msg.time;
  acc.chunks.push(msg.channels);
  return true;
}

/** Concatenate kept blocks. Channels stay aligned to the shortest block. */
export function concatChannels(chunks: Float32Array[][]): Float32Array[] {
  if (!chunks.length || !chunks[0].length) return [];
  const nch = chunks[0].length;
  let frames = 0;
  for (const block of chunks) frames += block[0]?.length || 0;
  const out: Float32Array[] = [];
  for (let c = 0; c < nch; c++) {
    const buf = new Float32Array(frames);
    let o = 0;
    for (const block of chunks) {
      const ch = block[c];
      if (!ch) continue;
      buf.set(ch, o);
      o += ch.length;
    }
    out.push(buf);
  }
  return out;
}

/**
 * ScriptProcessor's playbackTime is when the block's output is played.
 * The input frames were captured one buffer earlier.
 */
export function scriptProcessorBlockStart(playbackTime: number, bufferFrames: number, sampleRate: number, fallbackTime: number): number {
  const pt = Number.isFinite(playbackTime) && playbackTime > 0 ? playbackTime : fallbackTime;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return pt;
  return pt - bufferFrames / sampleRate;
}
