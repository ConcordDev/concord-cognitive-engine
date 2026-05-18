'use client';

/**
 * TaskAIMenu — Ctrl-K-style AI palette for the tasks lens. 6 marquee
 * AI actions: compose plan, break-down epic, auto-prioritize, standup,
 * voice-to-task, tone polish. Routes through tasks-ai.* macros.
 */

import { useState, useCallback, useEffect } from 'react';
import { callTasksMacro, type Project, type Task } from '@/lib/api/tasks';
import {
  Sparkles, Loader2, X, FileText, GitBranch, ListOrdered,
  MessageSquare, Mic, Wand2, ArrowRight, Check,
} from 'lucide-react';

type Mode = 'menu' | 'plan' | 'breakdown' | 'prioritize' | 'standup' | 'voice' | 'polish';

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  task: Task | null;
  onRefresh: () => void;
}

export function TaskAIMenu({ open, onClose, project, task, onRefresh }: Props) {
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
        case 'plan': {
          if (!project) throw new Error('no_project');
          const r = await callTasksMacro<{ plan?: unknown }>('ai_compose_plan', { projectId: project.id, goal: prompt });
          if (!r.ok) throw new Error(r.reason || 'plan_failed');
          setOutput(r.plan);
          break;
        }
        case 'breakdown': {
          if (!task) throw new Error('no_task');
          const r = await callTasksMacro<{ proposals?: unknown[]; created?: unknown[] }>('ai_breakdown', { taskId: task.id, autoCreate: true });
          if (!r.ok) throw new Error(r.reason || 'breakdown_failed');
          setOutput(r);
          onRefresh();
          break;
        }
        case 'prioritize': {
          if (!project) throw new Error('no_project');
          const r = await callTasksMacro<{ ranked?: unknown[] }>('ai_prioritize', { projectId: project.id, useLlm: true });
          if (!r.ok) throw new Error(r.reason || 'prioritize_failed');
          setOutput(r.ranked);
          break;
        }
        case 'standup': {
          const r = await callTasksMacro<{ standup?: string }>('ai_standup', {
            projectId: project?.id, sinceHours: 24,
          });
          if (!r.ok) throw new Error(r.reason || 'standup_failed');
          setOutput(r.standup);
          break;
        }
        case 'voice': {
          if (!project) throw new Error('no_project');
          const r = await callTasksMacro<{ proposals?: unknown[]; created?: unknown[] }>('ai_voice_to_task', {
            projectId: project.id, transcript: prompt, autoCreate: true,
          });
          if (!r.ok) throw new Error(r.reason || 'voice_failed');
          setOutput(r);
          onRefresh();
          break;
        }
        case 'polish': {
          const r = await callTasksMacro<{ polished?: string }>('ai_tone_polish', {
            text: prompt, tone: 'clear and concise', taskId: task?.id,
          });
          if (!r.ok) throw new Error(r.reason || 'polish_failed');
          setOutput(r.polished);
          break;
        }
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'AI request failed');
    } finally {
      setBusy(false);
    }
  }, [mode, prompt, project, task, busy, onRefresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-white/10">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white flex-1">
            {mode === 'menu' && 'AI Actions'}
            {mode === 'plan' && 'Compose project plan'}
            {mode === 'breakdown' && 'Break down task'}
            {mode === 'prioritize' && 'Auto-prioritize backlog'}
            {mode === 'standup' && 'Generate standup'}
            {mode === 'voice' && 'Voice → tasks'}
            {mode === 'polish' && 'Polish tone'}
          </span>
          {mode !== 'menu' && (
            <button onClick={() => { setMode('menu'); setOutput(null); }} className="text-xs text-white/60 hover:text-white">back</button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'menu' && (
          <div className="p-2 grid grid-cols-2 gap-1">
            <MenuItem icon={<FileText className="w-4 h-4" />} label="Compose plan" hint="Goal → milestones + tasks" disabled={!project} onClick={() => setMode('plan')} />
            <MenuItem icon={<GitBranch className="w-4 h-4" />} label="Break down task" hint={task ? `Split ${task.task_key}` : 'Select a task first'} disabled={!task} onClick={() => setMode('breakdown')} />
            <MenuItem icon={<ListOrdered className="w-4 h-4" />} label="Auto-prioritize" hint="Rank backlog by impact" disabled={!project} onClick={() => setMode('prioritize')} />
            <MenuItem icon={<MessageSquare className="w-4 h-4" />} label="Generate standup" hint="Yesterday/Today/Blocked" onClick={() => setMode('standup')} />
            <MenuItem icon={<Mic className="w-4 h-4" />} label="Voice → tasks" hint="Todoist Ramble parity" disabled={!project} onClick={() => setMode('voice')} />
            <MenuItem icon={<Wand2 className="w-4 h-4" />} label="Polish tone" hint="Rewrite a description" onClick={() => setMode('polish')} />
          </div>
        )}

        {mode !== 'menu' && (
          <div className="p-3 space-y-2">
            {(mode === 'plan' || mode === 'voice' || mode === 'polish') && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
                placeholder={
                  mode === 'plan' ? 'What goal should this project achieve?' :
                  mode === 'voice' ? 'Paste a voice transcript or dictate here' :
                  'Text to polish'
                }
                rows={4}
                autoFocus
                className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
              />
            )}
            {(mode === 'breakdown' || mode === 'prioritize' || mode === 'standup') && (
              <div className="text-xs text-white/50 px-2 py-2 bg-white/5 rounded">
                {mode === 'breakdown' && task && `Will break down: ${task.task_key} — ${task.title}`}
                {mode === 'prioritize' && project && `Ranking all tasks in ${project.key}`}
                {mode === 'standup' && (project ? `Standup for ${project.key} (last 24h)` : 'Standup across all my projects (last 24h)')}
              </div>
            )}

            <button
              onClick={run}
              disabled={busy || ((mode === 'plan' || mode === 'voice' || mode === 'polish') && !prompt.trim())}
              className="w-full py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {busy ? 'Generating…' : 'Run'}
            </button>
            {error && <div className="text-xs text-red-400">{error}</div>}

            {!!output && (
              <div className="mt-2 border border-white/10 rounded p-2 max-h-72 overflow-y-auto">
                {typeof output === 'string' ? (
                  <div className="text-sm text-white/90 whitespace-pre-wrap">{output}</div>
                ) : Array.isArray(output) ? (
                  <div className="space-y-1">
                    {(output as Array<Record<string, unknown>>).slice(0, 30).map((row, i) => (
                      <div key={i} className="text-sm text-white/80 flex items-center gap-2 px-2 py-1 hover:bg-white/5 rounded">
                        {row.task_key != null && <span className="font-mono text-xs text-white/40">{String(row.task_key)}</span>}
                        <span className="flex-1 truncate">{String(row.title || row.name || '')}</span>
                        {row.score != null && <span className="text-cyan-300 text-xs">{Number(row.score).toFixed(0)}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-xs text-white/80 whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
                )}
                {(mode === 'breakdown' || mode === 'voice') && output && typeof output === 'object' && 'created' in output && (
                  <div className="mt-2 pt-2 border-t border-white/10 text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Created {((output as { created?: unknown[] }).created || []).length} task(s).
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
