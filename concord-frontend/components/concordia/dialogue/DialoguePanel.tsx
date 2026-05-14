'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DialogueState, SkillCheckOption } from '@/hooks/useDialogue';
import { SPECIALStats } from '@/lib/concordia/player-stats';
import { modeManager } from '@/lib/concordia/mode-manager';

// ── Relationship badge ───────────────────────────────────────────────

const STANDING_COLORS: Record<string, string> = {
  ally:       'text-green-400',
  friendly:   'text-emerald-300',
  neutral:    'text-white/60',
  unfriendly: 'text-orange-400',
  hostile:    'text-red-400',
};

function RelationshipBar({ opinion, familiarity, standing }: {
  opinion: number; familiarity: number; standing: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={`capitalize font-semibold ${STANDING_COLORS[standing] ?? 'text-white/60'}`}>
        {standing}
      </span>
      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${((opinion + 100) / 200) * 100}%`,
            backgroundColor: opinion >= 0 ? '#22c55e' : '#ef4444',
          }}
        />
      </div>
      <span className="text-white/30">Familiarity {familiarity}%</span>
    </div>
  );
}

// ── Skill check button ───────────────────────────────────────────────

function SkillCheckButton({
  option, special, onSelect,
}: {
  option: SkillCheckOption;
  special: SPECIALStats;
  onSelect: (opt: SkillCheckOption) => void;
}) {
  const statVal = special[option.stat] as number;
  const unlocked = statVal >= option.minValue;
  return (
    <button
      onClick={() => unlocked && onSelect(option)}
      className={`text-left px-3 py-2 rounded-lg border text-sm transition-all
        ${unlocked
          ? 'border-yellow-400/60 text-yellow-300 hover:bg-yellow-400/10'
          : 'border-white/10 text-white/30 cursor-not-allowed'
        }`}
    >
      <span className="mr-2 font-mono text-xs uppercase text-white/40">
        [{option.stat.toUpperCase()} {option.minValue}]
      </span>
      {option.text}
      {!unlocked && (
        <span className="ml-2 text-xs text-red-400/70">({statVal}/{option.minValue})</span>
      )}
    </button>
  );
}

// ── Memory panel (Shadow of Mordor NPC memory) ───────────────────────

function MemoryPanel({ memories }: { memories: string[] }) {
  if (memories.length === 0) return null;
  return (
    <details className="text-xs text-white/40 font-mono">
      <summary className="cursor-pointer hover:text-white/60">
        {memories.length} memor{memories.length === 1 ? 'y' : 'ies'}
      </summary>
      <ul className="mt-1 pl-3 space-y-0.5 list-disc">
        {memories.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </details>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

interface DialoguePanelProps {
  state: DialogueState;
  special: SPECIALStats;
  onSend: (text: string, skillCheck?: SkillCheckOption) => void;
  onClose: () => void;
  onVoiceTranscript?: (text: string) => void;
}

export function DialoguePanel({
  state,
  special,
  onSend,
  onClose,
  onVoiceTranscript,
}: DialoguePanelProps) {
  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages]);

  // Phase B4 — lip-sync. When the NPC speaks a new line, dispatch
  // `concordia:lip-sync` so AvatarSystem3D can drive phonemes on the
  // NPC's FacialController (set up in createAvatarMeshSmart).
  const lastNpcMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    const msgs = state.messages;
    if (!msgs || msgs.length === 0 || !state.npcId) return;
    const last = msgs[msgs.length - 1] as { id?: string; role?: string; speaker?: string; body?: string; text?: string };
    const isNpc = last.role === 'npc' || last.speaker === 'npc';
    if (!isNpc) return;
    const id = String(last.id ?? msgs.length);
    if (lastNpcMessageIdRef.current === id) return;
    lastNpcMessageIdRef.current = id;
    const text = String(last.body ?? last.text ?? '');
    if (!text) return;
    window.dispatchEvent(new CustomEvent('concordia:lip-sync', {
      detail: { npcId: state.npcId, text, wpm: 180 },
    }));
  }, [state.messages, state.npcId]);

  const handleSend = useCallback((text: string, skillCheck?: SkillCheckOption) => {
    if (!text.trim()) return;
    onSend(text, skillCheck);
    setInput('');
  }, [onSend]);

  const handleVoice = useCallback(async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        form.append('file', blob, 'voice.webm');
        form.append('mimeType', 'audio/webm');
        try {
          const { default: axios } = await import('axios');
          const res = await axios.post('/api/personal-locker/upload', form, {
            withCredentials: true,
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const transcript: string = res.data?.dtu?.extractedText ?? '';
          if (transcript) {
            setInput(transcript);
            onVoiceTranscript?.(transcript);
          }
        } catch {
          // Voice transcription failed silently — user can type instead
        }
      };
      recorder.start();
      mediaRef.current = recorder;
      setRecording(true);
    } catch {
      // Mic permission denied — silent fail
    }
  }, [recording, onVoiceTranscript]);

  const handleClose = useCallback(() => {
    onClose();
    modeManager.pop();
  }, [onClose]);

  if (!state.active) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center pb-4 pointer-events-none" data-active-dialogue="true">
      <div className="bg-black/90 backdrop-blur-md border border-white/10 rounded-2xl w-full max-w-xl mx-4 pointer-events-auto flex flex-col max-h-[60vh]">

        {/* NPC header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
          <div className="flex flex-col gap-1 flex-1">
            <span className="font-semibold text-white">{state.npcName}</span>
            {state.relationship && (
              <>
                <RelationshipBar
                  opinion={state.relationship.opinion}
                  familiarity={state.relationship.familiarity}
                  standing={state.relationship.standing}
                />
                <MemoryPanel memories={state.relationship.memories} />
              </>
            )}
          </div>
          <button onClick={handleClose} className="text-white/40 hover:text-white text-xl ml-3">✕</button>
        </div>

        {/* Message history */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {state.messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'player' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm
                ${msg.role === 'player'
                  ? 'bg-blue-600/40 text-white'
                  : 'bg-white/10 text-white/90'
                }`}
              >
                {msg.text}
                {msg.skillCheckResult && (
                  <div className={`text-xs mt-1 font-mono ${msg.skillCheckResult.passed ? 'text-green-400' : 'text-red-400'}`}>
                    [{msg.skillCheckResult.option.stat.toUpperCase()} check: {msg.skillCheckResult.passed ? 'PASSED' : 'FAILED'}]
                  </div>
                )}
              </div>
            </div>
          ))}
          {state.loading && (
            <div className="flex justify-start">
              <div className="bg-white/10 rounded-xl px-4 py-2 text-white/40 text-sm animate-pulse">
                {state.npcName} is thinking…
              </div>
            </div>
          )}
        </div>

        {/* Skill-check options (Fallout-style) */}
        {state.skillCheckOptions.length > 0 && (
          <div className="px-4 pb-2 flex flex-col gap-1">
            <div className="text-xs text-white/30 font-mono mb-1">SKILL OPTIONS</div>
            {state.skillCheckOptions.map(opt => (
              <SkillCheckButton
                key={opt.id}
                option={opt}
                special={special}
                onSelect={(o) => handleSend(o.text, o)}
              />
            ))}
          </div>
        )}

        {/* Quick options */}
        {state.suggestedResponses.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1">
            {state.suggestedResponses.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSend(opt)}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs border border-white/10 transition-all"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2 px-4 pb-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder="Speak your mind…"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm
              text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/30
              max-h-20 overflow-y-auto"
          />
          <button
            onClick={handleVoice}
            className={`p-2 rounded-xl border text-sm transition-all
              ${recording ? 'border-red-400 text-red-400 bg-red-400/10 animate-pulse' : 'border-white/10 text-white/50 hover:border-white/30'}`}
            title={recording ? 'Stop recording' : 'Voice input'}
          >
            {recording ? '⏹' : '🎤'}
          </button>
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || state.loading}
            className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40
              text-white text-sm font-semibold transition-all"
          >
            Send
          </button>
        </div>

        {state.error && (
          <div className="px-4 pb-3 text-xs text-red-400 font-mono">{state.error}</div>
        )}
      </div>
    </div>
  );
}
