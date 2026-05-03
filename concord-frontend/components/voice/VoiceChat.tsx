'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Volume2, VolumeX, PhoneOff, Loader2, Radio } from 'lucide-react';
import { api } from '@/lib/api/client';

type SessionState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

interface VoiceTurn {
  id: string;
  user: string;
  agent: string;
  latencyMs: number;
}

export function VoiceChat() {
  const [state, setState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const vadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // VAD silence detection — send audio after 1.2s of silence
  const VAD_SILENCE_MS = 1200;

  const sendAudio = useCallback(async (sid: string) => {
    if (!mediaRecorderRef.current || audioChunksRef.current.length === 0) return;
    if (mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    setState('processing');

    try {
      const arrayBuf = await audioBlob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
      const res = await api.post('/api/voice/session/turn', {
        sessionId: sid,
        audio: base64,
        format: 'webm',
      });

      if (!res.data?.ok) {
        setState('listening');
        if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
        return;
      }

      const { transcript, responseText, audioBase64, latencyMs } = res.data;
      setLastLatency(latencyMs);

      if (transcript || responseText) {
        setTurns(prev => [...prev, {
          id: `turn_${Date.now()}`,
          user: transcript || '',
          agent: responseText || '',
          latencyMs: latencyMs || 0,
        }]);
      }

      // Play TTS audio if available
      if (audioBase64 && !isMuted) {
        setState('speaking');
        const audioData = `data:audio/wav;base64,${audioBase64}`;
        if (!audioPlayerRef.current) audioPlayerRef.current = new Audio();
        audioPlayerRef.current.src = audioData;
        audioPlayerRef.current.onended = () => {
          setState('listening');
          if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
        };
        audioPlayerRef.current.play().catch(() => setState('listening'));
      } else {
        setState('listening');
        if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
      }
    } catch {
      setState('listening');
      if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
    }
  }, [isMuted]);

  const startListening = useCallback(async (sid: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
        if (vadTimeoutRef.current) clearTimeout(vadTimeoutRef.current);
        vadTimeoutRef.current = setTimeout(() => sendAudio(sid), VAD_SILENCE_MS);
      };

      recorder.start(200);
      setState('listening');
    } catch {
      setState('error');
      setError('Microphone access denied');
    }
  }, [sendAudio]);

  const startSession = useCallback(async () => {
    setState('connecting');
    setError(null);
    try {
      const res = await api.post('/api/voice/session/create');
      if (!res.data?.ok) throw new Error(res.data?.error || 'session_create_failed');
      setSessionId(res.data.sessionId);
      await startListening(res.data.sessionId);
    } catch (err: unknown) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to start voice session');
    }
  }, [startListening]);

  const handleBargeIn = useCallback(async () => {
    if (state !== 'speaking' || !sessionId) return;
    // Stop audio playback
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = '';
    }
    // Signal barge-in to server
    await api.post('/api/voice/session/barge-in', { sessionId }).catch(() => {});
    setState('listening');
    if (mediaRecorderRef.current?.state === 'paused') mediaRecorderRef.current.resume();
  }, [state, sessionId]);

  const endSession = useCallback(async () => {
    if (vadTimeoutRef.current) clearTimeout(vadTimeoutRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioPlayerRef.current) { audioPlayerRef.current.pause(); audioPlayerRef.current.src = ''; }
    if (sessionId) await api.delete(`/api/voice/session/${sessionId}`).catch(() => {});
    setSessionId(null);
    setState('idle');
    setError(null);
  }, [sessionId]);

  // Mirror the latest endSession + sessionId in refs so the unmount cleanup
  // can fire exactly once without re-running on every sessionId change.
  const endSessionRef = useRef(endSession);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { endSessionRef.current = endSession; }, [endSession]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => () => { if (sessionIdRef.current) endSessionRef.current(); }, []);

  const stateColor = {
    idle: 'text-white/40',
    connecting: 'text-blue-400',
    listening: 'text-green-400',
    processing: 'text-amber-400',
    speaking: 'text-purple-400',
    error: 'text-red-400',
  }[state];

  const stateLabel = {
    idle: 'Ready',
    connecting: 'Connecting...',
    listening: 'Listening',
    processing: 'Thinking...',
    speaking: 'Speaking',
    error: 'Error',
  }[state];

  return (
    <div className="flex flex-col gap-4 p-4 bg-black/20 rounded-xl border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${stateColor}`} />
          <span className={`text-sm font-medium ${stateColor}`}>{stateLabel}</span>
          {lastLatency && <span className="text-xs text-white/30">{lastLatency}ms</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMuted(m => !m)}
            className="text-white/40 hover:text-white/70 transition-colors"
            title={isMuted ? 'Unmute output' : 'Mute output'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Transcript */}
      {turns.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-3">
          {turns.slice(-5).map(turn => (
            <div key={turn.id} className="space-y-1">
              {turn.user && (
                <div className="flex gap-2">
                  <span className="text-xs text-white/40 w-12 flex-shrink-0 pt-0.5">You</span>
                  <p className="text-sm text-white/70">{turn.user}</p>
                </div>
              )}
              {turn.agent && (
                <div className="flex gap-2">
                  <span className="text-xs text-blue-400/70 w-12 flex-shrink-0 pt-0.5">Agent</span>
                  <p className="text-sm text-white">{turn.agent}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {state === 'idle' ? (
          <button
            onClick={startSession}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            <Mic className="w-4 h-4" />
            Start Voice
          </button>
        ) : (
          <>
            {state === 'speaking' && (
              <button
                onClick={handleBargeIn}
                className="flex items-center gap-2 px-3 py-2 bg-amber-600/80 hover:bg-amber-600 text-white text-sm rounded-lg transition-colors"
              >
                <Mic className="w-4 h-4" />
                Interrupt
              </button>
            )}
            <button
              onClick={endSession}
              className="flex items-center gap-2 px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white text-sm rounded-lg transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              End
            </button>
          </>
        )}
        {state === 'connecting' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
      </div>
    </div>
  );
}
