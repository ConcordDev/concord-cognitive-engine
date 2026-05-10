'use client';

/**
 * VoiceNPCMic — push-to-talk button that uses the Web Speech API
 * (SpeechRecognition) to capture player speech, sends to the existing
 * NPC dialogue endpoint, then plays back the NPC response via
 * SpeechSynthesis.
 *
 * Phase 9.3 #15. No new server endpoint — reuses the existing
 * /api/worlds/:worldId/npcs/:npcId/dialogue handler.
 *
 * Browser support: webkitSpeechRecognition is Chrome/Edge/Safari;
 * gracefully no-op on Firefox.
 */

import { useEffect, useRef, useState } from 'react';

interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface Props {
  worldId: string;
  npcId: string;
}

export default function VoiceNPCMic({ worldId, npcId }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const recognitionRef = useRef<SR | null>(null);

  useEffect(() => {
    const win = window as Window & { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const startRecording = () => {
    const win = window as Window & { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const SRC = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SRC) return;
    const r = new SRC();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (ev) => {
      const text = Array.from(ev.results).map(x => x[0].transcript).join(' ').trim();
      if (text) void sendToNPC(text);
    };
    r.onerror = (ev) => { setStatus(`mic error: ${ev.error}`); };
    r.onend = () => setRecording(false);
    recognitionRef.current = r;
    setStatus('Listening…');
    setRecording(true);
    r.start();
  };

  const stopRecording = () => { recognitionRef.current?.stop(); };

  const sendToNPC = async (text: string) => {
    setStatus(`You: "${text}"`);
    const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/npcs/${encodeURIComponent(npcId)}/dialogue`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerInput: text }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    const reply = data?.reply || data?.response || data?.text;
    if (!reply) { setStatus('NPC silent'); return; }
    setStatus(`NPC: "${reply.slice(0, 80)}…"`);
    // Speak reply if SpeechSynthesis is available.
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(reply);
      u.rate = 0.95;
      u.pitch = 0.9;
      window.speechSynthesis.speak(u);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  if (!supported) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        className={`px-3 py-2 rounded-full font-bold text-xs ${recording ? 'bg-rose-700 text-white animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'}`}
        title="Hold to talk"
      >
        🎙 {recording ? 'Listening' : 'Hold to talk'}
      </button>
      {status && <p className="text-[10px] text-zinc-400 italic max-w-xs text-center">{status}</p>}
    </div>
  );
}
