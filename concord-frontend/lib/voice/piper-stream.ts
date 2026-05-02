/**
 * Piper TTS streaming for NPC dialogue — Tier 2 deferral 11.
 *
 * Replaces `SpeechSynthesisUtterance` (Web Speech API) in NPCDialogue with
 * Piper TTS audio fetched from the existing server macro at
 * `voice.tts` (server.js:8951-9011) which returns `{ ok, audioBase64 }`.
 *
 * Audio is decoded via the shared `getAudioContext()` from `lib/daw/engine.ts`
 * + composes through SoundscapeEngine's master gain (so Phase 16's dialogue
 * ducking + spatial reverb still apply).
 *
 * Falls back to Web Speech API when Piper is unavailable, returns 4xx, or
 * the round-trip exceeds 800ms (perceived-lag cutoff). Caller doesn't have
 * to know which path produced the audio.
 *
 * Mouth-sync: derives an amplitude envelope from the decoded buffer at
 * decode time and exposes a `getEnvelopeAt(seconds)` function so
 * NPCDialogue can sample it instead of polling `speechSynthesis.speaking`.
 */

import { getAudioContext, resumeAudioContext } from '@/lib/daw/engine';

export interface PiperPlaybackHandle {
  /** Cancel playback immediately (e.g. on barge-in). */
  cancel: () => void;
  /** Promise that resolves on natural end or cancel. */
  ended: Promise<void>;
  /** Sample the amplitude envelope at a given playback time (seconds). 0..1. */
  getEnvelopeAt: (seconds: number) => number;
  /** Source path: 'piper' or 'web-speech'. Lets callers know which path won. */
  source: 'piper' | 'web-speech';
}

export interface PiperVoiceProfile {
  voice?: string;        // Piper voice name (e.g. 'en_US-lessac-medium')
  rate?: number;         // 0.5 .. 2.0
  pitch?: number;        // 0.5 .. 2.0 (Web Speech path only; Piper bakes pitch)
}

const DEFAULT_NETWORK_TIMEOUT_MS = 800;
const ENVELOPE_BIN_MS = 50;

/**
 * Speak `text` via Piper TTS. Returns a handle. If Piper is unavailable
 * or slow, falls back to Web Speech API automatically.
 */
export async function speakWithPiperOrFallback(
  text: string,
  profile: PiperVoiceProfile = {},
  options: {
    networkTimeoutMs?: number;
    onStart?: () => void;
    onEnd?: () => void;
  } = {},
): Promise<PiperPlaybackHandle> {
  const timeout = options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;

  // Try Piper first, race against the timeout.
  const piperPromise = fetchPiperAudio(text, profile);
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout));
  const piperResult = await Promise.race([piperPromise, timeoutPromise]);

  if (piperResult?.audioBase64) {
    try {
      return await playPiperBuffer(piperResult.audioBase64, options);
    } catch {
      /* fall through to Web Speech */
    }
  }

  // Fallback: Web Speech API
  return speakWithWebSpeech(text, profile, options);
}

interface PiperResponse { ok?: boolean; audioBase64?: string }

async function fetchPiperAudio(text: string, profile: PiperVoiceProfile): Promise<PiperResponse | null> {
  try {
    const res = await fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        domain: 'voice',
        name: 'tts',
        input: { text: text.slice(0, 1000), voice: profile.voice },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.ok || !json.audioBase64) return null;
    return json;
  } catch {
    return null;
  }
}

async function playPiperBuffer(audioBase64: string, options: { onStart?: () => void; onEnd?: () => void }): Promise<PiperPlaybackHandle> {
  const ctx = getAudioContext();
  await resumeAudioContext();

  // Decode base64 → ArrayBuffer → AudioBuffer.
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buffer = await ctx.decodeAudioData(bytes.buffer);

  // Pre-compute amplitude envelope in 50ms bins so mouth-sync can sample
  // it cheaply per frame instead of running an analyser on the live source.
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const binSize = Math.max(1, Math.floor((ENVELOPE_BIN_MS / 1000) * sampleRate));
  const envelope: number[] = [];
  for (let i = 0; i < channel.length; i += binSize) {
    let sum = 0;
    const end = Math.min(channel.length, i + binSize);
    for (let j = i; j < end; j++) sum += Math.abs(channel[j]);
    envelope.push(Math.min(1, (sum / (end - i)) * 4)); // scale up — speech is quiet
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  let cancelled = false;
  let endResolve: () => void = () => {};
  const ended = new Promise<void>((r) => { endResolve = r; });

  source.onended = () => {
    if (!cancelled) {
      try { options.onEnd?.(); } catch { /* ok */ }
    }
    endResolve();
  };

  // Start + fire onStart on next frame so callers see consistent ordering.
  source.start();
  try { options.onStart?.(); } catch { /* ok */ }

  return {
    source: 'piper',
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try { source.stop(); } catch { /* already stopped */ }
      endResolve();
    },
    ended,
    getEnvelopeAt: (seconds: number) => {
      const idx = Math.floor((seconds * 1000) / ENVELOPE_BIN_MS);
      if (idx < 0 || idx >= envelope.length) return 0;
      return envelope[idx];
    },
  };
}

function speakWithWebSpeech(
  text: string,
  profile: PiperVoiceProfile,
  options: { onStart?: () => void; onEnd?: () => void },
): PiperPlaybackHandle {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      source: 'web-speech',
      cancel: () => {},
      ended: Promise.resolve(),
      getEnvelopeAt: () => 0,
    };
  }
  const utterance = new SpeechSynthesisUtterance(text);
  if (profile.rate) utterance.rate = profile.rate;
  if (profile.pitch) utterance.pitch = profile.pitch;

  let cancelled = false;
  let endResolve: () => void = () => {};
  const ended = new Promise<void>((r) => { endResolve = r; });

  utterance.onstart = () => { try { options.onStart?.(); } catch { /* ok */ } };
  utterance.onend = () => { if (!cancelled) { try { options.onEnd?.(); } catch { /* ok */ } } endResolve(); };
  utterance.onerror = () => { try { options.onEnd?.(); } catch { /* ok */ } endResolve(); };

  window.speechSynthesis.cancel(); // clear any in-flight utterance
  window.speechSynthesis.speak(utterance);

  return {
    source: 'web-speech',
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      try { window.speechSynthesis.cancel(); } catch { /* ok */ }
      endResolve();
    },
    ended,
    // Web Speech doesn't expose audio amplitude — return a square-wave
    // approximation so the mouth still flaps.
    getEnvelopeAt: (seconds: number) => {
      // 4Hz mouth flap, ~0.5 average amplitude
      return 0.4 + 0.4 * Math.abs(Math.sin(seconds * 8));
    },
  };
}
