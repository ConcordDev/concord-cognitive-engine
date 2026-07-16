/**
 * Real RMS-threshold silence detection over decoded PCM audio.
 *
 * Closes the gap documented in `docs/lens-specs/podcast-capability-map.md`
 * ("trimSilence preference has no real effect anywhere" / WAVE4_INVENTORY.md
 * podcast row): `server/domains/podcast.js` already stores and returns the
 * `trimSilence` boolean faithfully — this file is the missing engine that
 * actually finds silence in the real decoded audio and reports where it is,
 * so the player can act on it instead of the preference sitting inert.
 *
 * No fabrication: every range this module returns comes from a real
 * windowed RMS scan over real `Float32Array` PCM samples decoded via the
 * Web Audio API. If decode isn't available or fails (unsupported codec,
 * CORS, a container format that can't be decoded from a partial byte
 * range — see `analyzeEpisodeForSilence` below), the honest result is an
 * empty range list — trimSilence then plays normally, never a fabricated
 * skip.
 */

export interface SilenceRange {
  startSec: number;
  endSec: number;
}

export interface SilenceDetectOptions {
  /** RMS analysis window size, in seconds. */
  windowSec?: number;
  /** RMS amplitude below this value counts as "silent" for that window. */
  thresholdRms?: number;
  /** Minimum contiguous silent duration (seconds) to report as a range. */
  minSilenceSec?: number;
}

interface ResolvedSilenceDetectOptions {
  windowSec: number;
  thresholdRms: number;
  minSilenceSec: number;
}

/**
 * Defaults, chosen for spoken-word podcast audio:
 *  - `windowSec = 0.05` (50ms): fine enough to locate a silence boundary
 *    within ~50ms (imperceptible skip-point drift) while keeping the scan
 *    cheap — a 2-hour episode is only ~144,000 windows.
 *  - `thresholdRms = 0.02` (~ -34 dBFS): sits below normal speech RMS
 *    (typically -20 to -12 dBFS) but above the noise floor of a quiet room
 *    recording or a breath sound, which is the practical range real
 *    silence-trim tools (Auphonic, Descript) target.
 *  - `minSilenceSec = 1.5`: real podcast silence-trimming tools commonly
 *    use 0.5-2s; 1.5s sits mid-range so normal mid-sentence pauses (usually
 *    well under 1s) are never cut, while genuine dead air (edit gaps,
 *    long pauses between segments) is.
 */
export const SILENCE_DEFAULTS: ResolvedSilenceDetectOptions = {
  windowSec: 0.05,
  thresholdRms: 0.02,
  minSilenceSec: 1.5,
};

function resolveOpts(opts?: SilenceDetectOptions): ResolvedSilenceDetectOptions {
  return {
    windowSec: opts?.windowSec ?? SILENCE_DEFAULTS.windowSec,
    thresholdRms: opts?.thresholdRms ?? SILENCE_DEFAULTS.thresholdRms,
    minSilenceSec: opts?.minSilenceSec ?? SILENCE_DEFAULTS.minSilenceSec,
  };
}

/** Root-mean-square amplitude of a block of PCM samples. */
export function computeRms(samples: ArrayLike<number>): number {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / samples.length);
}

/** RMS amplitude per fixed-size window across a full buffer of samples. */
export function computeRmsWindows(
  samples: Float32Array,
  sampleRate: number,
  windowSec: number = SILENCE_DEFAULTS.windowSec,
): number[] {
  if (!samples || samples.length === 0 || !isFinite(sampleRate) || sampleRate <= 0) return [];
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    out.push(computeRms(samples.subarray(start, end)));
  }
  return out;
}

/**
 * Carried between successive blocks (chunks of a streamed episode) so a
 * silence spanning a chunk boundary is reported as one continuous range
 * rather than being cut into two sub-threshold fragments.
 */
export interface SilenceScanCarry {
  openSilenceStartSec: number | null;
}

export function newSilenceScanCarry(): SilenceScanCarry {
  return { openSilenceStartSec: null };
}

/**
 * Scans one block of decoded PCM (a whole episode buffer, or one streamed
 * chunk) for silence, starting at `blockStartSec` on the overall episode
 * timeline. Returns the ranges *closed* within this block, plus updated
 * carry state describing a still-open silent stretch (if the block ends
 * mid-silence) for the caller to pass into the next block's scan.
 */
