'use client';

// concord-frontend/components/conkay/useConKayVoice.ts
//
// ConKay is voice-native: the moment the mode is active, speech-to-text listens
// and text-to-speech speaks replies in a calm female voice. Built on the Web
// Speech API (no dependency, no key). Degrades gracefully where unsupported
// (the mode still works by typing). TTS pauses STT so ConKay doesn't hear itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONKAY_VOICE_HINTS } from './conkay-persona';

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
  speak: (text: string) => void;
  cancelSpeak: () => void;
}

export function useConKayVoice(opts: {
  enabled: boolean;
  muted: boolean;
  onFinalTranscript: (text: string) => void;
}): ConKayVoice {
  const { enabled, muted, onFinalTranscript } = opts;
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recogRef = useRef<SR | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speakingRef = useRef(false);
  const wantListenRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;

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
      r.continuous = false;
      r.interimResults = false;
      r.onresult = (e: any) => {
        const t = e?.results?.[0]?.[0]?.transcript?.trim();
        if (t) onFinalRef.current(t);
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
    try { r?.stop?.(); } catch { /* noop */ }
  }, []);

  const cancelSpeak = useCallback(() => {
    if (!ttsSupported) return;
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    speakingRef.current = false;
    setSpeaking(false);
  }, [ttsSupported]);

  const speak = useCallback((text: string) => {
    if (!ttsSupported || muted || !text) return;
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
    try {
      stopListening(); // don't hear ourselves
      const u = new SpeechSynthesisUtterance(clean);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 0.98; u.pitch = 1.0; u.volume = 1.0; // chill cadence
      u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
      u.onend = () => {
        speakingRef.current = false; setSpeaking(false);
        if (wantListenRef.current) setTimeout(() => startListening(), 250);
      };
      u.onerror = () => { speakingRef.current = false; setSpeaking(false); };
      window.speechSynthesis.speak(u);
    } catch { speakingRef.current = false; setSpeaking(false); }
  }, [ttsSupported, muted, stopListening, startListening]);

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

  return { supported, listening, speaking, speak, cancelSpeak };
}

export default useConKayVoice;
