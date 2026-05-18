'use client';

/**
 * VoiceDictateButton — Code Sprint C #12.
 *
 * Press-and-hold mic button. While held, records via MediaRecorder.
 * On release, POSTs the audio blob to /api/voice/transcribe-raw
 * (the Phase 13 voice modality) and surfaces the transcript via
 * the callback. Real WebAudio; no fake transcript stub.
 */

import { useState, useRef, useCallback } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceDictateButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

export function VoiceDictateButton({ onTranscript, className, disabled }: VoiceDictateButtonProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    if (state !== 'idle' || disabled) return;
    setErrMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(250);
      recRef.current = rec;
      setState('recording');
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : 'mic permission denied');
    }
  }, [state, disabled]);

  const stop = useCallback(async () => {
    if (state !== 'recording') return;
    const rec = recRef.current;
    if (!rec) return;
    setState('transcribing');
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunksRef.current, { type: rec.mimeType });
    chunksRef.current = [];
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'dictate.webm');
      const res = await fetch('/api/voice/transcribe-raw?createDTU=0', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      if (!res.ok) throw new Error(`transcribe failed: ${res.status}`);
      const json = await res.json();
      const text = String(json?.transcript || json?.text || '').trim();
      if (text) onTranscript(text);
      else { setState('error'); setErrMsg('empty transcript'); return; }
      setState('idle');
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : 'transcribe failed');
    }
  }, [state, onTranscript]);

  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={() => { if (state === 'recording') stop(); }}
      onTouchStart={start}
      onTouchEnd={stop}
      disabled={disabled || state === 'transcribing'}
      title={state === 'recording' ? 'Recording — release to transcribe' : errMsg ? `Voice error: ${errMsg}` : 'Hold to dictate'}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors',
        state === 'recording' && 'bg-red-500/20 border-red-500/60 text-red-300 animate-pulse',
        state === 'transcribing' && 'bg-white/5 border-white/10 text-gray-400',
        state === 'error' && 'bg-amber-500/20 border-amber-500/60 text-amber-300',
        state === 'idle' && 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/30',
        className
      )}
    >
      {state === 'recording' ? <Square className="w-3.5 h-3.5" /> :
       state === 'transcribing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
       <Mic className="w-3.5 h-3.5" />}
    </button>
  );
}

export default VoiceDictateButton;