export function scanBlockForSilence(
  samples: Float32Array,
  sampleRate: number,
  blockStartSec: number,
  carry: SilenceScanCarry,
  opts?: SilenceDetectOptions,
): { ranges: SilenceRange[]; carry: SilenceScanCarry } {
  const { windowSec, thresholdRms, minSilenceSec } = resolveOpts(opts);
  const rmsWindows = computeRmsWindows(samples, sampleRate, windowSec);
  const ranges: SilenceRange[] = [];
  let openStart = carry.openSilenceStartSec;
  for (let i = 0; i < rmsWindows.length; i++) {
    const t = blockStartSec + i * windowSec;
    const isSilent = rmsWindows[i] < thresholdRms;
    if (isSilent) {
      if (openStart === null) openStart = t;
    } else if (openStart !== null) {
      if (t - openStart >= minSilenceSec) ranges.push({ startSec: openStart, endSec: t });
      openStart = null;
    }
  }
  return { ranges, carry: { openSilenceStartSec: openStart } };
}

/**
 * Convenience one-shot scan over a single, fully-available buffer (short
 * episodes, or synthetic test fixtures). Closes any silence still open at
 * the end of the buffer.
 */
export function findSilenceRanges(
  samples: Float32Array,
  sampleRate: number,
  opts?: SilenceDetectOptions,
): SilenceRange[] {
  const { minSilenceSec } = resolveOpts(opts);
  const { ranges, carry } = scanBlockForSilence(samples, sampleRate, 0, newSilenceScanCarry(), opts);
  if (carry.openSilenceStartSec !== null && sampleRate > 0) {
    const endSec = samples.length / sampleRate;
    if (endSec - carry.openSilenceStartSec >= minSilenceSec) {
      ranges.push({ startSec: carry.openSilenceStartSec, endSec });
    }
  }
  return ranges;
}

/**
 * Given known silence ranges and the current playback position, returns
 * the position to jump to when `positionSec` has just entered a detected
 * silent range (skip straight to the end of that range). Returns `null`
 * when there is nothing to skip. The small epsilon on the upper bound
 * avoids re-triggering right at a range's own end boundary.
 */
export function silenceSkipTarget(ranges: SilenceRange[], positionSec: number): number | null {
  for (const r of ranges) {
    if (positionSec >= r.startSec && positionSec < r.endSec - 0.05) {
      return r.endSec;
    }
  }
  return null;
}

/**
 * Gate + lookup in one call — the exact decision the player's playback
 * loop makes on every `timeupdate`. Kept as a pure, independently-testable
 * function so "does trimSilence being off really suppress the skip" is a
 * direct assertion, not an inference from the ranges list happening to be
 * empty.
 */
export function resolveSilenceAutoSkip(
  trimSilenceEnabled: boolean,
  ranges: SilenceRange[],
  positionSec: number,
): number | null {
  if (!trimSilenceEnabled) return null;
  return silenceSkipTarget(ranges, positionSec);
}

// ---------------------------------------------------------------------------
// Progressive, chunked analysis of a streamed episode enclosure
// ---------------------------------------------------------------------------

/** ~2-4 minutes of typical 64-128kbps spoken-word podcast audio per chunk.
 * Bounds every single `decodeAudioData` call so analysis never stalls the
 * main thread for more than a couple of seconds, even on a multi-hour
 * episode. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** ~25-50 minutes of audio depending on bitrate. When the server doesn't
 * honor byte-range requests, this is the ceiling under which a single
 * whole-file decode is still judged safe; above it, analysis bails rather
 * than risk hanging the tab decoding a multi-hour file in one shot. */
