'use client';

// concord-frontend/components/conkay/useConKayVoice.ts
//
// ConKay is voice-native: the moment the mode is active, speech-to-text listens
// and text-to-speech speaks replies in a calm female voice. Built on the Web
// Speech API (no dependency, no key). Degrades gracefully where unsupported
// (the mode still works by typing). TTS pauses STT so ConKay doesn't hear itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONKAY_VOICE_HINTS, CONKAY_VOICE_ID } from './conkay-persona';
import { speakWithPiperOrFallback, type PiperPlaybackHandle } from '@/lib/voice/piper-stream';
import { createMediaRecorderSTT, mediaRecorderSupported, type MediaRecorderSTTHandle } from '@/lib/voice/mediarecorder-stt';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

function getSpeechRecognition(): SR | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function pickChillFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  for (const hint of CONKAY_VOICE_HINTS) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (hit) return hit;
  }
  return pool[0] || voices[0] || null;
}

export interface ConKayVoice {
  supported: boolean;
  listening: boolean;
  speaking: boolean;
  /** Live partial transcript while the user is mid-sentence ("hearing you…"). */
  interim: string;
  /** True when this browser has no Web Speech STT and is using the server
   *  (Whisper) fallback — or has no mic STT path at all (type instead). */
  usingServerStt: boolean;
  /** Set if the server STT route is unconfigured/unreachable — UI can hint
   *  "voice transcription unavailable here, type instead." */
  voiceUnavailable: boolean;
  /**
   * Live 0..1 amplitude envelope of ConKay's OWN speech while `speaking` is
   * true, sampled every animation frame from the real playback via
   * `PiperPlaybackHandle#getEnvelopeAt` (Piper: real decoded-audio bins; the
   * Web-Speech fallback path returns its own pre-existing synthetic-square
   * stub — honestly passed through, not something this hook fabricates on
   * top of). A ref (not state) so consumers can read it in a per-frame loop
   * (e.g. the Three.js scene) without forcing React re-renders — same
   * pattern as `useMicAmplitude`. Always 0 while not speaking.
   */
  ttsAmplitudeRef: React.MutableRefObject<number>;
  speak: (text: string) => void;
  cancelSpeak: () => void;
}

