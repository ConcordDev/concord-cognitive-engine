'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { callBrowserAgentMacro } from '@/lib/api/browser-agent';

interface SpeechRec extends EventTarget {
  start: () => void; stop: () => void;
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface Props { onCreated: () => void; }

export function BrowserVoiceTask({ onCreated }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const transcriptRef = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const stop = useCallback(async () => {
    try { recRef.current?.stop(); } catch { /* ok */ }
    setRecording(false);
    const transcript = transcriptRef.current.trim();
    transcriptRef.current = '';
    if (!transcript) return;
    setBusy(true);
    try {
      const r = await callBrowserAgentMacro<{ ok?: boolean; created?: { id: string } }>('ai_voice_task', { transcript, autoCreate: true });
      if (r.ok && r.created?.id) onCreated();
    } finally { setBusy(false); }
  }, [onCreated]);

  const start = useCallback(() => {
    if (!supported) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true; rec.interimResults = false;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    transcriptRef.current = '';
    rec.onresult = (e) => {
      const results = e.results as unknown as { isFinal: boolean; 0: { transcript: string } }[];
      for (let i = 0; i < results.length; i++) {
        if (results[i]?.isFinal) transcriptRef.current += (transcriptRef.current ? ' ' : '') + results[i][0].transcript;
      }
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => { if (recRef.current === rec && recording) { try { rec.start(); } catch { setRecording(false); } } };
    recRef.current = rec;
    try { rec.start(); setRecording(true); } catch { setRecording(false); }
  }, [supported, recording]);

  return (
    <button
      onClick={recording ? stop : start}
      disabled={!supported || busy}
      className={`p-1.5 rounded hover:bg-white/10 ${recording ? 'text-red-400 animate-pulse' : 'text-white/70 hover:text-white'} disabled:opacity-40`}
      title={!supported ? 'Voice needs Chrome/Edge (Web Speech API)' : recording ? 'Stop dictation' : 'Voice → browser task'}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> :
        recording ? <MicOff className="w-4 h-4" /> :
        <Mic className="w-4 h-4" />}
    </button>
  );
}
