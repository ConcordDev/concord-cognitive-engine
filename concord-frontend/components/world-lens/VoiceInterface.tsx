'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX, Settings, ChevronDown,
  ChevronUp, Brain, CheckCircle, XCircle, MessageSquare,
  Radio, Clock, Loader2, AlertCircle, Trash2,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type VoiceEngine = 'whisper' | 'deepgram' | 'browser';
type ListeningMode = 'push-to-talk' | 'continuous';
type CommandStatus = 'idle' | 'listening' | 'processing' | 'success' | 'error';

interface ParsedIntent {
  action: string;
  target: string;
  location: string;
  composite: string;
}

interface VoiceCommand {
  id: string;
  transcript: string;
  intent?: ParsedIntent;
  status: CommandStatus;
  result?: string;
  timestamp: string;
}

interface VoiceConfig {
  engine: VoiceEngine;
  language: string;
  sensitivity: number;
  wakeWordEnabled: boolean;
  ttsEnabled: boolean;
}

interface NPCContext {
  id: string;
  name: string;
  role: string;
  avatar?: string;
}

interface SessionState {
  nearNPC?: NPCContext;
  currentDistrict?: string;
  mode?: string;
}

interface VoiceInterfaceProps {
  sessionState?: SessionState;
  onCommand?: (transcript: string, intent?: ParsedIntent) => void;
  onNPCChat?: (npcId: string, message: string) => void;
  config?: Partial<VoiceConfig>;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const DEFAULT_CONFIG: VoiceConfig = {
  engine: 'whisper',
  language: 'en-US',
  sensitivity: 0.7,
  wakeWordEnabled: true,
  ttsEnabled: true,
};

const ENGINES: { value: VoiceEngine; label: string }[] = [
  { value: 'whisper', label: 'Whisper' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'browser', label: 'Browser API' },
];

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'ja-JP', label: 'Japanese' },
];

/* ── Waveform Bar ──────────────────────────────────────────────── */

