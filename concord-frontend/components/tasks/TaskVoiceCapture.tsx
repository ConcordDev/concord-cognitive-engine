'use client';

/**
 * TaskVoiceCapture — Todoist Ramble parity. Mic button captures
 * dictation via Web Speech API; on stop, sends transcript to
 * ai_voice_to_task which auto-creates tasks in the current project.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { callTasksMacro } from '@/lib/api/tasks';

interface SpeechRec extends EventTarget {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: { isFinal: boolean; 0: { transcript: string } }[][] | { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface Props { projectId: string | null; onCreated: () => void; }

export function TaskVoiceCapture({ projectId, onCreated }: Props) {
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
    if (!transcript || !projectId) return;
    setBusy(true);
    try {
      const r = await callTasksMacro<{ ok?: boolean; created?: unknown[] }>('ai_voice_to_task', {
        projectId, transcript, autoCreate: true,
      });
      if (r.ok && r.created && r.created.length > 0) onCreated();
    } finally { setBusy(false); }
  }, [projectId, onCreated]);

  const start = useCallback(() => {
    if (!supported || !projectId) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    transcriptRef.current = '';
    rec.onresult = (e) => {
      const results = e.results as unknown as { isFinal: boolean; 0: { transcript: string } }[];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r?.isFinal) transcriptRef.current += (transcriptRef.current ? ' ' : '') + r[0].transcript;
      }
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => { if (recRef.current === rec && recording) { try { rec.start(); } catch { setRecording(false); } } };
    recRef.current = rec;
    try { rec.start(); setRecording(true); } catch { setRecording(false); }
  }, [supported, projectId, recording]);

  return (
    <button
      onClick={recording ? stop : start}
      disabled={!supported || busy || !projectId}
      className={`p-1.5 rounded hover:bg-white/10 ${recording ? 'text-red-400 animate-pulse' : 'text-white/70 hover:text-white'} disabled:opacity-40`}
      title={!supported ? 'Voice needs Chrome/Edge (Web Speech API)' : !projectId ? 'Pick a project first' : recording ? 'Stop dictation' : 'Voice → tasks'}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" />
        : recording ? <MicOff className="w-4 h-4" />
        : <Mic className="w-4 h-4" />}
    </button>
  );
}
