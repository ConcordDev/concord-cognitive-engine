'use client';

/**
 * MarathonPanel — Sprint 13
 *
 * Surface for long-running agent marathon sessions. Backed by
 * `agent_marathon.list / start / get / tick / pause / abandon` macros
 * (Sprint 12). Mounted as a tab inside AgentModePanel.
 *
 * Marathon sessions persist across requests. A heartbeat auto-ticks
 * 'running' sessions every ~3 min, so progress accrues even when
 * the user closes the tab. Sprint 13 added marathon→initiative
 * wiring so the bell lights up on completion.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Hammer, Play, Pause, X, ChevronRight, CheckCircle2, AlertTriangle, Loader2,
  Plus,
} from 'lucide-react';

interface Session {
  id: string;
  title: string;
  goal: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'abandoned';
  total_turns: number;
  max_turns: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface Turn {
  turn_index: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider?: string;
  model?: string;
  tool_calls?: unknown[];
  artifacts?: unknown[];
}

interface SessionDetail extends Session {
  turns: Turn[];
}

async function macro(name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'agent_marathon', name, input }),
  });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return j?.result || j;
}

function fmtRelative(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusBadge(status: Session['status']): { label: string; color: string } {
  const colors: Record<Session['status'], string> = {
    pending: 'bg-zinc-700 text-zinc-200',
    running: 'bg-emerald-600/85 text-emerald-50',
    paused: 'bg-amber-600/85 text-amber-50',
    completed: 'bg-blue-600/85 text-blue-50',
    failed: 'bg-red-600/85 text-red-50',
    abandoned: 'bg-zinc-700 text-zinc-400',
  };
  return { label: status, color: colors[status] };
}

interface MarathonPanelProps {
  onClose?: () => void;
}

export default function MarathonPanel({ onClose }: MarathonPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [newGoal, setNewGoal] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const r = await macro('list', {});
    if (r?.ok) setSessions(r.sessions || []);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const loadDetail = useCallback(async (sessionId: string) => {
    setSelectedId(sessionId);
    const r = await macro('get', { sessionId });
    if (r?.ok) setDetail(r.session);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(() => loadDetail(selectedId), 10_000);
    return () => clearInterval(id);
  }, [selectedId, loadDetail]);

  const startMarathon = async () => {
    if (!newGoal.trim() || busy) return;
    setBusy(true);
    const r = await macro('start', {
      goal: newGoal.trim(),
      title: newTitle.trim() || undefined,
    });
    setBusy(false);
    if (r?.ok) {
      setNewGoal('');
      setNewTitle('');
      setCreating(false);
      refresh();
      loadDetail(r.sessionId);
    }
  };

  const tickNow = async (sessionId: string) => {
    setBusy(true);
    const r = await macro('tick', { sessionId, tickTurns: 5 });
    setBusy(false);
    if (r?.ok) {
      refresh();
      loadDetail(sessionId);
    }
  };

  const pause = async (sessionId: string) => {
    await macro('pause', { sessionId });
    refresh();
    if (selectedId === sessionId) loadDetail(sessionId);
  };

  const abandon = async (sessionId: string) => {
    if (!confirm('Abandon this marathon? Terminal — cannot resume.')) return;
    await macro('abandon', { sessionId });
    refresh();
    if (selectedId === sessionId) {
      setSelectedId(null);
      setDetail(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Hammer className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Marathons</h3>
          <span className="text-[10px] text-zinc-500">long-running tasks</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCreating(c => !c)}
            className="p-1.5 rounded text-zinc-400 hover:text-amber-300 hover:bg-zinc-800"
            title={creating ? 'Cancel' : 'New marathon'}
          >
            {creating ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {creating && (
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/40 space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full px-3 py-1.5 rounded bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none"
          />
          <textarea
            value={newGoal}
            onChange={e => setNewGoal(e.target.value)}
            placeholder="The goal — e.g. 'Refactor authentication across all routes' or 'Write a 5,000-word essay on…'"
            rows={3}
            className="w-full px-3 py-1.5 rounded bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={startMarathon}
              disabled={busy || !newGoal.trim()}
              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-amber-50 text-sm font-medium disabled:opacity-50"
            >
              Start
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedId && detail ? (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <button
            onClick={() => { setSelectedId(null); setDetail(null); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 mb-3"
          >
            ← back to list
          </button>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h4 className="text-sm font-semibold text-zinc-100 flex-1 min-w-0">{detail.title || detail.goal.slice(0, 50)}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusBadge(detail.status).color}`}>
              {statusBadge(detail.status).label}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-3 leading-relaxed">{detail.goal}</p>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500 mb-4">
            <span>{detail.total_turns} / {detail.max_turns} turns</span>
            <span>updated {fmtRelative(detail.updated_at)}</span>
          </div>
          <div className="flex gap-2 mb-4">
            {detail.status === 'paused' && (
              <button onClick={() => tickNow(detail.id)} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-emerald-50 text-xs disabled:opacity-50">
                <Play className="w-3 h-3" /> Resume
              </button>
            )}
            {detail.status === 'running' && (
              <button onClick={() => pause(detail.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-amber-50 text-xs">
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}
            {!['completed', 'abandoned'].includes(detail.status) && (
              <button onClick={() => abandon(detail.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-red-700/70 hover:bg-red-700 text-red-50 text-xs">
                <X className="w-3 h-3" /> Abandon
              </button>
            )}
            {detail.status === 'running' && busy && (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                <Loader2 className="w-3 h-3 animate-spin" /> ticking…
              </span>
            )}
          </div>
          <div className="space-y-3">
            {detail.turns.map((t, i) => (
              <div key={i} className={`px-3 py-2 rounded text-xs ${
                t.role === 'user' ? 'bg-amber-500/10 ring-1 ring-amber-700/30 text-zinc-100'
                  : t.role === 'assistant' ? 'bg-zinc-900/60 text-zinc-200'
                  : 'bg-zinc-800/40 text-zinc-400'
              }`}>
                <div className="text-[10px] text-zinc-500 mb-1">
                  turn {t.turn_index} · {t.role}{t.provider && t.provider !== 'concord_default' ? ` · ${t.provider}` : ''}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{(t.content || '').slice(0, 1500)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sessions.length === 0 ? (
            <div className="text-center text-xs text-zinc-500 mt-12 px-4">
              <p className="mb-2">No marathons yet.</p>
              <p className="text-zinc-600">
                Start one with the + button. The agent works toward your goal across hours/days,
                auto-ticking every ~3 minutes even when you close the tab.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {sessions.map(s => {
                const badge = statusBadge(s.status);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => loadDetail(s.id)}
                      className="w-full text-left px-3 py-2.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-900 ring-1 ring-zinc-800 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-zinc-100 truncate flex-1 min-w-0">
                          {s.title || s.goal.slice(0, 50)}
                        </span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span>{s.total_turns}/{s.max_turns} turns</span>
                        <span>{fmtRelative(s.updated_at)}</span>
                        {s.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                        {s.status === 'failed' && <AlertTriangle className="w-3 h-3 text-red-500" />}
                        <ChevronRight className="w-3 h-3 ml-auto" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
