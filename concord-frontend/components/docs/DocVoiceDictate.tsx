'use client';

/**
 * DocVoiceDictate — browser-side Web Speech API + server-side
 * punctuation polish. Tana / Notion-style mic button: click to start
 * dictating, click again to stop, transcript is inserted at the
 * cursor with LLM-cleaned punctuation when available.
 *
 * Falls back gracefully when SpeechRecognition is missing (Firefox)
 * — button is rendered disabled with an explanatory tooltip.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { callDocsMacro } from '@/lib/api/docs';

interface Props {
  documentId: string | null;
  onTranscript: (html: string) => void;
}

interface SpeechRecognitionLike extends EventTarget {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: { isFinal: boolean; 0: { transcript: string } }[][] | { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export function DocVoiceDictate({ documentId, onTranscript }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    setSupported(!!Ctor);
  }, []);

  const stop = useCallback(async () => {
    try { recRef.current?.stop(); } catch { /* ok */ }
    setRecording(false);
    const transcript = transcriptRef.current.trim();
    transcriptRef.current = '';
    if (!transcript) return;
    setBusy(true);
    try {
      const r = await callDocsMacro<{ html?: string; text?: string }>('voice_transcribe', {
        documentId, transcript, punctuate: true,
      });
      if (r?.ok && (r.html || r.text)) {
        onTranscript(r.html || `<p>${r.text}</p>`);
      } else {
        // Even if macro fails (e.g. no doc), insert the raw transcript
        onTranscript(`<p>${transcript}</p>`);
      }
    } catch {
      onTranscript(`<p>${transcript}</p>`);
    } finally {
      setBusy(false);
    }
  }, [documentId, onTranscript]);

  const start = useCallback(() => {
    if (!supported) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    transcriptRef.current = '';
    rec.onresult = (e) => {
      const results = (e.results as unknown) as { isFinal: boolean; 0: { transcript: string } }[];
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res?.isFinal) {
          transcriptRef.current += (transcriptRef.current ? ' ' : '') + res[0].transcript;
        }
      }
    };
    rec.onerror = () => { setRecording(false); };
    rec.onend = () => {
      if (recRef.current === rec && recording) {
        // auto-restart if still in recording state (some browsers timeout)
        try { rec.start(); } catch { setRecording(false); }
      }
    };
    recRef.current = rec;
    try { rec.start(); setRecording(true); } catch { setRecording(false); }
  }, [supported, recording]);

  const onClick = () => recording ? stop() : start();

  return (
    <button
      onClick={onClick}
      disabled={!supported || busy}
      className={`p-1.5 rounded hover:bg-white/10 ${
        recording ? 'text-red-400 animate-pulse' : 'text-white/70 hover:text-white'
      } disabled:opacity-40`}
      title={!supported ? 'Voice dictation needs Chrome/Edge (Web Speech API)' : recording ? 'Stop dictation' : 'Start voice dictation'}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" />
        : recording ? <MicOff className="w-4 h-4" />
        : <Mic className="w-4 h-4" />}
    </button>
  );
}
