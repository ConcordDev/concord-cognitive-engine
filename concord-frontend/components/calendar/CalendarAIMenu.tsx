'use client';

/**
 * CalendarAIMenu — Cmd-K AI palette for the calendar lens. 7 actions:
 * compose nat-lang event, auto-schedule from tasks, daily ritual,
 * meeting prep, post-meeting notes, voice-to-event, Aki-style chat.
 */

import { useState, useCallback, useEffect } from 'react';
import { callCalendarMacro, type CalendarEvent } from '@/lib/api/calendar';
import {
  Sparkles, X, Loader2, FileText, Zap, MessageSquare, Mic, ListChecks,
  Wand2, Check, Send,
} from 'lucide-react';

type Mode = 'menu' | 'parse' | 'auto' | 'ritual' | 'prep' | 'notes' | 'voice' | 'chat';

interface Props {
  open: boolean;
  onClose: () => void;
  activeEvent: CalendarEvent | null;
  onRefresh: () => void;
}

export function CalendarAIMenu({ open, onClose, activeEvent, onRefresh }: Props) {
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('menu'); setBusy(false); setPrompt(''); setOutput(null); setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      switch (mode) {
        case 'parse': {
          const r = await callCalendarMacro<{ event?: object }>('ai_parse_event', { text: prompt });
          if (!r.ok) throw new Error(r.reason || 'parse_failed');
          setOutput(r.event);
          break;
        }
        case 'auto': {
          // Pull open tasks from the tasks lens, then auto-schedule
          const tasksR = await (await fetch('/api/lens/run', {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ domain: 'tasks', name: 'task_assigned_to_me', input: { limit: 30 } }),
          })).json();
          const myTasks = (tasksR?.result?.tasks || tasksR?.tasks || []) as Array<{ id: string; title: string; estimate?: number; due_at?: number; priority?: string }>;
          const tasks = myTasks.filter((t) => t.estimate && t.due_at).map((t) => ({
            id: t.id, title: t.title, estimate: t.estimate, estimateUnit: 'points',
            dueAt: t.due_at, priority: t.priority || 'medium',
          }));
          const r = await callCalendarMacro<{ placed?: unknown[]; created?: unknown[] }>('ai_auto_schedule', {
            tasks, horizonDays: 14, commit: true,
          });
          if (!r.ok) throw new Error(r.reason || 'auto_failed');
          setOutput(r);
          onRefresh();
          break;
        }
        case 'ritual': {
          const r = await callCalendarMacro<{ plan?: string }>('ai_daily_ritual', { date: new Date().toISOString().slice(0,10) });
          if (!r.ok) throw new Error(r.reason || 'ritual_failed');
          setOutput(r.plan);
          break;
        }
        case 'prep': {
          if (!activeEvent) throw new Error('no_event_selected');
          const r = await callCalendarMacro<{ briefing?: string }>('ai_meeting_prep', { eventId: activeEvent.id });
          if (!r.ok) throw new Error(r.reason || 'prep_failed');
          setOutput(r.briefing);
          break;
        }
        case 'notes': {
          if (!activeEvent) throw new Error('no_event_selected');
          const r = await callCalendarMacro<{ notes?: string }>('ai_meeting_notes', { eventId: activeEvent.id, transcript: prompt });
          if (!r.ok) throw new Error(r.reason || 'notes_failed');
          setOutput(r.notes);
          break;
        }
        case 'voice': {
          const r = await callCalendarMacro<{ event?: object; created?: { id: string } }>('ai_voice_event', { transcript: prompt, autoCreate: true });
          if (!r.ok) throw new Error(r.reason || 'voice_failed');
          setOutput(r);
          onRefresh();
          break;
        }
        case 'chat': {
          const r = await callCalendarMacro<{ reply?: string }>('ai_chat', { message: prompt });
          if (!r.ok) throw new Error(r.reason || 'chat_failed');
          setOutput(r.reply);
          break;
        }
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'AI request failed');
    } finally { setBusy(false); }
  }, [mode, prompt, activeEvent, busy, onRefresh]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-white/10">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white flex-1">
            {mode === 'menu' && 'AI Calendar Actions'}
            {mode === 'parse' && 'Natural-language event entry'}
            {mode === 'auto' && 'Auto-schedule tasks'}
            {mode === 'ritual' && 'Daily ritual'}
            {mode === 'prep' && 'Meeting prep'}
            {mode === 'notes' && 'Meeting notes'}
            {mode === 'voice' && 'Voice → event'}
            {mode === 'chat' && 'Chat with calendar'}
          </span>
          {mode !== 'menu' && (
            <button onClick={() => { setMode('menu'); setOutput(null); }} className="text-xs text-white/60 hover:text-white">back</button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>

        {mode === 'menu' && (
          <div className="p-2 grid grid-cols-2 gap-1">
            <MenuItem icon={<FileText className="w-4 h-4" />} label="Quick add" hint="'lunch with Sarah Tuesday 1pm'" onClick={() => setMode('parse')} />
            <MenuItem icon={<Zap className="w-4 h-4" />} label="Auto-schedule tasks" hint="Motion-style fit-into-slots" onClick={() => setMode('auto')} />
            <MenuItem icon={<ListChecks className="w-4 h-4" />} label="Daily ritual" hint="Sunsama-style guided plan" onClick={() => setMode('ritual')} />
            <MenuItem icon={<Sparkles className="w-4 h-4" />} label="Meeting prep" hint={activeEvent ? `For ${activeEvent.title}` : 'Pick event first'} disabled={!activeEvent} onClick={() => setMode('prep')} />
            <MenuItem icon={<Wand2 className="w-4 h-4" />} label="Meeting notes" hint={activeEvent ? 'Paste transcript' : 'Pick event first'} disabled={!activeEvent} onClick={() => setMode('notes')} />
            <MenuItem icon={<Mic className="w-4 h-4" />} label="Voice → event" hint="Dictate or paste transcript" onClick={() => setMode('voice')} />
            <MenuItem icon={<MessageSquare className="w-4 h-4" />} label="Chat" hint="Ask your assistant" onClick={() => setMode('chat')} />
          </div>
        )}

        {mode !== 'menu' && (
          <div className="p-3 space-y-2">
            {(mode === 'parse' || mode === 'notes' || mode === 'voice' || mode === 'chat') && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
                placeholder={
                  mode === 'parse' ? "'lunch with Sarah tomorrow 1pm'" :
                  mode === 'notes' ? 'Paste meeting transcript here' :
                  mode === 'voice' ? 'Paste dictation or speak…' :
                  'Ask about your schedule'
                }
                rows={mode === 'notes' ? 8 : 3}
                autoFocus
                className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
              />
            )}
            {(mode === 'auto' || mode === 'ritual' || mode === 'prep') && (
              <div className="text-xs text-white/60 px-2 py-2 bg-white/5 rounded">
                {mode === 'auto' && "Pulls your open tasks (with estimate + due date) and fits them into free calendar slots."}
                {mode === 'ritual' && "Builds today's plan from your scheduled events + open tasks + Personal Beats."}
                {mode === 'prep' && activeEvent && `Generates a briefing for ${activeEvent.title} (${new Date(activeEvent.start_at * 1000).toLocaleString()}).`}
              </div>
            )}
            <button
              onClick={run}
              disabled={busy || ((mode === 'parse' || mode === 'notes' || mode === 'voice' || mode === 'chat') && !prompt.trim())}
              className="w-full py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {busy ? 'Running…' : 'Run'}
            </button>
            {error && <div className="text-xs text-red-400">{error}</div>}
            {!!output && (
              <div className="mt-2 border border-white/10 rounded p-3 max-h-72 overflow-y-auto">
                {typeof output === 'string' ? (
                  <div className="text-sm text-white/90 whitespace-pre-wrap">{output}</div>
                ) : (
                  <pre className="text-xs text-white/80 whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
                )}
                {(mode === 'auto' || mode === 'voice') && (
                  <div className="mt-2 pt-2 border-t border-white/10 text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Events created — calendar refreshed.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }: {
  icon: React.ReactNode; label: string; hint: string; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-2 p-2 rounded hover:bg-white/5 text-left disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <div className="text-cyan-400 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium">{label}</div>
        <div className="text-xs text-white/40 truncate">{hint}</div>
      </div>
    </button>
  );
}