const SAFE_FULL_FETCH_BYTES = 25 * 1024 * 1024;

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Progressively analyzes a streamed episode enclosure for silence, without
 * requiring the whole file to be decoded up front.
 *
 * Scoping decision (honest-by-construction, per CLAUDE.md §3): decoding a
 * full 2-hour stereo episode in one `decodeAudioData` call can mean
 * 100+MB of compressed audio expanding to well over 1GB of Float32 PCM and
 * a multi-second main-thread stall before any range is ever found. Instead
 * this fetches the enclosure in bounded HTTP `Range` chunks (`CHUNK_BYTES`,
 * a few minutes of audio each), decodes and scans each chunk independently
 * via `scanBlockForSilence`, and reports ranges incrementally through
 * `onProgress` as they're found — so trim-silence starts working on the
 * part of the episode already analyzed while later chunks are still
 * downloading, and a long episode never blocks playback or the UI.
 *
 * If the server doesn't honor byte ranges, this only risks a single
 * whole-file decode when the file is small enough to be safe
 * (`SAFE_FULL_FETCH_BYTES`, checked via `Content-Length` *before* reading
 * the body); otherwise it bails honestly with whatever partial ranges (if
 * any) were already found, and trimSilence simply does nothing further for
 * that episode rather than hanging the tab.
 *
 * Container-based codecs (M4A/AAC-in-MP4) generally cannot be decoded from
 * an arbitrary mid-file byte range at all — the `moov` metadata box lives
 * outside the slice — so `decodeAudioData` on a later chunk will reject.
 * That's an honest degrade: analysis stops there with whatever was found
 * for MP3-style byte-stream codecs (which decode cleanly from any valid
 * frame boundary), never a fabricated range for the rest of the file.
 */
export async function analyzeEpisodeForSilence(
  audioUrl: string,
  onProgress: (ranges: SilenceRange[]) => void,
  opts: SilenceDetectOptions & { signal?: AbortSignal; chunkBytes?: number } = {},
): Promise<void> {
  const AudioCtx = getAudioContextCtor();
  if (!AudioCtx) return; // honest no-op — Web Audio unsupported in this environment
  const chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
  let ctx: AudioContext;
  try {
    ctx = new AudioCtx();
  } catch {
    return; // honest no-op — AudioContext construction failed (e.g. policy-blocked)
  }

  const allRanges: SilenceRange[] = [];
  let carry = newSilenceScanCarry();
  let timelineSec = 0;

  const decodeAndScan = async (buf: ArrayBuffer, blockStartSec: number): Promise<number> => {
    const audioBuffer = await ctx.decodeAudioData(buf);
    const scanned = scanBlockForSilence(audioBuffer.getChannelData(0), audioBuffer.sampleRate, blockStartSec, carry, opts);
    carry = scanned.carry;
    if (scanned.ranges.length > 0) {
      allRanges.push(...scanned.ranges);
      onProgress(allRanges.slice());
    }
    return audioBuffer.duration;
  };

  try {
    let start = 0;
    for (;;) {
      if (opts.signal?.aborted) return;
      const end = start + chunkBytes - 1;
      // Chunks are inherently sequential — each decode needs the timeline
      // offset accumulated from the last, so this loop cannot parallelize.
      const res = await fetch(audioUrl, { headers: { Range: `bytes=${start}-${end}` }, signal: opts.signal });
      if (res.status === 206) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) return;
        timelineSec += await decodeAndScan(buf, timelineSec);
        const contentRange = res.headers.get('content-range'); // "bytes start-end/total"
        const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
        const gotBytes = buf.byteLength;
        start += gotBytes;
        if (gotBytes < chunkBytes) return; // final (short) chunk
        if (isFinite(total) && start >= total) return;
      } else {
        // Server ignored the Range header (or the URL doesn't support
        // ranges). Only safe to proceed if we haven't consumed anything
        // yet and the whole file is small enough to decode in one pass.
        const len = Number(res.headers.get('content-length'));
        if (start === 0 && isFinite(len) && len > 0 && len <= SAFE_FULL_FETCH_BYTES) {
          const buf = await res.arrayBuffer();
          await decodeAndScan(buf, 0);
        } else if (res.body) {
          await res.body.cancel().catch(() => undefined);
        }
        return;
      }
    }
  } catch {
    // Network or decode failure mid-analysis (unsupported codec, aborted
    // fetch, CORS, a container-format chunk boundary, etc). Whatever
    // ranges were already found via `onProgress` stay valid and in use —
    // never fabricate the rest.
  } finally {
    try {
      void ctx.close();
    } catch {
      /* already closed */
    }
  }
}