export function useConKayVoice(opts: {
  enabled: boolean;
  muted: boolean;
  onFinalTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
}): ConKayVoice {
  const { enabled, muted, onFinalTranscript, onInterim } = opts;
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const recogRef = useRef<SR | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const pipeHandleRef = useRef<PiperPlaybackHandle | null>(null);
  const mrSttRef = useRef<MediaRecorderSTTHandle | null>(null);
  const speakingRef = useRef(false);
  // Wall-clock time (performance.now(), ms) the current utterance started —
  // lets the envelope sampler below compute "how far into playback are we"
  // without depending on the audio element/buffer's own clock.
  const speechStartRef = useRef(0);
  // Live envelope of ConKay's own speech (see ConKayVoice#ttsAmplitudeRef).
  const ttsAmplitudeRef = useRef(0);
  const wantListenRef = useRef(false);     // Web Speech auto-restart intent
  const wantFallbackRef = useRef(false);   // server-STT fallback intent
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  const SRClass = typeof window !== 'undefined' ? getSpeechRecognition() : null;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  // When the browser lacks Web Speech STT (Firefox et al.) but can record, we
  // fall back to the server (Whisper) transcription route. supported is true if
  // ANY voice path exists (so the mode still offers voice, not just typing).
  const webSpeechSupported = !!SRClass;
  const serverSttSupported = !webSpeechSupported && typeof window !== 'undefined' && mediaRecorderSupported();
  const supported = webSpeechSupported || ttsSupported || serverSttSupported;

  // Resolve the TTS voice (voices load async on some browsers).
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => { voiceRef.current = pickChillFemaleVoice(window.speechSynthesis.getVoices()); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { try { window.speechSynthesis.onvoiceschanged = null; } catch { /* noop */ } };
  }, [ttsSupported]);

  const startListening = useCallback(() => {
    if (!SRClass || speakingRef.current) return;
    if (recogRef.current) return; // already running
    try {
      const r: SR = new SRClass();
      r.lang = 'en-US';
      // Continuous + interim → seamless hands-free turn-taking: recognition stays
      // open across pauses instead of ending after one phrase, and partials drive
      // a live "hearing you…" indicator.
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e: any) => {
        let finalText = '';
        let interimText = '';
        for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
          const res = e.results[i];
          const txt = res?.[0]?.transcript || '';
          if (res.isFinal) finalText += txt;
          else interimText += txt;
        }
        if (interimText) { setInterim(interimText); onInterimRef.current?.(interimText); }
        const t = finalText.trim();
        if (t) { setInterim(''); onFinalRef.current(t); }
      };
      r.onend = () => {
        recogRef.current = null;
        setListening(false);
        // auto-restart unless we're speaking or disabled/muted
        if (wantListenRef.current && !speakingRef.current) {
          setTimeout(() => { if (wantListenRef.current && !speakingRef.current) startListening(); }, 350);
        }
      };
      r.onerror = () => { recogRef.current = null; setListening(false); };
      recogRef.current = r;
      r.start();
      setListening(true);
    } catch { recogRef.current = null; setListening(false); }
  }, [SRClass]);

  const stopListening = useCallback(() => {
    const r = recogRef.current;
    recogRef.current = null;
    setListening(false);
    setInterim('');
    try { r?.stop?.(); } catch { /* noop */ }
  }, []);

  // Server-STT (Whisper) fallback for browsers without Web Speech. Continuous +
  // hands-free internally (segments utterances by trailing silence).
  const startFallbackListening = useCallback(() => {
    if (mrSttRef.current || speakingRef.current) return;
    const h = createMediaRecorderSTT({
      onTranscript: (t) => { setInterim(''); onFinalRef.current(t); },
      onUnavailable: () => setVoiceUnavailable(true),
    });
    mrSttRef.current = h;
    h.start().then((ok) => {
      if (ok) setListening(true);
      else { mrSttRef.current = null; setListening(false); setVoiceUnavailable(true); }
    });
  }, []);

  const stopFallbackListening = useCallback(() => {
    try { mrSttRef.current?.stop(); } catch { /* noop */ }
    mrSttRef.current = null;
    setListening(false);
  }, []);

  const cancelSpeak = useCallback(() => {
    try { pipeHandleRef.current?.cancel(); } catch { /* noop */ }
    pipeHandleRef.current = null;
    if (ttsSupported) { try { window.speechSynthesis.cancel(); } catch { /* noop */ } }
    speakingRef.current = false;
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback((text: string) => {
    if (muted || !text) return;
    // Strip the conkay-viz block + heavy markdown so speech stays clean.
    const clean = text
      .replace(/```conkay-viz[\s\S]*?```/gi, '')
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/[#*_`>]/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
    if (!clean) return;
    // Real audio out: Piper TTS (server-rendered audio via the existing
    // voice.tts pipeline) → consistent voice across browsers; automatically
    // falls back to the Web Speech API when Piper is unreachable/slow.
    stopListening();         // don't hear ourselves (Web Speech)
    stopFallbackListening(); // ...nor via the server-STT fallback
    try { pipeHandleRef.current?.cancel(); } catch { /* noop */ }
    speakWithPiperOrFallback(clean, { rate: 0.98, pitch: 1.0, voice: CONKAY_VOICE_ID }, {
      onStart: () => { speechStartRef.current = performance.now(); speakingRef.current = true; setSpeaking(true); },
      onEnd: () => {
        speakingRef.current = false; setSpeaking(false);
        pipeHandleRef.current = null;
        if (wantListenRef.current) setTimeout(() => startListening(), 250);
        else if (wantFallbackRef.current) setTimeout(() => startFallbackListening(), 250);
      },
    }).then((h) => { pipeHandleRef.current = h; }).catch(() => {
      speakingRef.current = false; setSpeaking(false);
    });
  }, [muted, stopListening, startListening, stopFallbackListening, startFallbackListening]);

  // Sample ConKay's own speech envelope every animation frame while she's
  // actually speaking — mirrors `useMicAmplitude`'s ref+rAF pattern (never
  // React state in the loop). The value is REAL: it comes from
  // `pipeHandleRef.current.getEnvelopeAt(elapsedSeconds)`, i.e. amplitude
  // bins computed from the decoded Piper audio buffer at playback time (or
  // the pre-existing Web-Speech synthetic stub when Piper wasn't used — that
  // degradation already exists in piper-stream.ts and isn't something this
  // hook adds fakery on top of). Never a setInterval/setTimeout.
  useEffect(() => {
    if (!speaking) { ttsAmplitudeRef.current = 0; return; }
    let raf = 0;
    const tick = () => {
      const elapsedS = (performance.now() - speechStartRef.current) / 1000;
      ttsAmplitudeRef.current = pipeHandleRef.current?.getEnvelopeAt(elapsedS) ?? 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ttsAmplitudeRef.current = 0; };
  }, [speaking]);

  // Drive listening from enabled/muted: Web Speech where available, else the
  // server-STT fallback, else nothing (typing still works).
  useEffect(() => {
    const useWebSpeech = enabled && !muted && webSpeechSupported;
    const useFallback = enabled && !muted && !webSpeechSupported && serverSttSupported;
    wantListenRef.current = useWebSpeech;
    wantFallbackRef.current = useFallback;
    if (useWebSpeech) startListening(); else stopListening();
    if (useFallback) startFallbackListening(); else stopFallbackListening();
    if (!enabled) cancelSpeak();
    return () => { stopListening(); stopFallbackListening(); };
  }, [enabled, muted, webSpeechSupported, serverSttSupported, startListening, stopListening, startFallbackListening, stopFallbackListening, cancelSpeak]);

  // Cancel any speech + release the mic on unmount.
  useEffect(() => () => { cancelSpeak(); stopListening(); stopFallbackListening(); }, [cancelSpeak, stopListening, stopFallbackListening]);

  return { supported, listening, speaking, interim, usingServerStt: serverSttSupported, voiceUnavailable, ttsAmplitudeRef, speak, cancelSpeak };
}

export default useConKayVoice;
