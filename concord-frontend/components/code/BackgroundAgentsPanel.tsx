'use client';

/**
 * BackgroundAgentsPanel — Code Sprint C #11.
 *
 * Cursor 3's Agents Window + Zed Parallel Agents + Codex cloud.
 * Background agents that work while you do something else. Each
 * step advances on a heartbeat tick; live progress streams via the
 * existing realtimeEmit pathway.
 *
 * Plus the concord-native moat: each session is publishable as a
 * kind='agent_spec' DTU via the Phase 13 marketplace, so other
 * devs hire your background coder and you earn.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, Play, X, Globe2, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { getSocket } from '@/lib/realtime/socket';

interface BgSession {
  id: string;
  title?: string;
  goal: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'abandoned';
  total_turns: number;
  max_turns: number;
  created_at: number;
  updated_at: number;
}

interface BgTurn {
  turn_index: number;
  role: string;
  content?: string;
  created_at: number;
}

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'code', name, input });
    return (r.data?.result ?? r.data) as T;
  } catch {
    return null;
  }
}

export function BackgroundAgentsPanel({ projectPath }: { projectPath: string }) {
  const [sessions, setSessions] = useState<BgSession[]>([]);
  const [task, setTask] = useState('');
  const [maxSteps, setMaxSteps] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [turnsBySession, setTurnsBySession] = useState<Record<string, BgTurn[]>>({});

  const stateRef = useRef({ sessions, expanded });
  useEffect(() => { stateRef.current = { sessions, expanded }; }, [sessions, expanded]);

  const refresh = useCallback(async () => {
    setBusy('list');
    const r = await callMacro<{ ok: boolean; sessions?: BgSession[] }>('bg_list', {});
    if (r?.ok && r.sessions) setSessions(r.sessions);
    setBusy(null);
  }, []);

  const loadTurns = useCallback(async (sessionId: string) => {
    const r = await callMacro<{ ok: boolean; turns?: BgTurn[] }>('bg_status', { sessionId });
    if (r?.ok && r.turns) {
      setTurnsBySession((prev) => ({ ...prev, [sessionId]: r.turns! }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStart = () => { refresh(); };
    const onStep = (p: { sessionId: string }) => {
      refresh();
      if (stateRef.current.expanded.has(p.sessionId)) loadTurns(p.sessionId);
    };
    const onCancel = () => { refresh(); };
    socket.on('code:bg:started', onStart);
    socket.on('code:bg:step_done', onStep);
    socket.on('code:bg:cancelled', onCancel);
    return () => {
      socket.off('code:bg:started', onStart);
      socket.off('code:bg:step_done', onStep);
      socket.off('code:bg:cancelled', onCancel);
    };
  }, [refresh, loadTurns]);

  async function startAgent() {
    if (!task.trim()) return;
    setBusy('start'); setErr(null); setOk(null);
    const r = await callMacro<{ ok: boolean; sessionId?: string; reason?: string }>('bg_start', {
      task: task.trim(), projectPath, maxSteps, runner: 'npm',
    });
    if (r?.ok) { setOk(`Started ${r.sessionId?.slice(0, 24)}…`); setTask(''); await refresh(); }
    else setErr(r?.reason || 'start failed');
    setBusy(null);
  }

  async function cancelAgent(sessionId: string) {
    setBusy(`cancel-${sessionId}`); setErr(null);
    const r = await callMacro<{ ok: boolean; reason?: string }>('bg_cancel', { sessionId });
    if (r?.ok) { setOk('Cancelled.'); await refresh(); }
    else setErr(r?.reason || 'cancel failed');
    setBusy(null);
  }

  async function publishAgent(sessionId: string) {
    setBusy(`pub-${sessionId}`); setErr(null);
    const priceStr = typeof window !== 'undefined' ? window.prompt('Price (cents per use, 0-10000):', '0') : '0';
    const license = typeof window !== 'undefined' ? window.prompt('License (proprietary / MIT / CC-BY-SA / Apache):', 'proprietary') : 'proprietary';
    const r = await callMacro<{ ok: boolean; agentSpecDtuId?: string; reason?: string }>('bg_publish', {
      sessionId, priceCents: Number(priceStr) || 0, license: license || 'proprietary',
    });
    if (r?.ok) setOk(`Published as ${r.agentSpecDtuId?.slice(0, 24)}…`);
    else setErr(r?.reason || 'publish failed');
    setBusy(null);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else { next.add(id); loadTurns(id); }
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-blue-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Background agents</span>
        <span className="ml-auto text-[10px] text-gray-500">{sessions.length}</span>
        <button onClick={refresh} className="p-1 text-gray-400 hover:text-white"><RefreshCw className={cn('w-3.5 h-3.5', busy === 'list' && 'animate-spin')} /></button>
      </header>

      {err && <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3" />{err}</div>}
      {ok && <div className="m-2 px-2 py-1 text-[10px] text-emerald-300 bg-emerald-500/10 rounded">{ok}</div>}

      <div className="px-3 py-2 border-b border-white/10 space-y-1.5">
        <textarea
          value={task} onChange={(e) => setTask(e.target.value)}
          placeholder="Background task — e.g. refactor auth module, add tests for orders…"
          rows={2}
          className="w-full px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400 flex items-center gap-1">
            max steps:
            <input
              type="number" min={1} max={20} value={maxSteps}
              onChange={(e) => setMaxSteps(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className="w-12 px-1 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white font-mono"
            />
          </label>
          <button
            onClick={startAgent} disabled={busy !== null || !task.trim()}
            className="text-[10px] px-3 py-1 rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Start
          </button>
        </div>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto">
        {sessions.length === 0 ? (
          <li className="px-3 py-3 text-[10px] text-gray-500">
            No background agents. Start one above.
          </li>
        ) : (
          sessions.map((s) => {
            const isOpen = expanded.has(s.id);
            const turns = turnsBySession[s.id] || [];
            const statusClass = s.status === 'running' ? 'text-blue-300' : s.status === 'completed' ? 'text-emerald-300' : s.status === 'failed' ? 'text-red-300' : 'text-gray-500';
            return (
              <li key={s.id} className="border-b border-white/5">
                <div className="px-3 py-2 flex items-center gap-2">
                  <button onClick={() => toggleExpanded(s.id)} className="text-gray-500 hover:text-white">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span className="flex-1 truncate text-xs text-white">{s.title || s.goal}</span>
                  <span className={cn('text-[10px] uppercase tracking-wider', statusClass)}>{s.status}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{s.total_turns}/{s.max_turns}</span>
                  {(s.status === 'running' || s.status === 'pending') && (
                    <button
                      onClick={() => cancelAgent(s.id)} disabled={busy !== null}
                      className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-30" title="Cancel"
                    ><X className="w-3.5 h-3.5" /></button>
                  )}
                  {s.status === 'completed' && (
                    <button
                      onClick={() => publishAgent(s.id)} disabled={busy !== null}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-30" title="Publish as agent_spec DTU"
                    >
                      {busy === `pub-${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="px-12 pb-2 space-y-1 max-h-48 overflow-y-auto">
                    {turns.length === 0 ? (
                      <p className="text-[10px] text-gray-500">No turns yet.</p>
                    ) : (
                      turns.map((t) => (
                        <div key={t.turn_index} className="text-[10px] text-gray-400">
                          <span className="font-mono text-cyan-300">#{t.turn_index}</span>{' '}
                          <span className="uppercase text-[9px]">{t.role}</span>{' '}
                          <span className="truncate">{(t.content || '').slice(0, 200)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export default BackgroundAgentsPanel;
