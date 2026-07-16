'use client';

// Shared Web Audio acoustic feature extraction for the voice lens.
//
// Originally lived only inside VoiceprintEnroll.tsx's captureVector(); the
// live-transcription path (VoiceLiveTranscribe.tsx) needs the identical
// extraction to attach a real per-segment vector to voice.live-append calls,
// so this module carries the ONE implementation both call sites share —
// never reimplement the math a second time with subtly different constants.
//
// Produces a 5-dim vector: [pitch, energy, spectralCentroid, zcr, spectralRolloff],
// each normalised into a roughly [0,1]-ish range for stable nearest-neighbour
// distances against server-side `voiceprint-enroll`/`voiceprint-identify`/
// `recording-auto-label-speakers` matching.
//
// Honesty contract: `captureVoiceFeatureVector` NEVER fabricates a vector. If
// the browser has no mic API, no Web Audio API, or the user denies/loses mic
// access, it resolves to `null` — callers must treat null as "skip attaching
// a vector for this sample", never invent one.

export interface FrameAccumulator {
  pitch: number;
  energy: number;
  centroid: number;
  zcr: number;
  rolloff: number;
  n: number;
}

/** A fresh, zeroed accumulator. */
export function emptyAccumulator(): FrameAccumulator {
  return { pitch: 0, energy: 0, centroid: 0, zcr: 0, rolloff: 0, n: 0 };
}

/**
 * Folds one analysis frame's features into `acc` (mutates + returns it).
 * Pure with respect to its inputs — no AnalyserNode/AudioContext access — so
 * it can be exercised directly in tests with synthetic frequency/time data.
 */
export function accumulateFrame(
  acc: FrameAccumulator,
  freq: Float32Array,
  time: Float32Array,
  nyquist: number,
): FrameAccumulator {
  // Energy (RMS) of the time-domain signal.
  let rms = 0;
  for (let i = 0; i < time.length; i++) rms += time[i] * time[i];
  rms = Math.sqrt(rms / time.length);
  // Zero-crossing rate.
  let zc = 0;
  for (let i = 1; i < time.length; i++) if ((time[i - 1] < 0) !== (time[i] < 0)) zc++;
  // Spectral centroid + total magnitude (linear, from dB bins).
  let magSum = 0, weighted = 0, peakMag = 0, peakBin = 0;
  const lin: number[] = new Array(freq.length);
  for (let i = 0; i < freq.length; i++) {
    const m = Math.pow(10, freq[i] / 20);
    lin[i] = m;
    magSum += m;
    weighted += m * i;
    if (m > peakMag) { peakMag = m; peakBin = i; }
  }
  // Spectral rolloff: bin holding 85% of cumulative energy.
  let cum = 0, rollBin = 0;
  const target = magSum * 0.85;
  for (let i = 0; i < lin.length; i++) { cum += lin[i]; if (cum >= target) { rollBin = i; break; } }
  acc.pitch += (peakBin / freq.length) * nyquist;
  acc.energy += rms;
  acc.centroid += magSum > 0 ? (weighted / magSum / freq.length) * nyquist : 0;
  acc.zcr += zc / time.length;
  acc.rolloff += (rollBin / freq.length) * nyquist;
  acc.n++;
  return acc;
}

/** Reduces an accumulator into the final normalised 5-dim feature vector. */
export function finalizeVector(acc: FrameAccumulator): number[] {
  const n = Math.max(1, acc.n);
  return [
    Math.round((acc.pitch / n / 4000) * 1000) / 1000,
    Math.round(Math.min(1, (acc.energy / n) * 10) * 1000) / 1000,
    Math.round((acc.centroid / n / 4000) * 1000) / 1000,
    Math.round((acc.zcr / n) * 1000) / 1000,
    Math.round((acc.rolloff / n / 8000) * 1000) / 1000,
  ];
}

function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Records `sampleMs` of mic audio and reduces it to the shared 5-dim
 * acoustic feature vector. Returns `null` — never a placeholder/random
 * vector — when the browser has no mic/Web-Audio API or the user denies
 * mic permission; callers must honor that as "no vector" rather than
 * fabricate one.
 */
export async function captureVoiceFeatureVector(sampleMs = 3000): Promise<number[] | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  const AudioCtx = resolveAudioContextCtor();
  if (!AudioCtx) return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }

  const ctx = new AudioCtx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const freq = new Float32Array(analyser.frequencyBinCount);
  const time = new Float32Array(analyser.fftSize);
  const acc = emptyAccumulator();
  const nyquist = ctx.sampleRate / 2;

  await new Promise<void>((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      analyser.getFloatFrequencyData(freq);
      analyser.getFloatTimeDomainData(time);
      accumulateFrame(acc, freq, time, nyquist);
      if (Date.now() - t0 < sampleMs) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  stream.getTracks().forEach(t => t.stop());
  await ctx.close();
  return finalizeVector(acc);
}
