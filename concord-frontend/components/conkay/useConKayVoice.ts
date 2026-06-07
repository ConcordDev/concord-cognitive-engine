'use client';

// concord-frontend/components/conkay/useConKayVoice.ts
//
// ConKay is voice-native: the moment the mode is active, speech-to-text listens
// and text-to-speech speaks replies in a calm female voice. Built on the Web
// Speech API (no dependency, no key). Degrades gracefully where unsupported
// (the mode still works by typing). TTS pauses STT so ConKay doesn't hear itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONKAY_VOICE_HINTS } from './conkay-persona';
import { speakWithPiperOrFallback, type PiperPlaybackHandle } from '@/lib/voice/piper-stream';

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
  const recogRef = useRef<SR | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const pipeHandleRef = useRef<PiperPlaybackHandle | null>(null);
  const speakingRef = useRef(false);
  const wantListenRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  const SRClass = typeof window !== 'undefined' ? getSpeechRecognition() : null;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const supported = !!SRClass || ttsSupported;

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
    stopListening(); // don't hear ourselves
    try { pipeHandleRef.current?.cancel(); } catch { /* noop */ }
    speakWithPiperOrFallback(clean, { rate: 0.98, pitch: 1.0 }, {
      onStart: () => { speakingRef.current = true; setSpeaking(true); },
      onEnd: () => {
        speakingRef.current = false; setSpeaking(false);
        pipeHandleRef.current = null;
        if (wantListenRef.current) setTimeout(() => startListening(), 250);
      },
    }).then((h) => { pipeHandleRef.current = h; }).catch(() => {
      speakingRef.current = false; setSpeaking(false);
    });
  }, [muted, stopListening, startListening]);

  // Drive listening from enabled/muted.
  useEffect(() => {
    wantListenRef.current = enabled && !muted && !!SRClass;
    if (enabled && !muted && SRClass) {
      startListening();
    } else {
      stopListening();
    }
    if (!enabled) cancelSpeak();
    return () => { stopListening(); };
  }, [enabled, muted, SRClass, startListening, stopListening, cancelSpeak]);

  // Cancel any speech on unmount.
  useEffect(() => () => { cancelSpeak(); stopListening(); }, [cancelSpeak, stopListening]);

  return { supported, listening, speaking, interim, speak, cancelSpeak };
}

export default useConKayVoice;
