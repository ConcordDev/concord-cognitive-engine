'use client';

// Cross-browser speech-to-text fallback for ConKay.
//
// The Web Speech API (SpeechRecognition) only exists in Chrome/Edge/Safari —
// Firefox and some embedded webviews have no STT at all, which left ConKay
// voice-deaf there. This is the fallback: capture the mic with MediaRecorder,
// segment utterances by trailing silence (an energy analyser, same RMS pattern
// as lib/voice/vad.ts), and POST each segment to the existing server route
// `/api/voice/transcribe-raw` (Whisper). It is hands-free + continuous, mirroring
// the Web Speech UX.
//
// Honest dependency: the server route needs WHISPER_CPP_BIN configured, exactly
// like the chat brains need Ollama. When it's not configured (or transcription
// fails), `onUnavailable` fires once and the caller falls back to typing — no
// fake transcript is ever produced.
//
// Privacy: mic access is browser-prompted; the stream stops the moment stop()
// is called; audio is sent only to Concord's own transcription endpoint.

export interface MediaRecorderSTTHandle {
  start: () => Promise<boolean>;
  stop: () => void;
  isActive: () => boolean;
}

export interface MediaRecorderSTTOptions {
  onTranscript: (text: string) => void;
  /** Fired once when server STT is unavailable (not configured / failed). */
  onUnavailable?: () => void;
  apiBase?: string;
  /** RMS energy (0..1) above which we consider the user to be speaking. */
  threshold?: number;
  /** Trailing silence that ends an utterance. Default 900ms. */
  silenceMs?: number;
  /** Ignore blips shorter than this (clicks, coughs). Default 350ms. */
  minSpeechMs?: number;
}

export function mediaRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

export function createMediaRecorderSTT(opts: MediaRecorderSTTOptions): MediaRecorderSTTHandle {
  const threshold = opts.threshold ?? 0.045;
  const silenceMs = opts.silenceMs ?? 900;
  const minSpeechMs = opts.minSpeechMs ?? 350;
  const apiBase = opts.apiBase ?? (process.env.NEXT_PUBLIC_API_URL || '');

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let dataArray: Uint8Array | null = null;
  let rafId: number | null = null;
  let active = false;
  let unavailableSignalled = false;

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let speaking = false;
  let speechStartedAt = 0;
  let belowSince = 0;

  const pickMime = (): string => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of candidates) {
      try { if (window.MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
    }
    return '';
  };

  const beginUtterance = () => {
    if (!stream || recorder) return;
    chunks = [];
    const mimeType = pickMime();
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      recorder = null;
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const collected = chunks;
      chunks = [];
      const type = recorder?.mimeType || 'audio/webm';
      recorder = null;
      if (!collected.length) return;
      const blob = new Blob(collected, { type });
      // Drop sub-1KB blobs — almost certainly silence/noise, not speech.
      if (blob.size < 1024) return;
      void postForTranscript(blob);
    };
    try { recorder.start(); } catch { recorder = null; }
  };

  const endUtterance = () => {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { recorder = null; }
    }
  };

  const postForTranscript = async (blob: Blob) => {
    try {
      const res = await fetch(`${apiBase}/api/voice/transcribe-raw`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      const transcript = json?.ok ? String(json.transcript || '').trim() : '';
      if (transcript) {
        opts.onTranscript(transcript);
      } else if (!unavailableSignalled) {
        // Server STT not configured / produced nothing — tell the caller once
        // so it can surface "voice transcription unavailable, type instead".
        unavailableSignalled = true;
        opts.onUnavailable?.();
      }
    } catch {
      if (!unavailableSignalled) { unavailableSignalled = true; opts.onUnavailable?.(); }
    }
  };

  const tick = () => {
    if (!active || !analyser || !dataArray) return;
    (analyser as { getByteFrequencyData: (a: Uint8Array) => void }).getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const energy = sum / dataArray.length / 255;
    const now = performance.now();

    if (energy > threshold) {
      belowSince = 0;
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        beginUtterance();
      }
    } else if (speaking) {
      if (belowSince === 0) belowSince = now;
      if (now - belowSince >= silenceMs) {
        const spokeLongEnough = now - speechStartedAt >= minSpeechMs;
        speaking = false;
        belowSince = 0;
        if (spokeLongEnough) endUtterance();
        else { try { recorder?.stop(); } catch { /* ignore */ } recorder = null; chunks = []; }
      }
    }

    rafId = requestAnimationFrame(tick);
  };

  const start = async (): Promise<boolean> => {
    if (active) return true;
    if (!mediaRecorderSupported()) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      active = true;
      speaking = false;
      belowSince = 0;
      tick();
      return true;
    } catch {
      stop();
      return false;
    }
  };

  const stop = (): void => {
    active = false;
    speaking = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    recorder = null;
    chunks = [];
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      stream = null;
    }
    if (audioContext) {
      try { void audioContext.close(); } catch { /* ignore */ }
      audioContext = null;
    }
    analyser = null;
    dataArray = null;
  };

  return { start, stop, isActive: () => active };
}