function WaveformBars({ active }: { active: boolean }) {
  const barCount = 12;
  return (
    <div className="flex items-center gap-0.5 h-8 px-2">
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-150 ${
            active ? 'bg-cyan-400' : 'bg-white/20'
          }`}
          style={{
            height: active ? `${12 + Math.sin(Date.now() / 200 + i) * 10}px` : '4px',
            animation: active ? `voice-bar ${0.4 + i * 0.05}s ease-in-out infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes voice-bar {
          0% { height: 4px; }
          100% { height: 28px; }
        }
      `}</style>
    </div>
  );
}

/* ── Intent Display ────────────────────────────────────────────── */

function IntentDisplay({ intent }: { intent: ParsedIntent }) {
  const parts = [
    { label: intent.action, color: 'text-green-400' },
    { label: intent.target, color: 'text-blue-400' },
    { label: intent.location, color: 'text-yellow-400' },
    { label: intent.composite, color: 'text-purple-400' },
  ].filter(p => p.label);

  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-white/30">&rarr;</span>}
          <span className={`${part.color} font-mono px-1.5 py-0.5 bg-white/5 rounded`}>
            {part.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */

export default function VoiceInterface({
  sessionState,
  onCommand,
  onNPCChat,
  config: configOverride,
}: VoiceInterfaceProps) {
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>({
    ...DEFAULT_CONFIG,
    ...configOverride,
  });
  const [mode, setMode] = useState<ListeningMode>('push-to-talk');
  const [status, setStatus] = useState<CommandStatus>('idle');
  const [isHolding, setIsHolding] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | null>(null);
  const [resultMessage, setResultMessage] = useState('');
  const [commandHistory, setCommandHistory] = useState<VoiceCommand[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [wakeWordActive, _setWakeWordActive] = useState(false);
  const [npcMode, setNpcMode] = useState(false);

  const _holdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isNPCNearby = !!sessionState?.nearNPC;

  useEffect(() => {
    if (isNPCNearby) setNpcMode(true);
    else setNpcMode(false);
  }, [isNPCNearby]);

  /* Simulated voice processing */
  const processVoice = useCallback((text: string) => {
    setTranscript(text);
    setStatus('processing');

    const intent: ParsedIntent = {
      action: 'Build',
      target: '3-story library',
      location: `District ${sessionState?.currentDistrict ?? '7'}`,
      composite: 'USB-A composite',
    };

    setTimeout(() => {
      setParsedIntent(intent);
      setStatus('success');
      setResultMessage(`Building scaffolded in District ${sessionState?.currentDistrict ?? '7'}`);

      const cmd: VoiceCommand = {
        id: crypto.randomUUID(),
        transcript: text,
        intent,
        status: 'success',
        result: `Building scaffolded in District ${sessionState?.currentDistrict ?? '7'}`,
        timestamp: new Date().toISOString(),
      };
      setCommandHistory(prev => [cmd, ...prev].slice(0, 10));

      if (npcMode && sessionState?.nearNPC) {
        onNPCChat?.(sessionState.nearNPC.id, text);
      } else {
        onCommand?.(text, intent);
      }
    }, 1500);
  }, [sessionState, npcMode, onCommand, onNPCChat]);

  const handleMicDown = () => {
    if (mode === 'push-to-talk') {
      setIsHolding(true);
      setStatus('listening');
      setTranscript('');
      setParsedIntent(null);
      setResultMessage('');
    }
  };

  const handleMicUp = () => {
    if (mode === 'push-to-talk' && isHolding) {
      setIsHolding(false);
      processVoice('Build a 3-story library in District 7 with USB-A composite');
    }
  };

  const handleMicClick = () => {
    if (mode === 'continuous') {
      if (status === 'listening') {
        setStatus('idle');
      } else {
        setStatus('listening');
        setTranscript('');
        setParsedIntent(null);
        setResultMessage('');
        setTimeout(() => {
          processVoice('Build a 3-story library in District 7 with USB-A composite');
        }, 2000);
      }
    }
  };

  const clearHistory = () => setCommandHistory([]);

  const isListening = status === 'listening';
  const isProcessing = status === 'processing';

  return (
    <div className={`${panel} p-4 w-80 space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">
            {npcMode ? `Talking to ${sessionState?.nearNPC?.name}` : 'Voice Command'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setVoiceConfig(c => ({ ...c, ttsEnabled: !c.ttsEnabled }))}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Text-to-speech"
          >
            {voiceConfig.ttsEnabled
              ? <Volume2 className="w-3.5 h-3.5 text-white/60" />
              : <VolumeX className="w-3.5 h-3.5 text-white/40" />
            }
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          aria-label="Settings">
            <Settings className="w-3.5 h-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* NPC indicator */}
      {npcMode && sessionState?.nearNPC && (
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-purple-300 font-medium">{sessionState.nearNPC.name}</p>
            <p className="text-[10px] text-white/40">{sessionState.nearNPC.role}</p>
          </div>
          <button
            onClick={() => setNpcMode(false)}
            className="text-[10px] text-white/40 hover:text-white/60 px-1.5 py-0.5 border border-white/10 rounded"
          >
            Command
          </button>
        </div>
      )}

      {/* Wake word indicator */}
      {voiceConfig.wakeWordEnabled && status === 'idle' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded text-[10px] text-white/40">
          <Radio className="w-3 h-3" />
          <span>Say &quot;Hey Concord&quot; to activate</span>
          <div className={`w-1.5 h-1.5 rounded-full ml-auto ${wakeWordActive ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-0.5 bg-white/5 rounded-lg">
        <button
          onClick={() => { setMode('push-to-talk'); setStatus('idle'); }}
          className={`flex-1 text-[10px] py-1 rounded transition-colors ${
            mode === 'push-to-talk' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Push to Talk
        </button>
        <button
          onClick={() => { setMode('continuous'); setStatus('idle'); }}
          className={`flex-1 text-[10px] py-1 rounded transition-colors ${
            mode === 'continuous' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/40 hover:text-white/60'
          }`}
        >
          Continuous
        </button>
      </div>

      {/* Microphone button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onMouseDown={handleMicDown}
          onMouseUp={handleMicUp}
          onMouseLeave={() => { if (isHolding) handleMicUp(); }}
          onClick={handleMicClick}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
            isListening
              ? 'bg-cyan-500/30 border-2 border-cyan-400 shadow-lg shadow-cyan-500/20 scale-110'
              : isProcessing
              ? 'bg-yellow-500/20 border-2 border-yellow-400/50'
              : 'bg-white/10 border-2 border-white/20 hover:border-white/40 hover:bg-white/15'
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-7 h-7 text-yellow-400 animate-spin" />
          ) : isListening ? (
            <Mic className="w-7 h-7 text-cyan-400" />
          ) : (
            <MicOff className="w-7 h-7 text-white/50" />
          )}
        </button>
        <span className="text-[10px] text-white/40">
          {isListening
            ? 'Listening...'
            : isProcessing
            ? 'Processing...'
            : mode === 'push-to-talk'
            ? 'Hold to talk'
            : 'Click to start'}
        </span>
      </div>

      {/* Waveform */}
      {isListening && <WaveformBars active={true} />}

      {/* Transcript */}
      {transcript && (
        <div className="space-y-2">
          <div className="px-3 py-2 bg-white/5 rounded-lg">
            <p className="text-[10px] text-white/40 mb-1">Transcript</p>
            <p className="text-xs text-white/80">{transcript}</p>
          </div>

          {/* Intent parsing */}
          {parsedIntent && (
            <div className="px-3 py-2 bg-white/5 rounded-lg">
              <p className="text-[10px] text-white/40 mb-1.5">Parsed Intent</p>
              <IntentDisplay intent={parsedIntent} />
            </div>
          )}

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Brain className="w-4 h-4 text-yellow-400 animate-pulse" />
              <span className="text-xs text-yellow-400">Brain processing command...</span>
            </div>
          )}

          {/* Result feedback */}
          {(status === 'success' || status === 'error') && resultMessage && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                status === 'success'
                  ? 'bg-green-500/10 border border-green-500/20'
                  : 'bg-red-500/10 border border-red-500/20'
              }`}
            >
              {status === 'success' ? (
                <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span className={`text-xs ${status === 'success' ? 'text-green-300' : 'text-red-300'}`}>
                {resultMessage}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="space-y-2 p-3 bg-white/5 rounded-lg">
          <p className="text-[10px] text-white/40 uppercase tracking-wider">Voice Settings</p>

          {/* Engine */}
          <div className="space-y-1">
            <label className="text-[10px] text-white/50">Engine</label>
            <div className="flex gap-1">
              {ENGINES.map(eng => (
                <button
                  key={eng.value}
                  onClick={() => setVoiceConfig(c => ({ ...c, engine: eng.value }))}
                  className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                    voiceConfig.engine === eng.value
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:border-white/20'
                  }`}
                >
                  {eng.label}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="space-y-1">
            <label className="text-[10px] text-white/50">Language</label>
            <select
              value={voiceConfig.language}
              onChange={e => setVoiceConfig(c => ({ ...c, language: e.target.value }))}
              className="w-full text-[10px] py-1 px-2 bg-white/5 border border-white/10 rounded text-white/80 outline-none"
            >
              {LANGUAGES.map(lang => (
                <option key={lang.value} value={lang.value}>{lang.label}</option>
              ))}
            </select>
          </div>

          {/* Sensitivity */}
          <div className="space-y-1">
            <label className="text-[10px] text-white/50">
              Sensitivity: {Math.round(voiceConfig.sensitivity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voiceConfig.sensitivity}
              onChange={e => setVoiceConfig(c => ({ ...c, sensitivity: parseFloat(e.target.value) }))}
              className="w-full h-1 appearance-none bg-white/10 rounded-full accent-cyan-400"
            />
          </div>

          {/* Wake word toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[10px] text-white/50">Wake word (&quot;Hey Concord&quot;)</span>
            <div
              onClick={() => setVoiceConfig(c => ({ ...c, wakeWordEnabled: !c.wakeWordEnabled }))}
              className={`w-7 h-4 rounded-full transition-colors relative ${
                voiceConfig.wakeWordEnabled ? 'bg-cyan-500' : 'bg-white/20'
              }`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  voiceConfig.wakeWordEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </div>
          </label>
        </div>
      )}

      {/* Command history */}
      <div>
        <button
          onClick={() => setShowHistory(h => !h)}
          className="flex items-center justify-between w-full text-[10px] text-white/40 hover:text-white/60 transition-colors"
        >
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Command History ({commandHistory.length})
          </span>
          {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {showHistory && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {commandHistory.length === 0 ? (
              <p className="text-[10px] text-white/30 text-center py-2">No commands yet</p>
            ) : (
              <>
                {commandHistory.map(cmd => (
                  <div
                    key={cmd.id}
                    className="flex items-start gap-2 px-2 py-1.5 bg-white/5 rounded text-[10px]"
                  >
                    {cmd.status === 'success' ? (
                      <CheckCircle className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white/70 truncate">{cmd.transcript}</p>
                      {cmd.result && (
                        <p className="text-white/40 truncate">{cmd.result}</p>
                      )}
                    </div>
                    <span className="text-white/20 shrink-0">
                      {new Date(cmd.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-[10px] text-white/30 hover:text-red-400 transition-colors mt-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear history
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
