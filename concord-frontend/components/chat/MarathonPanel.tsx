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

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Hammer, Play, Pause, X, ChevronRight, CheckCircle2, AlertTriangle, Loader2,
  Plus, ShieldAlert, ShieldOff, FileText,
} from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { useSmartPolling } from '@/hooks/useSmartPolling';

interface Session {
  id: string;
  title: string;
  goal: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'abandoned' | 'revoked';
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
  // Governance envelope (mig 379) — present once the backend has been
  // migrated; getMarathon's SELECT * means these are simply absent on an
  // older row, never fabricated.
  allowed_domains_json?: string | null;
  budget_cap?: number | null;
  budget_spent?: number;
  revoked_at?: number | null;
}

// Sane, editable default for a new marathon's spend/action cap — matches
// MARATHON_CONSTANTS.DEFAULT_BUDGET_CAP in lib/agent-marathon.js. A new
// marathon is capped by default; true unrestricted is an explicit,
// separately-toggled advanced override, never the default.
const DEFAULT_BUDGET_CAP = 150;

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

function safeJsonParse(s: string | null | undefined): string[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
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
    revoked: 'bg-rose-700/85 text-rose-50',
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

  // Governance envelope (mig 379) — creation-time controls. Budget defaults
  // to a sane, editable cap (never silently unrestricted); domain
  // restriction is an explicit advanced opt-in against the REAL live
  // macro-domain list (never a hardcoded/fake list).
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [restrictDomains, setRestrictDomains] = useState(false);
  const [budgetCap, setBudgetCap] = useState<number>(DEFAULT_BUDGET_CAP);
  const [unrestrictedBudget, setUnrestrictedBudget] = useState(false);

  // On-demand deterministic progress digest (`agent_marathon.digest` macro —
  // server/lib/marathon-digest.js). Purely a display convenience on top of
  // real turns/tool_calls_json/artifacts_json — never a brain call.
  const [digestText, setDigestText] = useState<string | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);

  const refresh = useCallback(async () => {
    const r = await macro('list', {});
    if (r?.ok) setSessions(r.sessions || []);
  }, []);

  useSmartPolling(refresh, 15_000);

  // Real, live macro-domain list (not a hardcoded/fake array) — the same
  // public endpoint the macro registry itself exposes (`listDomains()` in
  // server.js, mounted at GET /api/macros/domains in routes/domain.js).
  // Fetched lazily, once, the first time the create-form is opened.
  useEffect(() => {
    if (!creating || allDomains.length > 0) return;
    fetch('/api/macros/domains', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.domains)) setAllDomains(j.domains); })
      .catch(() => {});
  }, [creating, allDomains.length]);

  const filteredDomains = useMemo(() => {
    const f = domainFilter.trim().toLowerCase();
    if (!f) return allDomains;
    return allDomains.filter((d) => d.toLowerCase().includes(f));
  }, [allDomains, domainFilter]);

  const toggleDomain = (d: string) => {
    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };

  const loadDetail = useCallback(async (sessionId: string) => {
    setSelectedId(sessionId);
    setDigestText(null);
    const r = await macro('get', { sessionId });
    if (r?.ok) setDetail(r.session);
  }, []);

  const summarizeProgress = async (sessionId: string) => {
    setDigestLoading(true);
    const r = await macro('digest', { sessionId });
    setDigestLoading(false);
    setDigestText(r?.ok ? (r.text || null) : null);
  };

  // immediate:false preserves prior behavior — loadDetail is already invoked
  // directly by the selection action (click / start / etc.) that sets
  // selectedId, so an immediate poll here would be a duplicate fetch.
  useSmartPolling(
    () => { if (selectedId) loadDetail(selectedId); },
    10_000,
    { enabled: !!selectedId, immediate: false },
  );

  // Real 'marathon:status' consumer — server.js#realtimeEmit now scopes
  // this to the session owner's own room (agent-marathon.js's completion/
  // pause hook passes { userId } as of DET-C batch 5; it previously
  // fell through to a global broadcast with no subscriber at all). Reacts
  // instantly to a marathon completing/pausing instead of waiting up to
  // the 15s list poll / 10s detail poll above.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    const off = subscribe<{ session_id?: string }>('marathon:status', (msg) => {
      refresh();
      if (msg?.session_id && msg.session_id === selectedIdRef.current) {
        loadDetail(msg.session_id);
      }
    });
    return off;
  }, [refresh, loadDetail]);

  const startMarathon = async () => {
    if (!newGoal.trim() || busy) return;
    setBusy(true);
    const r = await macro('start', {
      goal: newGoal.trim(),
      title: newTitle.trim() || undefined,
      // Governance envelope (mig 379) — real, enforced values, never
      // decorative. Budget is unrestricted ONLY via the explicit advanced
      // toggle; domain restriction is opt-in and only sent when the user
      // actually picked at least one domain.
      budgetCap: unrestrictedBudget ? undefined : budgetCap,
      allowedDomains: (restrictDomains && selectedDomains.size > 0) ? Array.from(selectedDomains) : undefined,
    });
    setBusy(false);
    if (r?.ok) {
      setNewGoal('');
      setNewTitle('');
      setCreating(false);
      setSelectedDomains(new Set());
      setDomainFilter('');
      setRestrictDomains(false);
      setUnrestrictedBudget(false);
      setBudgetCap(DEFAULT_BUDGET_CAP);
      refresh();
      loadDetail(r.sessionId);
    }
  };

  const revoke = async (sessionId: string) => {
    if (!confirm('Revoke this marathon immediately? It stops right away, even mid-task, and cannot be undone.')) return;
    setBusy(true);
    const r = await macro('revoke', { sessionId });
    setBusy(false);
    if (r?.ok) {
      refresh();
      if (selectedId === sessionId) loadDetail(sessionId);
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
          <span className="text-[10px] text-zinc-400">long-running tasks</span>
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
          {/* Governance envelope (mig 379) — every long-running marathon
              gets a real, enforced spend cap by default, and can optionally
              be scoped to a subset of the actual live macro-domain list. */}
          <div className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/60 p-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-zinc-300 font-medium">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Governance
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400 flex-1">Action budget cap</label>
              <input
                type="number"
                min={1}
                step={1}
                value={budgetCap}
                disabled={unrestrictedBudget}
                onChange={(e) => setBudgetCap(Math.max(1, parseInt(e.target.value, 10) || DEFAULT_BUDGET_CAP))}
                className="w-20 px-2 py-1 rounded bg-zinc-950 text-zinc-100 text-xs ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none disabled:opacity-40"
              />
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                <input type="checkbox" checked={unrestrictedBudget} onChange={(e) => setUnrestrictedBudget(e.target.checked)} />
                unrestricted (advanced)
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input type="checkbox" checked={restrictDomains} onChange={(e) => setRestrictDomains(e.target.checked)} />
                Restrict to specific macro domains (advanced)
              </label>
              {restrictDomains && (
                <div className="pl-1 space-y-1.5">
                  <input
                    type="text"
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    placeholder={`Filter ${allDomains.length || '…'} domains`}
                    className="w-full px-2 py-1 rounded bg-zinc-950 text-zinc-100 text-xs ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none"
                  />
                  <div className="max-h-32 overflow-y-auto rounded ring-1 ring-zinc-800 bg-zinc-950/80 p-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {filteredDomains.length === 0 ? (
                      <span className="text-[10px] text-zinc-500 col-span-2 px-1 py-1">
                        {allDomains.length === 0 ? 'Loading domains…' : 'No domains match.'}
                      </span>
                    ) : filteredDomains.map((d) => (
                      <label key={d} className="flex items-center gap-1 text-[10px] text-zinc-300 truncate">
                        <input type="checkbox" checked={selectedDomains.has(d)} onChange={() => toggleDomain(d)} />
                        <span className="truncate" title={d}>{d}</span>
                      </label>
                    ))}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {selectedDomains.size === 0
                      ? 'No domains picked yet — restriction won’t apply until at least one is selected.'
                      : `${selectedDomains.size} domain${selectedDomains.size === 1 ? '' : 's'} allowed.`}
                  </div>
                </div>
              )}
            </div>
          </div>
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
            className="text-xs text-zinc-400 hover:text-zinc-300 mb-3"
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
          <div className="flex items-center gap-3 text-[10px] text-zinc-400 mb-1 flex-wrap">
            <span>{detail.total_turns} / {detail.max_turns} turns</span>
            <span>updated {fmtRelative(detail.updated_at)}</span>
            {/* Governance envelope (mig 379) — real numbers straight off the
                session row, never fabricated. Absent budget_cap means this
                session is genuinely unrestricted, not "still loading". */}
            {detail.budget_cap != null && (
              <span className="flex items-center gap-1 text-amber-300/90">
                <ShieldAlert className="w-3 h-3" />
                {Math.max(0, detail.budget_cap - (detail.budget_spent || 0))} / {detail.budget_cap} actions left
              </span>
            )}
            {detail.budget_cap == null && (
              <span className="flex items-center gap-1 text-zinc-500">
                <ShieldOff className="w-3 h-3" />
                unrestricted budget
              </span>
            )}
            {detail.allowed_domains_json && (
              <span className="text-zinc-500 truncate max-w-[220px]" title={JSON.stringify(safeJsonParse(detail.allowed_domains_json))}>
                scoped to {safeJsonParse(detail.allowed_domains_json)?.length ?? 0} domain(s)
              </span>
            )}
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
            {['running', 'pending', 'paused'].includes(detail.status) && (
              <button onClick={() => revoke(detail.id)} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded bg-rose-700/80 hover:bg-rose-700 text-rose-50 text-xs disabled:opacity-50" title="Stop immediately, even mid-task — enforced inside the very next tool call.">
                <ShieldOff className="w-3 h-3" /> Revoke
              </button>
            )}
            {!['completed', 'abandoned', 'revoked', 'failed'].includes(detail.status) && (
              <button onClick={() => abandon(detail.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-red-700/70 hover:bg-red-700 text-red-50 text-xs">
                <X className="w-3 h-3" /> Abandon
              </button>
            )}
            {detail.status === 'running' && busy && (
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Loader2 className="w-3 h-3 animate-spin" /> ticking…
              </span>
            )}
            <button
              onClick={() => summarizeProgress(detail.id)}
              disabled={digestLoading}
              className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs disabled:opacity-50"
              title="Deterministic progress summary built from real turns/tool calls/artifacts — no brain call."
            >
              {digestLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
              Summarize progress
            </button>
          </div>
          {digestText && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-zinc-900/70 ring-1 ring-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">Progress digest</span>
                <button onClick={() => setDigestText(null)} className="text-zinc-500 hover:text-zinc-300" aria-label="Dismiss digest">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs text-zinc-300 leading-relaxed font-sans">{digestText}</pre>
            </div>
          )}
          <div className="space-y-3">
            {detail.turns.map((t, i) => (
              <div key={i} className={`px-3 py-2 rounded text-xs ${
                t.role === 'user' ? 'bg-amber-500/10 ring-1 ring-amber-700/30 text-zinc-100'
                  : t.role === 'assistant' ? 'bg-zinc-900/60 text-zinc-200'
                  : 'bg-zinc-800/40 text-zinc-400'
              }`}>
                <div className="text-[10px] text-zinc-400 mb-1">
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
            <div className="text-center text-xs text-zinc-400 mt-12 px-4">
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
                      <div className="flex items-center gap-2 text-[10px] text-zinc-400">
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
