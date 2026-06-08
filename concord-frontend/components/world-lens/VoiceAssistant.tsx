'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  createMediaRecorderSTT,
  mediaRecorderSupported,
  type MediaRecorderSTTHandle,
} from '@/lib/voice/mediarecorder-stt';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedActions?: string[];
}

interface VoiceSettings {
  ttsVoice: string;
  speechSpeed: number;
  language: string;
  wakeWord: boolean;
  pushToTalk: boolean;
}

// ── Settings options (static config — legit help/choices, not fabricated data) ──

const VOICE_OPTIONS = [
  { id: 'nova', label: 'Nova (Natural)' },
  { id: 'atlas', label: 'Atlas (Deep)' },
  { id: 'aria', label: 'Aria (Warm)' },
];

const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ja', label: 'Japanese' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function VoiceAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [idleTime, setIdleTime] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const sttRef = useRef<MediaRecorderSTTHandle | null>(null);
  const [settings, setSettings] = useState<VoiceSettings>({
    ttsVoice: 'nova',
    speechSpeed: 1.0,
    language: 'en',
    wakeWord: true,
    pushToTalk: true,
  });

  const transcriptOpacity = useMemo(() => {
    if (!showTranscript) return 0;
    if (idleTime >= 10) return 0.3;
    return 1;
  }, [showTranscript, idleTime]);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

  // Ask the conscious brain for a REAL reply. Returns the reply text, or null
  // when the brain is unreachable/offline — we NEVER fabricate an answer.
  const askBrain = useCallback(async (text: string): Promise<string | null> => {
    try {
      const r = await fetch(`${API_BASE}/api/brain/conscious`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json().catch(() => null);
      const reply = j?.reply ? String(j.reply).trim() : '';
      return reply || null;
    } catch {
      return null;
    }
  }, [API_BASE]);

  // One turn: echo what the user said, then surface the REAL brain reply (or an
  // honest offline status — never a made-up response).
  const sendUtterance = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setError(null);
    setIdleTime(0);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: clean, timestamp: new Date().toISOString() }]);
    setThinking(true);
    const reply = await askBrain(clean);
    setThinking(false);
    if (reply) {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: reply, timestamp: new Date().toISOString() }]);
    } else {
      setError("Assistant is offline — couldn't reach the brain. No response was generated.");
    }
  }, [askBrain]);

  const startRecording = useCallback(async () => {
    if (!mediaRecorderSupported()) { setVoiceUnavailable(true); return; }
    setError(null);
    const handle = createMediaRecorderSTT({
      apiBase: API_BASE,
      onTranscript: (t) => { void sendUtterance(t); },
      onUnavailable: () => {
        setVoiceUnavailable(true);
        setIsRecording(false);
        try { sttRef.current?.stop(); } catch { /* ignore */ }
        sttRef.current = null;
      },
    });
    sttRef.current = handle;
    const ok = await handle.start();
    if (!ok) { setVoiceUnavailable(true); sttRef.current = null; return; }
    setIsRecording(true);
    setIdleTime(0);
  }, [API_BASE, sendUtterance]);

  const stopRecording = useCallback(() => {
    try { sttRef.current?.stop(); } catch { /* ignore */ }
    sttRef.current = null;
    setIsRecording(false);
  }, []);

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const handleActionChip = (action: string) => {
    void sendUtterance(action);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // ── Waveform bars (CSS animated) ────────────────────────────────────────────
  const WaveformBars = () => (
    <div className="flex items-center gap-1 h-8">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="w-1 rounded-full bg-violet-400"
          style={{
            height: isRecording ? undefined : '4px',
            animation: isRecording
              ? `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`
              : 'none',
            minHeight: '4px',
            maxHeight: '32px',
          }}
        />
      ))}
      <style>{`
        @keyframes voiceBar {
          0% { height: 4px; }
          100% { height: ${24 + Math.random() * 8}px; }
        }
      `}</style>
    </div>
  );

  // ── Pulsing ring ─────────────────────────────────────────────────────────────
  const PulsingRing = () => (
    <>
      {isRecording && (
        <>
          <div
            className="absolute inset-0 rounded-full bg-violet-500/30"
            style={{
              animation: 'pulseRing 1.5s ease-out infinite',
            }}
          />
          <div
            className="absolute inset-0 rounded-full bg-violet-500/20"
            style={{
              animation: 'pulseRing 1.5s ease-out 0.5s infinite',
            }}
          />
          <style>{`
            @keyframes pulseRing {
              0% { transform: scale(1); opacity: 1; }
              100% { transform: scale(2); opacity: 0; }
            }
          `}</style>
        </>
      )}
    </>
  );

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-white overflow-hidden flex flex-col h-[600px] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400 text-sm font-bold">
            VA
          </div>
          <div>
            <h2 className="text-sm font-semibold">Voice Assistant</h2>
            <p className="text-[11px] text-white/40">
              {thinking ? 'Thinking…' : isRecording ? 'Listening…' : voiceUnavailable ? 'Voice unavailable' : 'Ready'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showTranscript
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-400'
                : 'border-white/10 hover:bg-white/5 text-white/60'
            }`}
          >
            Transcript
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showSettings
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-400'
                : 'border-white/10 hover:bg-white/5 text-white/60'
            }`}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Transcript */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3 transition-opacity duration-1000"
          style={{ opacity: transcriptOpacity }}
        >
          {messages.length === 0 && !isRecording && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-1">
              <p className="text-sm text-white/50">No conversation yet</p>
              <p className="text-xs text-white/30">
                {voiceUnavailable
                  ? 'Voice transcription isn’t available here (server STT not configured). Use the suggested actions instead.'
                  : 'Tap the mic to start talking.'}
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] ${
                  msg.role === 'user'
                    ? 'bg-violet-600/30 border-violet-500/20'
                    : 'bg-white/[0.05] border-white/10'
                } border rounded-2xl px-4 py-2.5`}
              >
                <div className="text-xs text-white/80 leading-relaxed">{msg.text}</div>
                <div className="text-[10px] text-white/20 mt-1">{formatTime(msg.timestamp)}</div>

                {/* Suggested action chips */}
                {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/5">
                    {msg.suggestedActions.map((action) => (
                      <button
                        key={action}
                        onClick={() => handleActionChip(action)}
                        className="px-2.5 py-1 text-[10px] rounded-full border border-violet-500/20 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Brain thinking indicator */}
          {thinking && (
            <div className="flex justify-start">
              <div className="bg-white/[0.05] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white/50">
                Thinking…
              </div>
            </div>
          )}

          {/* Honest error — we never fabricate a reply when the brain is offline */}
          {error && (
            <div className="flex justify-center py-2">
              <div className="max-w-[90%] text-center text-[11px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            </div>
          )}

          {/* Recording indicator in transcript */}
          {isRecording && (
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20">
                <WaveformBars />
                <span className="text-xs text-violet-400">Listening...</span>
              </div>
            </div>
          )}
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="w-72 border-l border-white/10 p-4 overflow-y-auto bg-white/[0.02]">
            <h3 className="text-xs font-semibold mb-4">Voice Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-white/40 block mb-1">TTS Voice</label>
                <div className="space-y-1">
                  {VOICE_OPTIONS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setSettings({ ...settings, ttsVoice: v.id })}
                      className={`w-full px-3 py-2 text-xs rounded-lg text-left transition-colors ${
                        settings.ttsVoice === v.id
                          ? 'bg-violet-500/20 border border-violet-500/30 text-violet-400'
                          : 'border border-white/5 hover:bg-white/5 text-white/60'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-white/40 block mb-1">
                  Speech Speed ({settings.speechSpeed.toFixed(1)}x)
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={settings.speechSpeed}
                  onChange={(e) =>
                    setSettings({ ...settings, speechSpeed: parseFloat(e.target.value) })
                  }
                  className="w-full accent-violet-500"
                />
                <div className="flex justify-between text-[10px] text-white/20">
                  <span>0.5x</span>
                  <span>2.0x</span>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-white/40 block mb-1">Language</label>
                <select
                  value={settings.language}
                  onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none focus:border-violet-500/50"
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/5">
                <label className="flex items-center justify-between cursor-pointer group">
                  <span className="text-xs text-white/60">Wake Word</span>
                  <div
                    onClick={() => setSettings({ ...settings, wakeWord: !settings.wakeWord })}
                    className={`w-9 h-5 rounded-full transition-colors relative ${
                      settings.wakeWord ? 'bg-violet-500' : 'bg-white/10'
                    }`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div
                      className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                        settings.wakeWord ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                </label>

                <label className="flex items-center justify-between cursor-pointer group">
                  <span className="text-xs text-white/60">Push to Talk</span>
                  <div
                    onClick={() =>
                      setSettings({ ...settings, pushToTalk: !settings.pushToTalk })
                    }
                    className={`w-9 h-5 rounded-full transition-colors relative ${
                      settings.pushToTalk ? 'bg-violet-500' : 'bg-white/10'
                    }`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div
                      className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                        settings.pushToTalk ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                </label>
              </div>

              <div className="pt-2 border-t border-white/5">
                <p className="text-[10px] text-white/20">
                  {settings.pushToTalk
                    ? 'Click the mic button or hold V to talk.'
                    : 'Continuous listening mode active.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      <div className="flex items-center justify-center py-1.5 border-t border-white/5">
        <span className="text-[10px] text-white/20">
          Hold{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/40 font-mono text-[10px]">
            V
          </kbd>{' '}
          to talk
        </span>
      </div>

      {/* Floating mic button */}
      <div className="absolute bottom-14 right-5">
        <div className="relative">
          <PulsingRing />
          <button
            onClick={toggleRecording}
            className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
              isRecording
                ? 'bg-red-500 hover:bg-red-400 scale-110'
                : 'bg-violet-600 hover:bg-violet-500'
            }`}
          >
            {isRecording ? (
              <div className="w-5 h-5 rounded-sm bg-white" />
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="text-white"
              >
                <path
                  d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
                  fill="currentColor"
                />
                <path
                  d="M19 10v2a7 7 0 0 1-14 0v-2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="12"
                  y1="19"
                  x2="12"
                  y2="23"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
